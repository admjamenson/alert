import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  RouteAdvisory,
  RouteDetails,
  RoutePoint,
  RoutePrecision,
  RouteTransportMode,
} from '../domain/route/RouteModels';
import RoutingService from './maps/RoutingService';
import type { RouteOption } from './maps/types';

export type {
  RouteDetails,
  RoutePoint,
  RouteTransportMode,
} from '../domain/route/RouteModels';

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
  if (!isCacheableRouteDetails(data)) return;
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // ignore cache errors
  }
};

const isCacheableRouteDetails = (details: RouteDetails | null | undefined): details is RouteDetails =>
  Boolean(
    details &&
      details.routeMode === 'provider' &&
      details.precision === 'high' &&
      !details.degraded &&
      details.providerAvailable &&
      Array.isArray(details.line) &&
      details.line.length >= 2 &&
      hasUsableDistance(details.distanceKm) &&
      Number.isFinite(details.durationMin) &&
      Number(details.durationMin) > 0,
  );

const buildAdvisory = (
  advisory: RouteAdvisory | null | undefined,
  fallbackCode: string | null,
): RouteAdvisory | null => {
  if (advisory?.code) return advisory;
  if (!fallbackCode) return null;
  return {
    code: fallbackCode,
    severity: 'warning',
  };
};

const buildUnavailableRouteDetails = (params: {
  transportMode: RouteTransportMode;
  reasonCode?: string | null;
  advisoryCode?: string | null;
  providerId?: string;
}): RouteDetails => ({
  line: [],
  distanceKm: undefined,
  durationMin: undefined,
  transportMode: params.transportMode,
  routeMode: 'unavailable',
  precision: 'none',
  degraded: true,
  providerAvailable: false,
  providerId: params.providerId,
  reasonCode: params.reasonCode || 'route_unavailable',
  advisory: buildAdvisory(null, params.advisoryCode || 'route_advisory_unavailable'),
});

const toRouteDetails = (
  route: RouteOption,
  transportMode: RouteTransportMode,
): RouteDetails => {
  const geometry = Array.isArray(route.geometry) ? route.geometry : [];
  if (geometry.length < 2) {
    return buildUnavailableRouteDetails({
      transportMode,
      reasonCode: route.reasonCode || 'route_geometry_unavailable',
      advisoryCode: route.advisory?.code || 'route_advisory_unavailable',
      providerId: route.providerId || route.trust?.providerId,
    });
  }

  const distanceKm = roundDistanceKm(route.distanceKm);
  const durationMin = estimateDurationByMode({
    distanceKm,
    routeDurationMin: route.etaMin,
    transportMode,
  });

  return {
    line: geometry,
    distanceKm,
    durationMin,
    transportMode,
    routeMode: route.routeMode,
    precision: route.precision as RoutePrecision,
    degraded: Boolean(route.degraded),
    providerAvailable: Boolean(route.providerAvailable),
    providerId: route.providerId || route.trust?.providerId,
    reasonCode: route.reasonCode || null,
    advisory: buildAdvisory(
      route.advisory,
      route.routeMode === 'estimated_straight_line'
        ? 'route_advisory_estimated_straight_line'
        : route.routeMode === 'unavailable'
          ? 'route_advisory_unavailable'
          : null,
    ),
  };
};

export const RouteService = {
  async getRouteDetails(
    from: RoutePoint,
    to: RoutePoint,
    transportMode: RouteTransportMode = 'car',
  ): Promise<RouteDetails> {
    const cacheKey = buildCacheKey(from, to, transportMode);
    const cached = await readCache(cacheKey);
    if (isCacheableRouteDetails(cached)) return cached;

    try {
      const routeOptions = await RoutingService.getRouteOptions({
        from: [from.longitude, from.latitude],
        to: [to.longitude, to.latitude],
        locale: resolveLocale(),
        transportMode,
        riskPenalty: 0,
      }).catch(() => []);

      const preferredRoute =
        Array.isArray(routeOptions) && routeOptions.length > 0 ? routeOptions[0] : null;
      if (preferredRoute) {
        const details = toRouteDetails(preferredRoute, transportMode);
        await writeCache(cacheKey, details);
        return details;
      }

      return buildUnavailableRouteDetails({
        transportMode,
        reasonCode: 'route_unavailable',
        advisoryCode: 'route_advisory_unavailable',
      });
    } catch {
      return buildUnavailableRouteDetails({
        transportMode,
        reasonCode: 'route_backend_unavailable',
        advisoryCode: 'route_advisory_unavailable',
      });
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
