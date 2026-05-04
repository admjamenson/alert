import AsyncStorage from '@react-native-async-storage/async-storage';
import { UsageCounter } from '../../domain/cost/UsageCounter';
import { FeatureKey } from '../../domain/cost/CostTypes';

const USAGE_KEY = '@Alert:UsageCounterV1';
const WINDOW_MS = 60 * 60 * 1000;

type UsageEntry = {
  windowStartMs: number;
  count: number;
};

type UsageState = Record<string, UsageEntry>;

const loadState = async (): Promise<UsageState> => {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UsageState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persistState = async (state: UsageState) => {
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const normalizeEntry = (entry?: UsageEntry | null): UsageEntry => {
  const now = Date.now();
  if (!entry) return { windowStartMs: now, count: 0 };
  if (now - entry.windowStartMs >= WINDOW_MS) {
    return { windowStartMs: now, count: 0 };
  }
  return entry;
};

export class LocalUsageCounter implements UsageCounter {
  async increment(feature: FeatureKey): Promise<number> {
    const state = await loadState();
    const current = normalizeEntry(state[feature]);
    const next = { ...current, count: current.count + 1 };
    state[feature] = next;
    await persistState(state);
    return next.count;
  }

  async getCount(feature: FeatureKey): Promise<number> {
    const state = await loadState();
    const current = normalizeEntry(state[feature]);
    if (current !== state[feature]) {
      state[feature] = current;
      await persistState(state);
    }
    return current.count;
  }
}

export default LocalUsageCounter;
