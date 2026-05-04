import { Platform } from 'react-native';

import { getAlertApiBaseUrl } from '../../core/config';
import type {
  RouteAdvisory,
  RouteMode,
  RoutePrecision,
} from '../../domain/route/RouteModels';
import OfflineCacheService from './OfflineCacheService';
import ProviderRouter from './ProviderRouter';
import { RouteOption, RouteRequest, TrustMeta } from './types';
import { buildAlertIdentityHeaders } from '../../infrastructure/http/AlertIdentityHeaders';

type BackendRoute = {
  id?: string;
  title?: string;
  distanceMeters?: number;
  durationSec?: number;
  geometry?: Array<[number, number]>;
  trafficLevel?: 'low' | 'medium' | 'high' | 'unknown';
  safetyScore?: number;
};

type BackendProviderMeta = {
  id?: string;
  available?: boolean;
  degraded?: boolean;
  reasonCode?: string | null;
};

type BackendResponse = {
  available?: boolean;
  degraded?: boolean;
  reasonCode?: string | null;
  retryable?: boolean;
  fallbackUsed?: boolean;
  routeMode?: RouteMode;
  precision?: RoutePrecision;
  providerAvailable?: boolean;
  advisory?: RouteAdvisory | null;
  routes?: BackendRoute[];
  provider?: BackendProviderMeta;
  source?: string;
  updatedAt?: string;
};

export type ExternalNavigationLinks = {
  appleMaps: string;
  googleMaps: string;
  waze: string;
  preferred: string;
};

const getApiBaseUrl = () => getAlertApiBaseUrl();

const calcDistanceKm = (meters: number | undefined) =>
  Number.isFinite(meters) ? Math.round((Number(meters) / 1000) * 10) / 10 : 0;

const calcEtaMin = (seconds: number | undefined) => {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(1, Math.round(Number(seconds) / 60));
};

const toRouteMode = (value: BackendResponse['routeMode'], degraded: boolean): RouteMode => {
  if (value === 'provider' || value === 'estimated_straight_line' || value === 'unavailable') {
    return value;
  }
  return degraded ? 'estimated_straight_line' : 'provider';
};

const toRoutePrecision = (
  value: BackendResponse['precision'],
  routeMode: RouteMode,
): RoutePrecision => {
  if (value === 'high' || value === 'low' || value === 'none') {
    return value;
  }
  if (routeMode === 'estimated_straight_line') return 'low';
  if (routeMode === 'unavailable') return 'none';
  return 'high';
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
    `&mode=${encodeURIComponent(String(input.transportMode || 'car'))}` +
    `&locale=${encodeURIComponent(input.locale)}` +
    (input.worldview ? `&worldview=${encodeURIComponent(input.worldview)}` : '');

  const identityHeaders = await buildAlertIdentityHeaders().catch(() => ({}));
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...identityHeaders,
    },
  });
  if (!res.ok) return null;

  const json = (await res.json()) as BackendResponse;
  const isDegraded = Boolean(json?.degraded || json?.fallbackUsed || json?.provider?.degraded);
  const routeMode = toRouteMode(json?.routeMode, isDegraded);
  const precision = toRoutePrecision(json?.precision, routeMode);
  const providerAvailable =
    typeof json?.providerAvailable === 'boolean'
      ? json.providerAvailable
      : typeof json?.provider?.available === 'boolean'
        ? json.provider.available
        : !isDegraded;
  const advisory = json?.advisory || null;
  if (routeMode === 'unavailable') return null;
  const rows = Array.isArray(json?.routes) ? json.routes : [];
  if (rows.length === 0) return null;
  const providerId = json?.fallbackUsed
    ? 'backend-routing-fallback'
    : json?.provider?.id
    ? `backend-routing:${json.provider.id}`
    : 'backend-routing';

  const trust: TrustMeta = {
    sourceName: json?.source || 'Alert Routing',
    updatedAt: json?.updatedAt || new Date().toISOString(),
    connectionStatus: isDegraded ? 'degraded' : 'online',
    providerId,
  };

  const mapped = rows
    .map((route, index) => {
      const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
      if (geometry.length < 2) return null;

      return {
        id: String(route?.id || `backend-${index}`),
        kind: 'alternative',
        title:
          typeof route?.title === 'string' && route.title.trim().length > 0
            ? route.title.trim()
            : routeMode === 'estimated_straight_line'
            ? 'Estimated direction'
            : index === 0
            ? 'Fastest'
            : `Alternative ${index}`,
        etaMin: calcEtaMin(route.durationSec),
        distanceKm: calcDistanceKm(route.distanceMeters),
        geometry,
        safetyScore: Number.isFinite(route?.safetyScore) ? Number(route?.safetyScore) : undefined,
        trafficLevel: route?.trafficLevel || 'unknown',
        trust,
        routeMode,
        precision,
        degraded: isDegraded,
        providerAvailable,
        providerId,
        reasonCode: json?.reasonCode || null,
        advisory,
      };
    })
    .filter(Boolean) as RouteOption[];

  return mapped.length > 0 ? mapped : null;
};

const shapeOptions = (routes: RouteOption[], riskPenalty = 0): RouteOption[] => {
  if (routes.length === 0) return [];
  const hasNonProviderRoute = routes.some(route => route.routeMode !== 'provider');
  if (hasNonProviderRoute) {
    return routes.slice(0, 1).map(route => ({
      ...route,
      kind: 'alternative',
      title:
        route.routeMode === 'estimated_straight_line'
          ? route.title || 'Estimated direction'
          : route.title || 'Route unavailable',
    }));
  }

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

export const RoutingService = {
  async getRouteOptions(input: RouteRequest): Promise<RouteOption[]> {
    const cached = await OfflineCacheService.getRoute(input.from, input.to);
    if (cached && cached.length > 0) return cached;

    const providerResult = await ProviderRouter.execute(
      [
        {
          id: 'backend-routing',
          timeoutMs: 2200,
          cooldownMs: 45_000,
          execute: backendRouting,
        },
      ],
      input,
      { maxRetriesPerProvider: 1 },
    );

    const baseRoutes = Array.isArray(providerResult?.data) ? providerResult.data : [];
    if (baseRoutes.length === 0) return [];
    const shaped = shapeOptions(
      baseRoutes.map(item => ({
        ...item,
        trust: providerResult
          ? {
              ...item.trust,
              providerId: item.providerId || providerResult.providerId,
              connectionStatus:
                item.routeMode === 'provider'
                  ? providerResult.connectionStatus
                  : 'degraded',
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
