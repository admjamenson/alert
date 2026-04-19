const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createInMemoryCacheStore = ({
  name = 'memory',
  maxEntries = numberOr(process.env.ALERT_CACHE_MAX_ENTRIES, 2000),
} = {}) => {
  const rows = new Map();
  const metrics = {
    name,
    driver: 'memory',
    get: 0,
    hit: 0,
    miss: 0,
    set: 0,
    delete: 0,
    evicted: 0,
  };

  const prune = () => {
    while (rows.size > Math.max(1, maxEntries)) {
      const oldestKey = rows.keys().next().value;
      if (!oldestKey) break;
      rows.delete(oldestKey);
      metrics.evicted += 1;
    }
  };

  const getJson = async key => {
    const normalizedKey = String(key || '').trim();
    metrics.get += 1;
    const row = rows.get(normalizedKey);
    if (!row || row.expiresAt <= Date.now()) {
      if (row) rows.delete(normalizedKey);
      metrics.miss += 1;
      return null;
    }
    rows.delete(normalizedKey);
    rows.set(normalizedKey, row);
    metrics.hit += 1;
    return row.value;
  };

  const setJson = async (key, value, ttlMs = 0) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || !Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) {
      return false;
    }
    rows.set(normalizedKey, {
      value,
      expiresAt: Date.now() + Number(ttlMs),
    });
    metrics.set += 1;
    prune();
    return true;
  };

  const deleteKey = async key => {
    metrics.delete += 1;
    return rows.delete(String(key || '').trim());
  };

  const snapshot = () => ({
    ...metrics,
    entries: rows.size,
    maxEntries,
    external: false,
  });

  return {
    getJson,
    setJson,
    delete: deleteKey,
    snapshot,
    close: async () => {},
  };
};

module.exports = {
  createInMemoryCacheStore,
};
