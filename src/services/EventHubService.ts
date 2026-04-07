import { APP_CONFIG } from '../core/config';
import { AlertNotification } from '../types/notifications';
import {
  formatUpdatedAtDisplay,
  isInvalidFormattedDateLike,
  isNativeDateStringLike,
  normalizeToIsoDateTime,
  resolveLocale,
  resolveTimeZone,
} from '../utils/dateTimeFormat';
import { EntitlementService } from './EntitlementService';
import { CostGuard } from './cost/CostGuard';
import CostPolicy from '../domain/cost/CostPolicy';

export type CapSeverity = 'Minor' | 'Moderate' | 'Severe' | 'Extreme';
export type CapUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past';
export type CapCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely';
export type TrustTier = 'A' | 'B' | 'C';
export type PrivacyLevel = 'public' | 'aggregated' | 'trusted-only';

export type UnifiedEvent = {
  id: string;
  type: string;
  subtype: string;
  severity: CapSeverity;
  urgency: CapUrgency;
  certainty: CapCertainty;
  confidence: number;
  startTime: string;
  endTime?: string | null;
  updatedAt: string;
  geometry?: { type: string; coordinates: [number, number] } | null;
  bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  region?: { country?: string | null; admin1?: string | null; city?: string | null } | null;
  source: { name: string; trustTier: TrustTier; referenceUrl?: string };
  recommendedActions: string[];
  privacyLevel: PrivacyLevel;
};

export type MapEvent = {
  id: string;
  type: string;
  subtype: string;
  riskLevel: 0 | 1 | 2 | 3 | 4;
  severityLabel: string;
  iconKey: string;
  title: string;
  summary: string;
  updatedAtLabel: string;
  sourceLabel: string;
  geometry?: UnifiedEvent['geometry'];
  bbox?: UnifiedEvent['bbox'];
  ctas: string[];
  updatedAt: string;
  sourceUrl?: string;
};

export type HealthTopItem = {
  id: string;
  diseaseId: string;
  diseaseLabel: string;
  rank: number;
  riskScore: number;
  trend: string;
  updatedAt: string;
  source?: { name: string; url?: string } | null;
  region?: { country?: string | null };
  center?: { latitude: number; longitude: number };
  cases?: number;
};

export type EventHubProviderStatus = {
  providerId: string;
  status: string;
  ok: boolean;
  stale: boolean;
  trustTier: TrustTier;
  supportedEventTypes: string[];
};

export type EventHubMeta = {
  generatedAt?: string;
  latencyMs?: number;
  failClosed: boolean;
  cacheHit?: boolean;
  hubAvailable: boolean;
};

type EventHubResponse = {
  events?: UnifiedEvent[];
  providers?: EventHubProviderStatus[];
  meta?: {
    generatedAt?: string;
    latencyMs?: number;
    failClosed?: boolean;
    cacheHit?: boolean;
  };
};

type HealthTopResponse = {
  items?: HealthTopItem[];
  meta?: {
    generatedAt?: string;
    count?: number;
  };
};

type EventsCacheValue = {
  unifiedEvents: UnifiedEvent[];
  mapEvents: MapEvent[];
  alerts: AlertNotification[];
  providers: EventHubProviderStatus[];
  meta: EventHubMeta;
  expiresAt: number;
};

type HealthTopCacheValue = {
  items: HealthTopItem[];
  expiresAt: number;
};

const typeToIcon: Record<string, string> = {
  sos: 'shield-alert',
  pandemic: 'biohazard',
  epidemic: 'virus',
  earthquake: 'earth',
  flood: 'waves',
  storm: 'weather-lightning-rainy',
  cyclone: 'weather-hurricane',
  hurricane: 'weather-hurricane',
  tornado: 'weather-tornado',
  landslide: 'terrain',
  energy_outage: 'power-plug-off',
  water_outage: 'water-off',
  heat: 'thermometer-high',
  heatwave: 'thermometer-high',
  snowstorm: 'snowflake',
  lightning: 'weather-lightning',
  hail: 'weather-hail',
  wildfire: 'fire',
  volcano: 'volcano',
  volcanic_cloud: 'cloud-alert',
  tsunami: 'waves',
  high_tide: 'waves',
  rogue_waves: 'waves',
  sandstorm: 'weather-windy',
  dust_devils: 'weather-dust',
  downdraft: 'weather-windy',
  wind: 'weather-windy',
  wind_gust_10: 'weather-windy',
  wind_gust_50: 'weather-windy',
};

const getApiBaseUrl = () => {
  const globalOverride = (globalThis as any)?.ALERT_API_URL || (globalThis as any)?.__ALERT_API_URL__;
  const envOverride =
    typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return (globalOverride || envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const fetchJsonWithTimeout = async (url: string, timeoutMs = 1800): Promise<any | null> => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutHandle = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // no-op
        }
      }, Math.max(500, timeoutMs))
    : null;
  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const EVENTS_CACHE = new Map<string, EventsCacheValue>();
const HEALTH_TOP_CACHE = new Map<string, HealthTopCacheValue>();

const readEventsCache = (key: string) => {
  const current = EVENTS_CACHE.get(key);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    EVENTS_CACHE.delete(key);
    return null;
  }
  return current;
};

const readHealthTopCache = (key: string) => {
  const current = HEALTH_TOP_CACHE.get(key);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    HEALTH_TOP_CACHE.delete(key);
    return null;
  }
  return current;
};

const buildBboxFromPoint = (lat: number, lon: number, radiusKm = 25) => {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / Math.max(12, 111.32 * Math.cos((lat * Math.PI) / 180));
  return [
    Number((lon - lonDelta).toFixed(4)),
    Number((lat - latDelta).toFixed(4)),
    Number((lon + lonDelta).toFixed(4)),
    Number((lat + latDelta).toFixed(4)),
  ].join(',');
};

const normalizeSeverity = (severity: string): CapSeverity => {
  if (severity === 'Extreme' || severity === 'Severe' || severity === 'Moderate' || severity === 'Minor') {
    return severity;
  }
  return 'Minor';
};

const normalizeUrgency = (urgency: string): CapUrgency => {
  if (urgency === 'Immediate' || urgency === 'Expected' || urgency === 'Future' || urgency === 'Past') {
    return urgency;
  }
  return 'Expected';
};

const normalizeCertainty = (certainty: string): CapCertainty => {
  if (
    certainty === 'Observed' ||
    certainty === 'Likely' ||
    certainty === 'Possible' ||
    certainty === 'Unlikely'
  ) {
    return certainty;
  }
  return 'Possible';
};

export const riskLevelFromCap = (
  severityRaw: string,
  urgencyRaw: string,
  certaintyRaw: string,
): 0 | 1 | 2 | 3 | 4 => {
  const severity = normalizeSeverity(severityRaw);
  const urgency = normalizeUrgency(urgencyRaw);
  const certainty = normalizeCertainty(certaintyRaw);

  const bySeverity: Record<CapSeverity, number> = {
    Minor: 1,
    Moderate: 2,
    Severe: 3,
    Extreme: 4,
  };
  let value = bySeverity[severity] || 1;
  if (urgency === 'Immediate' && certainty === 'Observed') value += 1;
  if (certainty === 'Unlikely') value -= 1;
  value = Math.max(0, Math.min(4, value));
  return value as 0 | 1 | 2 | 3 | 4;
};

const normalizedEventsFromResponse = (json: EventHubResponse): UnifiedEvent[] => {
  const rows = Array.isArray(json?.events) ? json.events : [];
  return rows
    .filter(event => event && typeof event === 'object')
    .map(event => {
      const privacyLevel: PrivacyLevel =
        event.privacyLevel === 'trusted-only' || event.privacyLevel === 'aggregated'
          ? event.privacyLevel
          : 'public';

      const normalizedStartTime = normalizeToIsoDateTime(event.startTime);
      const normalizedUpdatedAt =
        normalizeToIsoDateTime(event.updatedAt || event.startTime) || '';

      return {
        ...event,
        id: String(event.id || ''),
        type: String(event.type || '').toLowerCase(),
        subtype: String(event.subtype || ''),
        severity: normalizeSeverity(event.severity),
        urgency: normalizeUrgency(event.urgency),
        certainty: normalizeCertainty(event.certainty),
        confidence: Math.max(0, Math.min(1, Number(event.confidence || 0))),
        startTime: normalizedStartTime || '',
        updatedAt: normalizedUpdatedAt,
        source: {
          name: String(event.source?.name || 'Unknown source'),
          trustTier:
            event.source?.trustTier === 'A' ||
            event.source?.trustTier === 'B' ||
            event.source?.trustTier === 'C'
              ? event.source.trustTier
              : 'C',
          referenceUrl:
            typeof event.source?.referenceUrl === 'string' ? event.source.referenceUrl : undefined,
        },
        recommendedActions: Array.isArray(event.recommendedActions)
          ? event.recommendedActions.filter(item => typeof item === 'string')
          : [],
        privacyLevel,
      };
    })
    .filter(event => event.id.length > 0 && event.type.length > 0);
};

const normalizedProvidersFromResponse = (json: EventHubResponse): EventHubProviderStatus[] => {
  const rows = Array.isArray(json?.providers) ? json.providers : [];
  return rows
    .filter(row => row && typeof row === 'object')
    .map(row => {
      const trustTier =
        row.trustTier === 'A' || row.trustTier === 'B' || row.trustTier === 'C'
          ? row.trustTier
          : 'C';
      const supportedEventTypes = Array.isArray(row.supportedEventTypes)
        ? row.supportedEventTypes
            .map(item => String(item || '').trim().toLowerCase())
            .filter(Boolean)
        : [];
      return {
        providerId: String(row.providerId || ''),
        status: String(row.status || 'unknown'),
        ok: Boolean(row.ok),
        stale: Boolean(row.stale),
        trustTier,
        supportedEventTypes,
      };
    })
    .filter(row => row.providerId.length > 0);
};

const toMapEvent = (
  event: UnifiedEvent,
  locale?: string,
  timeZone?: string,
): MapEvent => {
  const riskLevel = riskLevelFromCap(event.severity, event.urgency, event.certainty);
  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const normalizedUpdatedAt =
    normalizeToIsoDateTime(event.updatedAt || event.startTime) || '';
  const formattedUpdatedAt = normalizedUpdatedAt
    ? formatUpdatedAtDisplay(normalizedUpdatedAt, resolvedLocale, resolvedTimeZone)
    : '';
  const updatedAtLabel =
    formattedUpdatedAt &&
    !isInvalidFormattedDateLike(formattedUpdatedAt) &&
    !isNativeDateStringLike(formattedUpdatedAt)
      ? formattedUpdatedAt
      : '--';
  const sourceLabel =
    event.source?.trustTier && event.source?.trustTier !== 'A'
      ? `${event.source.name} (Trust ${event.source.trustTier})`
      : event.source.name;
  const summaryByRisk: Record<number, string> = {
    0: 'No current risk signal.',
    1: 'Low-risk signal detected.',
    2: 'Warning-level risk in your area.',
    3: 'High-risk alert. Stay cautious.',
    4: 'Critical alert. Immediate action advised.',
  };

  return {
    id: event.id,
    type: event.type,
    subtype: event.subtype,
    riskLevel,
    severityLabel: event.severity,
    iconKey: typeToIcon[event.type] || 'alert-circle-outline',
    title: event.type.replace(/_/g, ' '),
    summary: summaryByRisk[riskLevel],
    updatedAtLabel,
    sourceLabel,
    geometry: event.geometry,
    bbox: event.bbox,
    ctas: event.recommendedActions || [],
    updatedAt: normalizedUpdatedAt,
    sourceUrl: event.source.referenceUrl,
  };
};

const toAlertNotification = (event: UnifiedEvent): AlertNotification => {
  const riskLevel = riskLevelFromCap(event.severity, event.urgency, event.certainty);
  const title = event.type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  const summary =
    event.recommendedActions?.[0] ||
    (riskLevel >= 3 ? 'Critical event near your area.' : 'Relevant event in your area.');
  const lat = Number(event?.geometry?.coordinates?.[1]);
  const lon = Number(event?.geometry?.coordinates?.[0]);
  const normalizedTimestamp =
    normalizeToIsoDateTime(event.updatedAt || event.startTime) || new Date().toISOString();

  return {
    id: event.id,
    type: event.type === 'sos' ? 'sos' : 'hazard',
    title,
    summary,
    timestamp: normalizedTimestamp,
    sourceName: event.source.name,
    sourceUrl: event.source.referenceUrl,
    data: {
      kind: 'event_hub',
      eventType: event.type,
      severity: event.severity,
      urgency: event.urgency,
      certainty: event.certainty,
      confidence: event.confidence,
      trustTier: event.source.trustTier,
      location:
        Number.isFinite(lat) && Number.isFinite(lon)
          ? {
              latitude: lat,
              longitude: lon,
            }
          : undefined,
    },
  };
};

export const EventHubService = {
  async getEventsByBbox(params: {
    bbox: string;
    types?: string[];
    since?: string;
    country?: string;
    limit?: number;
    sosPublicOptIn?: boolean;
  }): Promise<{
    unifiedEvents: UnifiedEvent[];
    mapEvents: MapEvent[];
    alerts: AlertNotification[];
    providers: EventHubProviderStatus[];
    meta: EventHubMeta;
  }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      return {
        unifiedEvents: [],
        mapEvents: [],
        alerts: [],
        providers: [],
        meta: {
          failClosed: true,
          hubAvailable: false,
          cacheHit: false,
        },
      };
    }
    const entitlements = await EntitlementService.getEntitlements().catch(() => null);
    const tier = entitlements?.isPremium ? 'premium' : 'free';
    const region = params.country || 'XX';
    const recordEventHubCost = async (cacheHit: boolean) => {
      await CostGuard.record({
        feature: 'eventhub.monitoring',
        provider: 'eventhub',
        tier,
        region,
        costUsd: cacheHit ? 0 : CostPolicy.estimateCost('eventhub.monitoring'),
        ts: Date.now(),
        cacheHit,
      });
    };

    const query = new URLSearchParams();
    query.set('bbox', params.bbox);
    if (params.types && params.types.length > 0) query.set('types', params.types.join(','));
    if (params.since) query.set('since', params.since);
    if (params.country) query.set('country', params.country);
    if (Number.isFinite(params.limit as number)) query.set('limit', String(params.limit));
    if (typeof params.sosPublicOptIn === 'boolean') {
      query.set('sosPublicOptIn', params.sosPublicOptIn ? '1' : '0');
    }
    const cacheKey = query.toString();
    const cached = readEventsCache(cacheKey);
    if (cached) {
      await recordEventHubCost(true);
      return {
        unifiedEvents: cached.unifiedEvents,
        mapEvents: cached.mapEvents,
        alerts: cached.alerts,
        providers: cached.providers,
        meta: {
          ...cached.meta,
          cacheHit: true,
        },
      };
    }
    const budget = await CostGuard.evaluate({
      feature: 'eventhub.monitoring',
      provider: 'eventhub',
      tier,
      region,
    });
    if (!budget.allow) {
      return {
        unifiedEvents: [],
        mapEvents: [],
        alerts: [],
        providers: [],
        meta: {
          failClosed: true,
          hubAvailable: false,
          cacheHit: false,
        },
      };
    }

    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${trimmedBase}/v1/events?${query.toString()}`;
    try {
      const json = (await fetchJsonWithTimeout(url, 1800)) as EventHubResponse | null;
      if (!json) {
        return {
          unifiedEvents: [],
          mapEvents: [],
          alerts: [],
          providers: [],
          meta: {
            failClosed: true,
            hubAvailable: false,
            cacheHit: false,
          },
        };
      }
      const unifiedEvents = normalizedEventsFromResponse(json);
      const providers = normalizedProvidersFromResponse(json);
      const locale = resolveLocale();
      const timeZone = resolveTimeZone();
      const mapEvents = unifiedEvents.map(event => toMapEvent(event, locale, timeZone));
      const alerts = unifiedEvents.map(toAlertNotification);
      const meta: EventHubMeta = {
        failClosed: Boolean(json?.meta?.failClosed ?? true),
        hubAvailable: true,
        cacheHit: Boolean(json?.meta?.cacheHit),
        generatedAt: typeof json?.meta?.generatedAt === 'string' ? json.meta.generatedAt : undefined,
        latencyMs:
          Number.isFinite(Number(json?.meta?.latencyMs)) ? Number(json?.meta?.latencyMs) : undefined,
      };
      EVENTS_CACHE.set(cacheKey, {
        unifiedEvents,
        mapEvents,
        alerts,
        providers,
        meta,
        expiresAt: Date.now() + 20_000,
      });
      await recordEventHubCost(false);
      return { unifiedEvents, mapEvents, alerts, providers, meta };
    } catch {
      return {
        unifiedEvents: [],
        mapEvents: [],
        alerts: [],
        providers: [],
        meta: {
          failClosed: true,
          hubAvailable: false,
          cacheHit: false,
        },
      };
    }
  },

  async getEventsByLocation(params: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    types?: string[];
    since?: string;
    country?: string;
    limit?: number;
    sosPublicOptIn?: boolean;
  }): Promise<{
    unifiedEvents: UnifiedEvent[];
    mapEvents: MapEvent[];
    alerts: AlertNotification[];
    providers: EventHubProviderStatus[];
    meta: EventHubMeta;
  }> {
    const radiusKm = Number.isFinite(params.radiusKm as number) ? Number(params.radiusKm) : 35;
    const bbox = buildBboxFromPoint(params.latitude, params.longitude, radiusKm);
    return this.getEventsByBbox({
      bbox,
      types: params.types,
      since: params.since,
      country: params.country,
      limit: params.limit,
      sosPublicOptIn: params.sosPublicOptIn,
    });
  },

  async getHealthTopByLocation(params: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    country?: string;
  }): Promise<HealthTopItem[]> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];
    const entitlements = await EntitlementService.getEntitlements().catch(() => null);
    const tier = entitlements?.isPremium ? 'premium' : 'free';
    const region = params.country || 'XX';
    const recordHealthCost = async (cacheHit: boolean) => {
      await CostGuard.record({
        feature: 'eventhub.monitoring',
        provider: 'eventhub',
        tier,
        region,
        costUsd: cacheHit ? 0 : CostPolicy.estimateCost('eventhub.monitoring'),
        ts: Date.now(),
        cacheHit,
      });
    };
    const radiusKm = Number.isFinite(params.radiusKm as number) ? Number(params.radiusKm) : 35;
    const bbox = buildBboxFromPoint(params.latitude, params.longitude, radiusKm);

    const query = new URLSearchParams();
    query.set('bbox', bbox);
    if (params.country) query.set('country', params.country);
    const cacheKey = query.toString();
    const cached = readHealthTopCache(cacheKey);
    if (cached) {
      await recordHealthCost(true);
      return cached.items;
    }
    const budget = await CostGuard.evaluate({
      feature: 'eventhub.monitoring',
      provider: 'eventhub',
      tier,
      region,
    });
    if (!budget.allow) return [];

    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${trimmedBase}/v1/health/top?${query.toString()}`;
    const json = (await fetchJsonWithTimeout(url, 1800)) as HealthTopResponse | null;
    const rows = Array.isArray(json?.items) ? json.items : [];
    const items = rows
      .filter(row => row && typeof row === 'object')
      .map(row => ({
        id: String(row.id || ''),
        diseaseId: String(row.diseaseId || ''),
        diseaseLabel: String(row.diseaseLabel || ''),
        rank: Math.max(1, Math.min(3, Number(row.rank || 0))),
        riskScore: Number(row.riskScore || 0),
        trend: String(row.trend || 'flat'),
        updatedAt: String(row.updatedAt || ''),
        source:
          row.source && typeof row.source === 'object'
            ? {
                name: String(row.source.name || ''),
                url: typeof row.source.url === 'string' ? row.source.url : undefined,
              }
            : null,
        region: row.region && typeof row.region === 'object' ? row.region : undefined,
        center: row.center && typeof row.center === 'object' ? row.center : undefined,
        cases: Number.isFinite(row.cases as number) ? Number(row.cases) : undefined,
      }))
      .filter(row => row.id.length > 0 && row.rank >= 1 && row.rank <= 3)
      .sort((a, b) => a.rank - b.rank || b.riskScore - a.riskScore);
    HEALTH_TOP_CACHE.set(cacheKey, {
      items,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    await recordHealthCost(false);
    return items;
  },
};

export default EventHubService;
