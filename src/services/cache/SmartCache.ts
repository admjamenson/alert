type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
  staleAtMs: number;
};

const STORE = new Map<string, CacheEntry<unknown>>();

const nowMs = () => Date.now();

export const SmartCache = {
  get<T>(key: string): T | null {
    const entry = STORE.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs()) {
      STORE.delete(key);
      return null;
    }
    return entry.value;
  },

  getWithStale<T>(
    key: string,
  ): { value: T; stale: boolean } | null {
    const entry = STORE.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs()) {
      STORE.delete(key);
      return null;
    }
    return {
      value: entry.value,
      stale: entry.staleAtMs <= nowMs(),
    };
  },

  set<T>(key: string, value: T, ttlMs: number, staleWhileRevalidateMs = 0) {
    const safeTtlMs = Math.max(1_000, Math.floor(ttlMs));
    const staleAtMs = nowMs() + Math.max(0, Math.floor(staleWhileRevalidateMs));
    STORE.set(key, {
      value,
      staleAtMs,
      expiresAtMs: nowMs() + safeTtlMs,
    });
  },

  clear(prefix?: string) {
    if (!prefix) {
      STORE.clear();
      return;
    }
    Array.from(STORE.keys()).forEach(key => {
      if (key.startsWith(prefix)) STORE.delete(key);
    });
  },
};

export default SmartCache;
