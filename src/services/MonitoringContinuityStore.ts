import AsyncStorage from '@react-native-async-storage/async-storage';

import { AlertSignal } from '../types/alertIntelligence';

export type ContinuityScope = 'CITY' | 'STATE' | 'COUNTRY';
export type ContinuityStatus = 'active' | 'none' | 'loading' | 'unavailable';
export type ContinuityTrustStatus = 'online' | 'stale' | 'offline' | 'unavailable';
export type ContinuitySourceOfficiality =
  | 'OFFICIAL'
  | 'VERIFIED'
  | 'REFERENCE'
  | 'TRUSTED_MEDIA'
  | 'TRUSTED_SOCIAL'
  | 'COMMUNITY'
  | 'ESTIMATED';

export type ContinuitySource = {
  name: string;
  url?: string;
  officiality: ContinuitySourceOfficiality;
};

export type MonitoringContinuitySnapshot = {
  version: 1;
  savedAt: string;
  eventType: string;
  scope: ContinuityScope;
  regionKey: string;
  status: ContinuityStatus;
  trustStatus: ContinuityTrustStatus;
  summary: string;
  sourceLine: string;
  sourceTrustTier?: 'A' | 'B' | 'C' | '';
  sourceUrl?: string;
  sources: ContinuitySource[];
  sourcesFallback: boolean;
  updatedAt?: string;
  aiSummary?: string;
  aiConflict?: boolean;
  evidenceLinks?: string[];
  aiSignals: AlertSignal[];
  officialPoints: {
    type: 'FeatureCollection';
    features: Array<Record<string, any>>;
  };
  sosPoints: {
    type: 'FeatureCollection';
    features: Array<Record<string, any>>;
  };
  windPanels?: Array<Record<string, any>>;
  pandemicTop3?: Array<Record<string, any>>;
};

export type ContinuityReadResult = {
  snapshot: MonitoringContinuitySnapshot;
  ageMs: number;
  freshness: 'fresh' | 'stale';
  source: 'regional' | 'latest';
};

const STORAGE_PREFIX = '@Alert:MonitoringContinuity:v1';

const METEO_FAST_TYPES = new Set([
  'wind',
  'gale',
  'wind_gust_10',
  'wind_gust_50',
  'storm',
  'lightning',
  'cyclone',
  'hurricane',
  'tornado',
  'sandstorm',
  'fog',
  'hail',
  'high_tide',
  'water_outage',
  'energy_outage',
]);

const GEO_MEDIUM_TYPES = new Set([
  'earthquake',
  'landslide',
  'volcano',
  'tsunami',
  'wildfire',
  'avalanche',
  'meteor',
  'sos_nearby',
]);

const HEALTH_SLOW_TYPES = new Set(['pandemic', 'epidemic', 'drought', 'heatwave', 'heat']);

const precisionByScope: Record<ContinuityScope, number> = {
  CITY: 2,
  STATE: 1,
  COUNTRY: 0,
};

const normalizeType = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase() || 'unknown';

const parseJson = (value: string | null): MonitoringContinuitySnapshot | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MonitoringContinuitySnapshot;
    if (!parsed || parsed.version !== 1) return null;
    if (!parsed.eventType || !parsed.scope || !parsed.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

const getTtlMs = (eventType: string): number => {
  const type = normalizeType(eventType);
  if (METEO_FAST_TYPES.has(type)) return 30 * 60 * 1000;
  if (GEO_MEDIUM_TYPES.has(type)) return 2 * 60 * 60 * 1000;
  if (HEALTH_SLOW_TYPES.has(type)) return 6 * 60 * 60 * 1000;
  return 90 * 60 * 1000;
};

const buildRegionKey = (
  scope: ContinuityScope,
  latitude?: number | null,
  longitude?: number | null,
) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return `${scope}:global`;
  }
  const precision = precisionByScope[scope] ?? 1;
  return `${scope}:${Number(latitude).toFixed(precision)}:${Number(longitude).toFixed(precision)}`;
};

const buildRegionalStorageKey = (
  eventType: string,
  scope: ContinuityScope,
  latitude?: number | null,
  longitude?: number | null,
) => {
  const type = normalizeType(eventType);
  const regionKey = buildRegionKey(scope, latitude, longitude);
  return `${STORAGE_PREFIX}:${type}:${regionKey}`;
};

const buildLatestStorageKey = (eventType: string) =>
  `${STORAGE_PREFIX}:latest:${normalizeType(eventType)}`;

const toAgeMs = (savedAt?: string): number => {
  const parsed = Date.parse(String(savedAt || ''));
  if (!Number.isFinite(parsed)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Date.now() - parsed);
};

export const MonitoringContinuityStore = {
  async saveSnapshot(
    input: Omit<MonitoringContinuitySnapshot, 'version' | 'savedAt' | 'regionKey'> & {
      latitude?: number | null;
      longitude?: number | null;
    },
  ): Promise<void> {
    const regionKey = buildRegionKey(input.scope, input.latitude, input.longitude);
    const payload: MonitoringContinuitySnapshot = {
      ...input,
      version: 1,
      savedAt: new Date().toISOString(),
      regionKey,
    };
    const regionalKey = buildRegionalStorageKey(
      input.eventType,
      input.scope,
      input.latitude,
      input.longitude,
    );
    const latestKey = buildLatestStorageKey(input.eventType);
    const raw = JSON.stringify(payload);
    await Promise.allSettled([
      AsyncStorage.setItem(regionalKey, raw),
      AsyncStorage.setItem(latestKey, raw),
    ]);
  },

  async readSnapshot(params: {
    eventType: string;
    scope: ContinuityScope;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<ContinuityReadResult | null> {
    const regionalKey = buildRegionalStorageKey(
      params.eventType,
      params.scope,
      params.latitude,
      params.longitude,
    );
    const latestKey = buildLatestStorageKey(params.eventType);
    const [regionalRaw, latestRaw] = await Promise.all([
      AsyncStorage.getItem(regionalKey),
      AsyncStorage.getItem(latestKey),
    ]);
    const regional = parseJson(regionalRaw);
    const latest = parseJson(latestRaw);
    const regionalAge = toAgeMs(regional?.savedAt);
    const latestAge = toAgeMs(latest?.savedAt);
    const candidate =
      regional && regionalAge <= latestAge
        ? { snapshot: regional, source: 'regional' as const, ageMs: regionalAge }
        : latest
          ? { snapshot: latest, source: 'latest' as const, ageMs: latestAge }
          : null;
    if (!candidate) return null;
    const ttlMs = getTtlMs(candidate.snapshot.eventType);
    return {
      snapshot: candidate.snapshot,
      ageMs: candidate.ageMs,
      freshness: candidate.ageMs <= ttlMs ? 'fresh' : 'stale',
      source: candidate.source,
    };
  },
};

export default MonitoringContinuityStore;
