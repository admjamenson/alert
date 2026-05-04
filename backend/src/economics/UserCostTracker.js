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
  operations: {},
  updatedAt: nowIso(),
});

const getTopOperationsByCost = () =>
  Array.from(OPERATION_TOTALS.entries())
    .sort((left, right) => right[1].totalCostUsd - left[1].totalCostUsd)
    .slice(0, 10)
    .map(([operation, row]) => ({
      operation,
      totalCostUsd: Number(row.totalCostUsd.toFixed(8)),
      count: row.count,
    }));

const rememberOperationCost = (operation, amountUsd) => {
  const normalizedOperation = String(operation || 'UNKNOWN')
    .trim()
    .toUpperCase();
  const current = OPERATION_TOTALS.get(normalizedOperation) || {
    totalCostUsd: 0,
    count: 0,
  };
  current.totalCostUsd += nonNegative(amountUsd);
  current.count += 1;
  OPERATION_TOTALS.set(normalizedOperation, current);
};

const shouldUseRedis = (env = process.env) => hasRedisUrl(env);

const createRedisStore = () => ({
  getJson: async key => getJsonFromRedis(key),
  setJson: async (key, value, ttlMs = 0) => setJsonToRedis(key, value, ttlMs),
});

const resolveTrackerStore = async () => {
  if (trackerStoreResolved) {
    return trackerStore;
  }

  trackerStoreResolved = true;

  if (!shouldUseRedis(process.env)) {
    trackerStoreDriver = 'memory';
    METRICS.memoryFallback = true;
    METRICS.redisAvailable = false;
    return null;
  }

  if (typeof trackerStoreFactory === 'function') {
    try {
      trackerStore = trackerStoreFactory();
      trackerStoreDriver = 'redis';
      METRICS.memoryFallback = false;
      return trackerStore;
    } catch (error) {
      noteTrackerError(error);
      trackerStore = null;
      trackerStoreDriver = 'memory';
      METRICS.memoryFallback = true;
      METRICS.redisAvailable = false;
      console.warn(
        '[economics/tracker] redis unavailable, using memory fallback',
        error?.message || 'unknown',
      );
      return null;
    }
  }

  const redisIsReady = await initRedisAvailability();
  if (!redisIsReady) {
    trackerStore = null;
    trackerStoreDriver = 'memory';
    METRICS.memoryFallback = true;
    METRICS.redisAvailable = false;
    return null;
  }

  trackerStore = createRedisStore();
  trackerStoreDriver = 'redis';
  METRICS.memoryFallback = false;
  METRICS.redisAvailable = true;
  return trackerStore;
};

const readBucket = async ({storageKey, memoryMap, subjectType, subjectKey}) => {
  const store = await resolveTrackerStore();
  if (store && trackerStoreDriver === 'redis') {
    try {
      const stored = await store.getJson(storageKey);
      METRICS.redisAvailable = true;
      METRICS.memoryFallback = false;
      if (stored && typeof stored === 'object') {
        memoryMap.set(storageKey, stored);
        return stored;
      }
    } catch (error) {
      noteTrackerError(error);
      METRICS.redisAvailable = false;
      METRICS.memoryFallback = true;
      console.warn(
        '[economics/tracker] redis read failed, using memory fallback',
        error?.message || 'unknown',
      );
    }
  }

  return (
    memoryMap.get(storageKey) ||
    buildEmptyBucket({
      subjectType,
      subjectKey,
    })
  );
};

const writeBucket = async ({storageKey, memoryMap, bucket}) => {
  memoryMap.set(storageKey, bucket);
  const store = await resolveTrackerStore();
  if (store && trackerStoreDriver === 'redis') {
    try {
      await store.setJson(storageKey, bucket, ttlUntilNextMonthMs());
      METRICS.redisAvailable = true;
      METRICS.memoryFallback = false;
      return bucket;
    } catch (error) {
      noteTrackerError(error);
      METRICS.redisAvailable = false;
      METRICS.memoryFallback = true;
      console.warn(
        '[economics/tracker] redis write failed, using memory fallback',
        error?.message || 'unknown',
      );
    }
  }
  return bucket;
};

const mutateBucket = (bucket, amountUsd, metadata = {}) => {
  const safeAmountUsd = nonNegative(amountUsd);
  const normalizedOperation = String(metadata.operation || 'UNKNOWN')
    .trim()
    .toUpperCase();
  const next = {
    ...bucket,
    totalCostUsd: Number((bucket.totalCostUsd + safeAmountUsd).toFixed(8)),
    updatedAt: nowIso(),
    operations: {
      ...(bucket.operations || {}),
      [normalizedOperation]: {
        totalCostUsd: Number(
          (
            Number(
              bucket.operations?.[normalizedOperation]?.totalCostUsd || 0,
            ) + safeAmountUsd
          ).toFixed(8),
        ),
        count: Number(bucket.operations?.[normalizedOperation]?.count || 0) + 1,
        lastTier: metadata.tier ? String(metadata.tier) : null,
        lastCriticality: metadata.criticality
          ? String(metadata.criticality)
          : null,
        updatedAt: nowIso(),
      },
    },
  };

  METRICS.totalTrackedCostUsd = Number(
    (METRICS.totalTrackedCostUsd + safeAmountUsd).toFixed(8),
  );
  rememberOperationCost(normalizedOperation, safeAmountUsd);

  return next;
};

const getUserMonthlyCost = async userIdOrKey => {
  const keyHash = sanitizeUserKey(userIdOrKey);
  TRACKED_USERS.add(keyHash);
  return readBucket({
    storageKey: buildUserStorageKey(userIdOrKey),
    memoryMap: USER_COSTS,
    subjectType: 'user',
    subjectKey: keyHash,
  });
};

const addUserMonthlyCost = async (userIdOrKey, amountUsd, metadata = {}) => {
  const keyHash = sanitizeUserKey(userIdOrKey);
  TRACKED_USERS.add(keyHash);
  const storageKey = buildUserStorageKey(userIdOrKey);
  const bucket = await readBucket({
    storageKey,
    memoryMap: USER_COSTS,
    subjectType: 'user',
    subjectKey: keyHash,
  });
  return writeBucket({
    storageKey,
    memoryMap: USER_COSTS,
    bucket: mutateBucket(bucket, amountUsd, metadata),
  });
};

const getRegionMonthlyCost = async regionKey => {
  const safeRegionKey = sanitizeRegionKey(regionKey);
  return readBucket({
    storageKey: buildRegionStorageKey(safeRegionKey),
    memoryMap: REGION_COSTS,
    subjectType: 'region',
    subjectKey: safeRegionKey,
  });
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

const getEconomicsMetrics = async () => {
  // Force Redis initialization before returning metrics
  await initRedisAvailability();

  return {
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
  };
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
