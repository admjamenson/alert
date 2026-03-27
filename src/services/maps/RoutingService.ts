import { Platform } from 'react-native';

import { APP_CONFIG } from '../../core/config';
import OfflineCacheService from './OfflineCacheService';
import ProviderRouter from './ProviderRouter';
import { RouteOption, RouteRequest, TrustMeta } from './types';

type BackendRoute = {
  id?: string;
  distanceMeters?: number;
  durationSec?: number;
  geometry?: Array<[number, number]>;
  trafficLevel?: 'low' | 'medium' | 'high' | 'unknown';
  safetyScore?: number;
};

type BackendResponse = {
  routes?: BackendRoute[];
  source?: string;
  updatedAt?: string;
};

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: Array<[number, number]> };
};

type OsrmResponse = {
  routes?: OsrmRoute[];
};

export type ExternalNavigationLinks = {
  appleMaps: string;
  googleMaps: string;
  waze: string;
  preferred: string;
};

const getApiBaseUrl = () => {
  const globalOverride = (globalThis as any)?.ALERT_API_URL || (globalThis as any)?.__ALERT_API_URL__;
  const envOverride = typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return (globalOverride || envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const calcDistanceKm = (meters: number | undefined) =>
  Number.isFinite(meters) ? Math.round((Number(meters) / 1000) * 10) / 10 : 0;

const calcEtaMin = (seconds: number | undefined) => {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(1, Math.round(Number(seconds) / 60));
};

const normalizeTrust = (providerId: string, connectionStatus: 'online' | 'degraded'): TrustMeta => ({
  sourceName: providerId === 'backend-routing' ? 'Alert Routing' : 'OSRM',
  updatedAt: new Date().toISOString(),
  connectionStatus,
  providerId,
});

const parseOsrmRoute = (
  route: OsrmRoute,
  index: number,
  trust: TrustMeta,
): RouteOption | null => {
  const geometry = Array.isArray(route?.geometry?.coordinates)
    ? (route.geometry?.coordinates as Array<[number, number]>)
    : [];
  if (geometry.length < 2) return null;

  const etaMin = calcEtaMin(route.duration);
  const distanceKm = calcDistanceKm(route.distance);

  return {
    id: `osrm-${index}`,
    kind: 'alternative',
    title: index === 0 ? 'Fastest' : `Alternative ${index}`,
    etaMin,
    distanceKm,
    geometry,
    trafficLevel: 'unknown',
    trust,
  };
};

const backendRouting = async (input: RouteRequest): Promise<RouteOption[] | null> => {
  const base = getApiBaseUrl();
  if (!base) return null;

  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  const url =
    `${trimmed}/v1/maps/routes?fromLat=${encodeURIComponent(String(input.from[1]))}` +
    `&fromLon=${encodeURIComponent(String(input.from[0]))}` +
    `&toLat=${encodeURIComponent(String(input.to[1]))}` +
    `&toLon=${encodeURIComponent(String(input.to[0]))}` +
    `&locale=${encodeURIComponent(input.locale)}` +
    (input.worldview ? `&worldview=${encodeURIComponent(input.worldview)}` : '');

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as BackendResponse;
  const rows = Array.isArray(json?.routes) ? json.routes : [];
  if (rows.length === 0) return null;

  const trust: TrustMeta = {
    sourceName: json?.source || 'Alert Routing',
    updatedAt: json?.updatedAt || new Date().toISOString(),
    connectionStatus: 'online',
    providerId: 'backend-routing',
  };

  const mapped = rows
    .map((route, index) => {
      const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
      if (geometry.length < 2) return null;

      return {
        id: String(route?.id || `backend-${index}`),
        kind: 'alternative',
        title: index === 0 ? 'Fastest' : `Alternative ${index}`,
        etaMin: calcEtaMin(route.durationSec),
        distanceKm: calcDistanceKm(route.distanceMeters),
        geometry,
        safetyScore: Number.isFinite(route?.safetyScore) ? Number(route?.safetyScore) : undefined,
        trafficLevel: route?.trafficLevel || 'unknown',
        trust,
      };
    })
    .filter(Boolean) as RouteOption[];

  return mapped.length > 0 ? mapped : null;
};

const osrmRouting = async (input: RouteRequest): Promise<RouteOption[] | null> => {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${input.from[0]},${input.from[1]};${input.to[0]},${input.to[1]}` +
    '?overview=full&geometries=geojson&alternatives=true&steps=false&annotations=false';

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as OsrmResponse;
  const rows = Array.isArray(json?.routes) ? json.routes : [];
  if (rows.length === 0) return null;

  const trust = normalizeTrust('osrm-routing', 'online');
  const mapped = rows
    .map((route, index) => parseOsrmRoute(route, index, trust))
    .filter(Boolean) as RouteOption[];

  return mapped.length > 0 ? mapped : null;
};

const shapeOptions = (routes: RouteOption[], riskPenalty = 0): RouteOption[] => {
  if (routes.length === 0) return [];

  const rankedFast = [...routes].sort((a, b) => a.etaMin - b.etaMin);
  const rankedShort = [...routes].sort((a, b) => a.distanceKm - b.distanceKm);
  const rankedSafe = [...routes].sort((a, b) => {
    const aScore = (a.safetyScore ?? 0.5) - riskPenalty * (a.trafficLevel === 'high' ? 0.15 : 0.05);
    const bScore = (b.safetyScore ?? 0.5) - riskPenalty * (b.trafficLevel === 'high' ? 0.15 : 0.05);
    return bScore - aScore;
  });

  const fastest = rankedFast[0];
  const shortest = rankedShort[0];
  const safest = rankedSafe[0];

  const dedup = new Map<string, RouteOption>();
  if (fastest) {
    dedup.set(`fastest-${fastest.id}`, {
      ...fastest,
      id: `fastest-${fastest.id}`,
      kind: 'fastest',
      title: 'Fastest',
    });
  }
  if (shortest && shortest.id !== fastest?.id) {
    dedup.set(`shortest-${shortest.id}`, {
      ...shortest,
      id: `shortest-${shortest.id}`,
      kind: 'shortest',
      title: 'Shortest',
    });
  }
  if (safest && safest.id !== fastest?.id && safest.id !== shortest?.id) {
    dedup.set(`safest-${safest.id}`, {
      ...safest,
      id: `safest-${safest.id}`,
      kind: 'safest',
      title: 'Safest',
    });
  }

  for (const candidate of routes) {
    if (dedup.size >= 3) break;
    const key = `alt-${candidate.id}`;
    if (dedup.has(key)) continue;
    dedup.set(key, {
      ...candidate,
      id: key,
      kind: 'alternative',
      title: `Alternative ${dedup.size + 1}`,
    });
  }

  return Array.from(dedup.values()).slice(0, 3);
};

const fallbackRoute = (input: RouteRequest): RouteOption[] => {
  const geometry: Array<[number, number]> = [input.from, input.to];
  return [
    {
      id: 'fallback-direct',
      kind: 'fastest',
      title: 'Direct',
      etaMin: 1,
      distanceKm: 0,
      geometry,
      trafficLevel: 'unknown',
      trust: {
        sourceName: 'Offline fallback',
        updatedAt: new Date().toISOString(),
        connectionStatus: 'offline',
        providerId: 'fallback-direct',
      },
    },
  ];
};

export const RoutingService = {
  async getRouteOptions(input: RouteRequest): Promise<RouteOption[]> {
    const cached = await OfflineCacheService.getRoute(input.from, input.to);
    if (cached && cached.length > 0) return cached;

    const providerResult = await ProviderRouter.execute(
      [
        {
          id: 'backend-routing',
          timeoutMs: 1500,
          cooldownMs: 45_000,
          execute: backendRouting,
        },
        {
          id: 'osrm-routing',
          timeoutMs: 1600,
          cooldownMs: 30_000,
          execute: osrmRouting,
        },
      ],
      input,
      { maxRetriesPerProvider: 1 },
    );

    const baseRoutes = providerResult?.data || fallbackRoute(input);
    const shaped = shapeOptions(
      baseRoutes.map(item => ({
        ...item,
        trust: providerResult
          ? {
              ...item.trust,
              providerId: providerResult.providerId,
              connectionStatus: providerResult.connectionStatus,
            }
          : item.trust,
      })),
      input.riskPenalty,
    );

    await OfflineCacheService.saveRoute(input.from, input.to, shaped);
    return shaped;
  },

  getExternalNavigationLinks(destination: [number, number], label?: string): ExternalNavigationLinks {
    const encodedLabel = encodeURIComponent(label || 'Destination');
    const lat = destination[1];
    const lon = destination[0];

    const appleMaps = `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`;
    const googleMaps = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
    const waze = `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;

    return {
      appleMaps,
      googleMaps,
      waze,
      preferred: Platform.OS === 'ios' ? appleMaps : googleMaps,
    };
  },
};

export default RoutingService;
