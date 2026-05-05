'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

const USER_COSTS = new Map();
const REGION_COSTS = new Map();
const TRACKED_USERS = new Set();
const OPERATION_TOTALS = new Map();

const DEFAULT_METRICS = () => ({
  totalEstimatedCostUsd: 0,
  totalTrackedCostUsd: 0,
  degradedRequests: 0,
  blockedRequests: 0,
  allowedRequests: 0,
  bypassedRequests: 0,
  redisAvailable: false,
  memoryFallback: true,
  lastErrorType: null,
  redisConfigured: false,
  redisClientCreated: false,
  redisPingOk: false,
  redisLastErrorType: null,
  redisLastErrorMessageSanitized: null,
});

const METRICS = DEFAULT_METRICS();

const ECONOMICS_METRICS_CACHE_TTL_MS = 30_000;

let economicsMetricsCache = {
  snapshot: null,
  loadedAtMs: 0,
  pending: null,
};

const redisPrefix = 'economics:';
let redisClient = null;
let redisAvailable = false;
let redisInitialized = false;

function createRedisClient() {
  const url = process.env.ALERT_REDIS_URL;
  if (!url) return null;

  return new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });
}

const redis = createRedisClient();

const noteTrackerError = error => {
  METRICS.lastErrorType = String(error?.code || error?.message || 'unknown');
};

const redisKeyFor = key => `${redisPrefix}${String(key || '').trim()}`;

const getJsonFromRedis = async key => {
  const raw = await redis.get(redisKeyFor(key));
  if (!raw) return null;
  return JSON.parse(raw);
};

const setJsonToRedis = async (key, value, ttlMs = 0) => {
  if (!Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) return false;
  await redis.set(
    redisKeyFor(key),
    JSON.stringify(value),
    'PX',
    Math.max(1, Math.round(ttlMs)),
  );
  return true;
};

const initRedisAvailability = async () => {
  if (!redis) {
    METRICS.redisConfigured = false;
    METRICS.redisClientCreated = false;
    METRICS.redisPingOk = false;
    METRICS.redisAvailable = false;
    METRICS.memoryFallback = true;
    redisAvailable = false;
    redisInitialized = true;
    console.info('[ECONOMICS] Redis status:', {
      connected: false,
      fallback: true,
    });
    return false;
  }

  if (redisInitialized) {
    console.info('[ECONOMICS] Redis status:', {
      connected: redisAvailable,
      fallback: !redisAvailable,
    });
    return redisAvailable;
  }

  METRICS.redisConfigured = true;
  METRICS.redisClientCreated = true;

  try {
    await redis.ping();
    METRICS.redisPingOk = true;
    METRICS.redisAvailable = true;
    METRICS.memoryFallback = false;
    redisAvailable = true;
  } catch (e) {
    METRICS.redisPingOk = false;
    METRICS.redisAvailable = false;
    METRICS.memoryFallback = true;
    METRICS.redisLastErrorType = String(e?.code || 'unknown');
    METRICS.redisLastErrorMessageSanitized = String(e?.message || 'unknown')
      .replace(/rediss?:\/\/[^@]+@/, 'rediss://[REDACTED]@')
      .slice(0, 100);
    console.error('[ECONOMICS] Redis connection failed:', e.message);
    redisAvailable = false;
  } finally {
    redisInitialized = true;
    console.info('[ECONOMICS] Redis status:', {
      connected: redisAvailable,
      fallback: !redisAvailable,
    });
  }

  return redisAvailable;
};

let trackerStore = null;
let trackerStoreResolved = false;
let trackerStoreDriver = 'memory';
let trackerStoreFactory = null;

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nonNegative = value => Math.max(0, numberOr(value, 0));

const nowIso = () => new Date().toISOString();

const readAppEnv = (env = process.env) =>
  String(env.APP_ENV || env.NODE_ENV || 'development')
    .trim()
    .toLowerCase();

const isProductionLike = env =>
  ['staging', 'production'].includes(readAppEnv(env));

const hasRedisUrl = (env = process.env) =>
  Boolean(
    String(env.ALERT_REDIS_URL || '').trim() ||
      String(env.ALERT_CACHE_REDIS_URL || '').trim(),
  );

const monthKeyForDate = (date = new Date()) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const ttlUntilNextMonthMs = (date = new Date()) => {
  const nextMonthUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    1,
    0,
    5,
    0,
    0,
  );
  return Math.max(60_000, nextMonthUtc - date.getTime());
};

const sanitizeRegionKey = regionKey => {
  const normalized = String(regionKey || 'global')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? normalized.slice(0, 48) : 'global';
};

const sanitizeUserKey = userKey => {
  const normalized = String(userKey || 'anonymous')
    .trim()
    .toLowerCase()
    .slice(0, 256);
  return crypto
    .createHash('sha256')
    .update(normalized || 'anonymous')
    .digest('hex')
    .slice(0, 16);
};

const buildUserStorageKey = (userKey, monthKey = monthKeyForDate()) =>
  `economics:user:${sanitizeUserKey(userKey)}:${monthKey}`;

const buildRegionStorageKey = (regionKey, monthKey = monthKeyForDate()) =>
  `economics:region:${sanitizeRegionKey(regionKey)}:${monthKey}`;

const buildEmptyBucket = ({
  subjectType,
  subjectKey,
  monthKey = monthKeyForDate(),
}) => ({
  subjectType,
  subjectKey,
  monthKey,
  totalCostUsd: 0,
  operationCount: 0,
  reportCount: 0,
  reportTotalCostUsd: 0,
  lastOperationAt: null,
});

const bucketFromRedisValue = value => {
  if (!value || typeof value !== 'object') return null;
  return {
    subjectType: String(value.subjectType || ''),
    subjectKey: String(value.subjectKey || ''),
    monthKey: String(value.monthKey || monthKeyForDate()),
    totalCostUsd: nonNegative(value.totalCostUsd),
    operationCount: nonNegative(value.operationCount),
    reportCount: nonNegative(value.reportCount),
    reportTotalCostUsd: nonNegative(value.reportTotalCostUsd),
    lastOperationAt: value.lastOperationAt || null,
  };
};

const readBucket = async ({storageKey, memoryMap, subjectType, subjectKey}) => {
  // Try memory first
  if (memoryMap && memoryMap.has(storageKey)) {
    return {...memoryMap.get(storageKey)};
  }

  // Try Redis
  try {
    if (redisAvailable || !redisInitialized) {
      await initRedisAvailability();
    }
    if (redisAvailable) {
      const redisValue = await getJsonFromRedis(storageKey);
      if (redisValue) {
        const bucket = bucketFromRedisValue(redisValue);
        if (bucket) {
          if (memoryMap) memoryMap.set(storageKey, {...bucket});
          return bucket;
        }
      }
    }
  } catch (e) {
    noteTrackerError(e);
  }

  const fallbackBucket = buildEmptyBucket({subjectType, subjectKey});
  if (memoryMap) memoryMap.set(storageKey, {...fallbackBucket});
  return fallbackBucket;
};

const writeBucket = async ({
  storageKey,
  memoryMap,
  bucket,
  costPerOp = 0,
  subjectKey,
  monthKey,
}) => {
  // Always update memory
  if (memoryMap) {
    memoryMap.set(storageKey, {...bucket});
  }

  // Update aggregated metrics
  METRICS.totalTrackedCostUsd = Number(
    (METRICS.totalTrackedCostUsd + nonNegative(costPerOp)).toFixed(8),
  );

  // Async write to Redis (never block)
  try {
    if (redisAvailable || !redisInitialized) {
      initRedisAvailability().catch(() => {});
    }
    if (redisAvailable) {
      // Invalidate metrics cache when Redis state changes
      economicsMetricsCache.loadedAtMs = 0;
      setJsonToRedis(
        storageKey,
        {
          ...bucket,
          totalCostUsd: Number(bucket.totalCostUsd.toFixed(8)),
        },
        ttlUntilNextMonthMs(),
      ).catch(() => {});
    }
  } catch (e) {
    // Silently degrade — memory has the data
  }
};

const mutateBucket = (bucket, amountUsd, metadata = {}) => {
  const safeAmount = nonNegative(amountUsd);
  bucket.totalCostUsd = Number((bucket.totalCostUsd + safeAmount).toFixed(8));
  bucket.operationCount += 1;
  bucket.lastOperationAt = nowIso();
  if (metadata.reportCostUsd) {
    bucket.reportCount += 1;
    bucket.reportTotalCostUsd = Number(
      (bucket.reportTotalCostUsd + nonNegative(metadata.reportCostUsd)).toFixed(
        8,
      ),
    );
  }
  return bucket;
};

const getTopOperationsByCost = (limit = 10) => {
  const entries = Array.from(OPERATION_TOTALS.entries())
    .map(([name, cost]) => ({
      operation: String(name || 'unknown'),
      totalCostUsd: Number((cost || 0).toFixed(8)),
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 10));
  return entries;
};

const recordOperationCost = (operation, costUsd) => {
  const opKey = String(operation || 'unknown').trim();
  const current = OPERATION_TOTALS.get(opKey) || 0;
  OPERATION_TOTALS.set(
    opKey,
    Number((current + nonNegative(costUsd)).toFixed(8)),
  );
};

const resolveTrackerStore = async () => {
  if (trackerStoreResolved && trackerStore) return trackerStore;

  if (trackerStoreFactory) {
    trackerStore = trackerStoreFactory();
    trackerStoreResolved = true;
    return trackerStore;
  }

  await initRedisAvailability();

  const redisUrl =
    process.env.ALERT_REDIS_URL || process.env.ALERT_CACHE_REDIS_URL || '';

  const useRedis =
    redisUrl.length > 0 &&
    !process.env.ALERT_ECONOMICS_MEMORY_ONLY &&
    redisAvailable;

  if (useRedis) {
    trackerStoreDriver = 'redis';
    trackerStore = {
      type: 'redis',
      client: redis,
      prefix: redisPrefix,
    };
  } else {
    trackerStoreDriver = 'memory';
    trackerStore = {
      type: 'memory',
      userCosts: USER_COSTS,
      regionCosts: REGION_COSTS,
    };
  }

  trackerStoreResolved = true;
  return trackerStore;
};

const getUserMonthlyCost = async (userKey, metadata = {}) => {
  const safeKey = sanitizeUserKey(userKey);
  const storageKey = buildUserStorageKey(safeKey);
  const bucket = await readBucket({
    storageKey,
    memoryMap: USER_COSTS,
    subjectType: 'user',
    subjectKey: safeKey,
  });
  return bucket;
};

const addUserMonthlyCost = async (userKey, amountUsd, metadata = {}) => {
  const safeKey = sanitizeUserKey(userKey);
  const storageKey = buildUserStorageKey(safeKey);
  const bucket = await readBucket({
    storageKey,
    memoryMap: USER_COSTS,
    subjectType: 'user',
    subjectKey: safeKey,
  });
  const updatedBucket = mutateBucket(bucket, amountUsd, metadata);
  TRACKED_USERS.add(safeKey);
  // Write async — never block the caller
  writeBucket({
    storageKey,
    memoryMap: USER_COSTS,
    bucket: updatedBucket,
    costPerOp: amountUsd,
    subjectKey: safeKey,
    monthKey: monthKeyForDate(),
  }).catch(() => {});
  return updatedBucket;
};

const getRegionMonthlyCost = async (regionKey, metadata = {}) => {
  const safeRegionKey = sanitizeRegionKey(regionKey);
  const storageKey = buildRegionStorageKey(safeRegionKey);
  const bucket = await readBucket({
    storageKey,
    memoryMap: REGION_COSTS,
    subjectType: 'region',
    subjectKey: safeRegionKey,
  });
  return bucket;
};

const addRegionMonthlyCost = async (regionKey, amountUsd, metadata = {}) => {
  const safeRegionKey = sanitizeRegionKey(regionKey);
  const storageKey = buildRegionStorageKey(safeRegionKey);
  const bucket = await readBucket({
    storageKey,
    memoryMap: REGION_COSTS,
    subjectType: 'region',
    subjectKey: safeRegionKey,
  });
  return writeBucket({
    storageKey,
    memoryMap: REGION_COSTS,
    bucket: mutateBucket(bucket, amountUsd, metadata),
  });
};

const recordEconomicsDecision = ({decision, estimatedCostUsd = 0} = {}) => {
  const safeDecision = String(decision || '')
    .trim()
    .toLowerCase();
  const safeEstimatedCostUsd = nonNegative(estimatedCostUsd);
  METRICS.totalEstimatedCostUsd = Number(
    (METRICS.totalEstimatedCostUsd + safeEstimatedCostUsd).toFixed(8),
  );

  if (safeDecision === 'allowed') {
    METRICS.allowedRequests += 1;
  } else if (safeDecision === 'degraded') {
    METRICS.degradedRequests += 1;
  } else if (safeDecision === 'blocked') {
    METRICS.blockedRequests += 1;
  } else if (safeDecision === 'bypassed') {
    METRICS.bypassedRequests += 1;
  }
};

/**
 * Build economics metrics from in-memory data only — no Redis round-trip.
 * Caches the snapshot for ECONOMICS_METRICS_CACHE_TTL_MS to avoid
 * blocking hot-path endpoints like /v1/ops/summary and /metrics.
 */
const buildEconomicsMetricsSnapshot = () => ({
  totalEstimatedCostUsd: Number(METRICS.totalEstimatedCostUsd.toFixed(8)),
  totalTrackedCostUsd: Number(METRICS.totalTrackedCostUsd.toFixed(8)),
  trackedUsers: TRACKED_USERS.size,
  degradedRequests: METRICS.degradedRequests,
  blockedRequests: METRICS.blockedRequests,
  allowedRequests: METRICS.allowedRequests,
  bypassedRequests: METRICS.bypassedRequests,
  redisAvailable: METRICS.redisAvailable,
  memoryFallback: METRICS.memoryFallback,
  lastErrorType: METRICS.lastErrorType,
  redisConfigured: METRICS.redisConfigured,
  redisClientCreated: METRICS.redisClientCreated,
  redisPingOk: METRICS.redisPingOk,
  redisLastErrorType: METRICS.redisLastErrorType,
  redisLastErrorMessageSanitized: METRICS.redisLastErrorMessageSanitized,
  topOperationsByCost: getTopOperationsByCost(),
});

const getEconomicsMetrics = async () => {
  const nowMs = Date.now();

  // Return cached snapshot if still fresh
  if (
    economicsMetricsCache.snapshot &&
    nowMs - economicsMetricsCache.loadedAtMs < ECONOMICS_METRICS_CACHE_TTL_MS
  ) {
    return economicsMetricsCache.snapshot;
  }

  // Deduplicate concurrent calls: if a refresh is already in-flight, wait for it
  if (economicsMetricsCache.pending) {
    return economicsMetricsCache.pending;
  }

  // Start async refresh — build from memory immediately, refresh Redis in background
  const snapshot = buildEconomicsMetricsSnapshot();
  economicsMetricsCache.snapshot = snapshot;
  economicsMetricsCache.loadedAtMs = nowMs;

  // Background Redis refresh (never blocks the caller)
  economicsMetricsCache.pending = (async () => {
    try {
      await initRedisAvailability();
      // Update cache with any new Redis-derived state
      economicsMetricsCache.snapshot = buildEconomicsMetricsSnapshot();
      economicsMetricsCache.loadedAtMs = Date.now();
    } catch (error) {
      console.error('[ECONOMICS] Background Redis refresh failed', error);
      // Snapshot from memory remains valid
    } finally {
      economicsMetricsCache.pending = null;
    }
  })();

  return snapshot;
};

const getEconomicsTrackerHealth = () => ({
  driver: trackerStoreDriver,
  redisAvailable: METRICS.redisAvailable,
  memoryFallback: METRICS.memoryFallback,
  lastErrorType: METRICS.lastErrorType,
  trackedUsers: TRACKED_USERS.size,
  topOperationsByCost: getTopOperationsByCost(),
});

const __dangerousResetEconomicsTrackerForTests = () => {
  USER_COSTS.clear();
  REGION_COSTS.clear();
  TRACKED_USERS.clear();
  OPERATION_TOTALS.clear();
  Object.assign(METRICS, DEFAULT_METRICS());
  trackerStore = null;
  trackerStoreResolved = false;
  trackerStoreDriver = 'memory';
  trackerStoreFactory = null;
  economicsMetricsCache.snapshot = null;
  economicsMetricsCache.loadedAtMs = 0;
  economicsMetricsCache.pending = null;
};

const __dangerousSetTrackerStoreFactoryForTests = factory => {
  trackerStoreFactory = factory;
  trackerStore = null;
  trackerStoreResolved = false;
};

module.exports = {
  getUserMonthlyCost,
  addUserMonthlyCost,
  getRegionMonthlyCost,
  addRegionMonthlyCost,
  getEconomicsTrackerHealth,
  getEconomicsMetrics,
  recordEconomicsDecision,
  sanitizeUserKey,
  sanitizeRegionKey,
  monthKeyForDate,
  __dangerousResetEconomicsTrackerForTests,
  __dangerousSetTrackerStoreFactoryForTests,
};
