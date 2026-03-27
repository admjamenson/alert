import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteTransportMode } from './RouteDestinationService';
import RoutingService from './maps/RoutingService';

export type RoutePoint = { latitude: number; longitude: number };

export type RouteDetails = {
  line: Array<[number, number]>;
  distanceKm?: number;
  durationMin?: number;
  transportMode?: RouteTransportMode;
};

const ROUTE_CACHE_TTL = 5 * 60 * 1000; // 5min
const ROUTE_CACHE_PREFIX = '@Alert:RouteCache:v3:';

const roundCoord = (value: number) => Number(value.toFixed(4));

const buildCacheKey = (
  from: RoutePoint,
  to: RoutePoint,
  transportMode: RouteTransportMode,
) =>
  `${ROUTE_CACHE_PREFIX}${transportMode}:${roundCoord(from.latitude)}:${roundCoord(
    from.longitude,
  )}:${roundCoord(to.latitude)}:${roundCoord(to.longitude)}`;

const resolveRouteProfile = (transportMode: RouteTransportMode) => {
  if (transportMode === 'bike') return 'cycling';
  if (transportMode === 'walk') return 'walking';
  return 'driving';
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineKm = (from: RoutePoint, to: RoutePoint) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const roundDistanceKm = (value: number | undefined) =>
  Number.isFinite(value) ? Math.round(Number(value) * 10) / 10 : undefined;

const hasUsableDistance = (value: number | undefined) =>
  Number.isFinite(value) && Number(value) > 0.05;

const resolveLocale = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
};

const minutesFromSpeed = (distanceKm: number, speedKmH: number) => {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(speedKmH) || speedKmH <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round((distanceKm / speedKmH) * 60));
};

const estimateDurationByMode = (params: {
  distanceKm?: number;
  routeDurationMin?: number;
  transportMode: RouteTransportMode;
}) => {
  const distanceKm = Number(params.distanceKm);
  const routeDurationMin = Number(params.routeDurationMin);
  const hasDistance = Number.isFinite(distanceKm) && distanceKm > 0;
  const hasRouteDuration = Number.isFinite(routeDurationMin) && routeDurationMin > 0;

  if (!hasDistance && hasRouteDuration) {
    return Math.max(1, Math.round(routeDurationMin));
  }
  if (!hasDistance) {
    return undefined;
  }

  const safeDistanceKm = distanceKm;

  if (params.transportMode === 'walk') {
    return minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 2 ? 4.8 : 5.2);
  }

  if (params.transportMode === 'bike') {
    const plausibleMin =
      minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 4 ? 14 : safeDistanceKm <= 12 ? 17 : 20) ||
      1;
    return hasRouteDuration
      ? Math.max(plausibleMin, Math.round(routeDurationMin))
      : plausibleMin;
  }

  if (params.transportMode === 'motorcycle') {
    if (!hasRouteDuration) {
      return minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 5 ? 28 : safeDistanceKm <= 15 ? 34 : 40);
    }

    const benefitFactor =
      safeDistanceKm <= 4 ? 0.78 : safeDistanceKm <= 12 ? 0.84 : safeDistanceKm <= 25 ? 0.9 : 0.94;
    const floorMinutes =
      minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 5 ? 26 : safeDistanceKm <= 15 ? 32 : 38) || 1;
    return Math.max(floorMinutes, Math.round(routeDurationMin * benefitFactor));
  }

  if (params.transportMode === 'bus') {
    const cruiseSpeed =
      safeDistanceKm <= 3 ? 14 : safeDistanceKm <= 8 ? 18 : safeDistanceKm <= 18 ? 22 : 26;
    const motionMinutes = minutesFromSpeed(safeDistanceKm, cruiseSpeed) || 1;
    const dwellPenalty = Math.max(3, Math.min(14, Math.round(safeDistanceKm * 0.7)));
    const boardingPenalty = safeDistanceKm >= 8 ? 4 : safeDistanceKm >= 4 ? 3 : 2;
    const busModelMinutes = motionMinutes + dwellPenalty + boardingPenalty;
    if (!hasRouteDuration) {
      return busModelMinutes;
    }
    return Math.max(Math.round(routeDurationMin) + boardingPenalty, busModelMinutes);
  }

  if (hasRouteDuration) {
    const plausibleMin =
      minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 5 ? 28 : safeDistanceKm <= 15 ? 36 : 44) ||
      1;
    return Math.max(plausibleMin, Math.round(routeDurationMin));
  }

  return minutesFromSpeed(safeDistanceKm, safeDistanceKm <= 5 ? 26 : safeDistanceKm <= 15 ? 34 : 46);
};

const readCache = async (key: string): Promise<RouteDetails | null> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as { ts: number; data: RouteDetails };
    if (Date.now() - cached.ts > ROUTE_CACHE_TTL) return null;
    return cached.data;
  } catch {
    return null;
  }
};

const writeCache = async (key: string, data: RouteDetails) => {
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // ignore cache errors
  }
};

export const RouteService = {
  async getRouteDetails(
    from: RoutePoint,
    to: RoutePoint,
    transportMode: RouteTransportMode = 'car',
  ): Promise<RouteDetails> {
    const fallbackLine: Array<[number, number]> = [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ];
    const fallbackDistanceKm = roundDistanceKm(haversineKm(from, to));
    const fallback: RouteDetails = {
      line: fallbackLine,
      distanceKm: fallbackDistanceKm,
      durationMin: estimateDurationByMode({
        distanceKm: fallbackDistanceKm,
        transportMode,
      }),
      transportMode,
    };

    const cacheKey = buildCacheKey(from, to, transportMode);
    const cached = await readCache(cacheKey);
    if (cached) return cached;

    try {
      if (transportMode === 'car' || transportMode === 'motorcycle') {
        const routeOptions = await RoutingService.getRouteOptions({
          from: [from.longitude, from.latitude],
          to: [to.longitude, to.latitude],
          locale: resolveLocale(),
          riskPenalty: 0,
        }).catch(() => []);

        const preferredRoute = Array.isArray(routeOptions) && routeOptions.length > 0 ? routeOptions[0] : null;
        if (preferredRoute && Array.isArray(preferredRoute.geometry) && preferredRoute.geometry.length >= 2) {
          const distanceKm = roundDistanceKm(preferredRoute.distanceKm);
          const durationMin = estimateDurationByMode({
            distanceKm,
            routeDurationMin: preferredRoute.etaMin,
            transportMode,
          });

          if (hasUsableDistance(distanceKm) && Number.isFinite(durationMin) && Number(durationMin) > 0) {
            const details: RouteDetails = {
              line: preferredRoute.geometry,
              distanceKm,
              durationMin,
              transportMode,
            };
            await writeCache(cacheKey, details);
            return details;
          }
        }
      }

      const profile = resolveRouteProfile(transportMode);
      const url = `https://router.project-osrm.org/route/v1/${profile}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) return fallback;
      const data = await res.json();
      const route = data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (!coords || !Array.isArray(coords)) return fallback;

      const distanceKm = roundDistanceKm(
        typeof route?.distance === 'number' ? route.distance / 1000 : haversineKm(from, to),
      );
      const rawRouteDurationMin =
        typeof route?.duration === 'number' ? Math.max(1, Math.round(route.duration / 60)) : undefined;
      const durationMin = estimateDurationByMode({
        distanceKm,
        routeDurationMin: rawRouteDurationMin,
        transportMode,
      });

      const details: RouteDetails = {
        line: coords as Array<[number, number]>,
        distanceKm,
        durationMin,
        transportMode,
      };
      await writeCache(cacheKey, details);
      return details;
    } catch {
      return fallback;
    }
  },

  async getRouteLine(
    from: RoutePoint,
    to: RoutePoint,
    transportMode: RouteTransportMode = 'car',
  ): Promise<Array<[number, number]>> {
    const details = await RouteService.getRouteDetails(from, to, transportMode);
    return details.line;
  },
};
