import AsyncStorage from '@react-native-async-storage/async-storage';
import { AdPlacementId } from './placements';
import { FrequencyCapRule } from '../config/remoteConfig/adsConfig';

const STORAGE_KEY = '@Alert:AdsFrequencyCapsV1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type CapStore = Partial<Record<AdPlacementId, number[]>>;

type CapDecision = {
  allowed: boolean;
  reason?:
    | 'blocked_by_min_interval'
    | 'blocked_by_session_cap'
    | 'blocked_by_hour_cap'
    | 'blocked_by_day_cap';
};

let sessionCounts: Partial<Record<AdPlacementId, number>> = {};
let storeCache: CapStore | null = null;
let loadingPromise: Promise<CapStore> | null = null;

const normalizeTimestamps = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);
};

const pruneHistory = (timestamps: number[], nowMs: number) =>
  timestamps.filter(ts => nowMs - ts <= DAY_MS);

const loadStore = async (): Promise<CapStore> => {
  if (storeCache) return storeCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as CapStore) : {};
      const normalized: CapStore = {};
      Object.entries(parsed || {}).forEach(([placementId, values]) => {
        normalized[placementId as AdPlacementId] = normalizeTimestamps(values);
      });
      storeCache = normalized;
      return normalized;
    } catch {
      storeCache = {};
      return {};
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
};

const persistStore = async (nextStore: CapStore) => {
  storeCache = nextStore;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
  } catch {
    // fail-soft: caps continue in memory for this session
  }
};

export const FrequencyCapManager = {
  resetSession() {
    sessionCounts = {};
  },

  async canShow(
    placementId: AdPlacementId,
    rule: FrequencyCapRule,
    nowMs: number = Date.now(),
  ): Promise<CapDecision> {
    const store = await loadStore();
    const history = pruneHistory(store[placementId] || [], nowMs);
    const minIntervalMs = Math.max(0, rule.minIntervalSec) * 1000;
    const lastShownAt = history.length > 0 ? history[history.length - 1] : 0;
    if (minIntervalMs > 0 && lastShownAt > 0 && nowMs - lastShownAt < minIntervalMs) {
      return { allowed: false, reason: 'blocked_by_min_interval' };
    }

    const sessionCount = sessionCounts[placementId] || 0;
    if (rule.perSession >= 0 && sessionCount >= rule.perSession) {
      return { allowed: false, reason: 'blocked_by_session_cap' };
    }

    const hourlyCount = history.filter(ts => nowMs - ts <= HOUR_MS).length;
    if (rule.perHour >= 0 && hourlyCount >= rule.perHour) {
      return { allowed: false, reason: 'blocked_by_hour_cap' };
    }

    const dailyCount = history.filter(ts => nowMs - ts <= DAY_MS).length;
    if (rule.perDay >= 0 && dailyCount >= rule.perDay) {
      return { allowed: false, reason: 'blocked_by_day_cap' };
    }

    return { allowed: true };
  },

  async markShown(placementId: AdPlacementId, atMs: number = Date.now()): Promise<void> {
    const store = await loadStore();
    const history = pruneHistory(store[placementId] || [], atMs);
    const nextHistory = [...history, atMs];
    const nextStore: CapStore = {
      ...store,
      [placementId]: nextHistory,
    };
    await persistStore(nextStore);
    sessionCounts[placementId] = (sessionCounts[placementId] || 0) + 1;
  },

  async getDebugSnapshot() {
    const store = await loadStore();
    return {
      sessionCounts: { ...sessionCounts },
      persistedCounts: Object.fromEntries(
        Object.entries(store).map(([placementId, timestamps]) => [
          placementId,
          normalizeTimestamps(timestamps).length,
        ]),
      ),
    };
  },
};

export default FrequencyCapManager;
