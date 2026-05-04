import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '../i18n';
import { normalizeToIsoDateTime } from '../utils/dateTimeFormat';
import {
  AlertFeedsApiAdapter,
  type BackendEpidemicSnapshot,
} from '../infrastructure/adapters/AlertFeedsApiAdapter';

export type EpidemicWindow = '7d' | 'all';
export type EpidemicMode = 'pandemic' | 'epidemic';

export type EpidemicSource = {
  name: string;
  url: string;
  tier: 1 | 2 | 3;
  authorityLevel: 'WHO' | 'federal' | 'state' | 'municipal';
};

export type EpidemicLevel = {
  name: string;
  cases: number | null;
  deaths: number | null;
};

export type EpidemicSnapshot = {
  enabled: boolean;
  disease: { id: string; name: string };
  mode?: EpidemicMode;
  window: EpidemicWindow;
  country: EpidemicLevel;
  state: EpidemicLevel;
  municipal: EpidemicLevel;
  asOf: string;
  fetchedAt: string;
  stalenessSec: number;
  status: 'FRESH' | 'STALE' | 'UNKNOWN';
  sources: EpidemicSource[];
  message?: string;
};

type CacheEntry = {
  ts: number;
  data: EpidemicSnapshot;
};

const CACHE_PREFIX = '@Alert:Epidemic:v2:';
const CACHE_TTL_MS = 10 * 60 * 1000;

const MODE_DISEASE: Record<EpidemicMode, { id: string; name: string }> = {
  pandemic: { id: 'covid19', name: 'COVID-19' },
  epidemic: { id: 'influenza', name: 'Influenza' },
};

const safeNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const safeText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

const translateEpidemicMessage = (
  key: 'map_no_location' | 'epidemic_map_no_feed',
  fallback: string,
): string =>
  i18n.t(key, {
    defaultValue: fallback,
  });

const mapFeedToSnapshot = (
  feed: BackendEpidemicSnapshot,
  window: EpidemicWindow,
  fallbackDisease: { id: string; name: string },
  mode: EpidemicMode,
): EpidemicSnapshot => {
  const normalizedAsOf = normalizeToIsoDateTime(feed?.freshness?.asOf);
  const normalizedFetchedAt =
    normalizeToIsoDateTime(feed?.freshness?.fetchedAt) ||
    new Date().toISOString();

  return {
    enabled: Boolean(feed?.available),
    disease: feed?.disease || fallbackDisease,
    mode,
    window,
    country: {
      name: safeText(feed?.rollups?.country?.name, 'Country'),
      cases: safeNumber(feed?.rollups?.country?.metrics?.cases),
      deaths: safeNumber(feed?.rollups?.country?.metrics?.deaths),
    },
    state: {
      name: safeText(feed?.rollups?.state?.name, 'State'),
      cases: safeNumber(feed?.rollups?.state?.metrics?.cases),
      deaths: safeNumber(feed?.rollups?.state?.metrics?.deaths),
    },
    municipal: {
      name: safeText(feed?.rollups?.municipal?.name, 'City'),
      cases: safeNumber(feed?.rollups?.municipal?.metrics?.cases),
      deaths: safeNumber(feed?.rollups?.municipal?.metrics?.deaths),
    },
    asOf: normalizedAsOf,
    fetchedAt: normalizedFetchedAt,
    stalenessSec: Number.isFinite(feed?.freshness?.stalenessSec)
      ? Number(feed.freshness?.stalenessSec)
      : 0,
    status: feed?.freshness?.status || 'UNKNOWN',
    sources: Array.isArray(feed?.sources) ? feed.sources : [],
    message:
      feed?.available === false
        ? translateEpidemicMessage(
            'epidemic_map_no_feed',
            'No official epidemic feed configured yet.',
          )
        : undefined,
  };
};

const buildUnavailableSnapshot = (
  disease: { id: string; name: string },
  mode: EpidemicMode,
  window: EpidemicWindow,
  message = translateEpidemicMessage(
    'map_no_location',
    'Location unavailable.',
  ),
): EpidemicSnapshot => ({
  enabled: false,
  disease,
  mode,
  window,
  country: { name: 'Country', cases: null, deaths: null },
  state: { name: 'State', cases: null, deaths: null },
  municipal: { name: 'City', cases: null, deaths: null },
  asOf: '',
  fetchedAt: new Date().toISOString(),
  stalenessSec: 0,
  status: 'UNKNOWN',
  sources: [],
  message,
});

export const EpidemicService = {
  async getSnapshot(
    lat: number,
    lon: number,
    mode: EpidemicMode,
    window: EpidemicWindow,
    options?: { force?: boolean },
  ): Promise<EpidemicSnapshot> {
    const disease = MODE_DISEASE[mode];
    const safeLat = Number(lat);
    const safeLon = Number(lon);

    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
      return buildUnavailableSnapshot(disease, mode, window);
    }

    const cacheKey = `${CACHE_PREFIX}${mode}:${safeLat.toFixed(3)}:${safeLon.toFixed(3)}:${window}`;

    if (!options?.force) {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as CacheEntry;
          if (cached?.ts && cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
            return {
              ...cached.data,
              stalenessSec: Math.max(
                0,
                Math.floor((Date.now() - cached.ts) / 1000),
              ),
            };
          }
        }
      } catch {
        // ignore cache failures
      }
    }

    try {
      const backendFeed = await AlertFeedsApiAdapter.getEpidemicFeed({
        latitude: safeLat,
        longitude: safeLon,
        mode,
        window,
      });
      const mapped = mapFeedToSnapshot(backendFeed, window, disease, mode);
      const entry: CacheEntry = { ts: Date.now(), data: mapped };
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      return mapped;
    } catch {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as CacheEntry;
          if (cached?.data) {
            return {
              ...cached.data,
              stalenessSec: Math.max(
                0,
                Math.floor((Date.now() - Number(cached.ts || 0)) / 1000),
              ),
            };
          }
        }
      } catch {
        // ignore cache failures
      }
      return buildUnavailableSnapshot(
        disease,
        mode,
        window,
        translateEpidemicMessage(
          'epidemic_map_no_feed',
          'No official epidemic feed configured yet.',
        ),
      );
    }
  },

  async getCovidSnapshot(
    lat: number,
    lon: number,
    window: EpidemicWindow,
    options?: { force?: boolean },
  ): Promise<EpidemicSnapshot> {
    return this.getSnapshot(lat, lon, 'pandemic', window, options);
  },
};
