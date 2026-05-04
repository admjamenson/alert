const crypto = require('crypto');
const {createCacheStore} = require('../platform/cache/createCacheStore');

const PREMIUM_STATUS_CACHE = new Map();
const PREMIUM_STATUS_IN_FLIGHT = new Map();

// Circuit breaker para evitar avalanche de requests ao Firestore
const ENTITLEMENT_CB_CONFIG = {
  failureThreshold: Number(
    process.env.ALERT_ENTITLEMENT_CB_FAILURE_THRESHOLD || 5,
  ),
  resetTimeout: Number(process.env.ALERT_ENTITLEMENT_CB_RESET_TIMEOUT || 30000),
  monitoringPeriod: Number(
    process.env.ALERT_ENTITLEMENT_CB_MONITORING_PERIOD || 60000,
  ),
};

const entitlementCBState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  nextAttempt: 0,
};

const shouldAllowEntitlementRequest = () => {
  const now = Date.now();
  if (entitlementCBState.state === 'CLOSED') return true;
  if (entitlementCBState.state === 'OPEN') {
    if (now >= entitlementCBState.nextAttempt) {
      entitlementCBState.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }
  // HALF_OPEN: permite apenas 1 request de teste
  return true;
};

const recordEntitlementSuccess = () => {
  entitlementCBState.failures = 0;
  entitlementCBState.state = 'CLOSED';
};

const recordEntitlementFailure = () => {
  const now = Date.now();
  entitlementCBState.failures++;
  entitlementCBState.lastFailureTime = now;

  if (entitlementCBState.failures >= ENTITLEMENT_CB_CONFIG.failureThreshold) {
    entitlementCBState.state = 'OPEN';
    entitlementCBState.nextAttempt = now + ENTITLEMENT_CB_CONFIG.resetTimeout;
    console.warn(
      `[entitlements] Circuit breaker OPENED after ${entitlementCBState.failures} failures`,
    );
  }
};

// Cache Redis para safe mode / load test
let entitlementRedisCache = null;
let entitlementRedisCacheInitialized = false;

const initEntitlementRedisCache = () => {
  if (entitlementRedisCacheInitialized) return entitlementRedisCache;
  entitlementRedisCacheInitialized = true;

  // Apenas inicializar Redis em safe mode ou se explicitamente configurado
  if (
    process.env.ALERT_LOAD_TEST_SAFE_MODE !== 'true' &&
    process.env.ALERT_ENTITLEMENT_REDIS_CACHE !== 'true'
  ) {
    return null;
  }

  try {
    entitlementRedisCache = createCacheStore({
      name: 'entitlements',
      prefix: 'alert:entitlements',
      driver: 'redis',
    });
    console.log('[entitlements] Redis cache initialized for safe mode');
  } catch (error) {
    console.warn(
      '[entitlements] Failed to initialize Redis cache, falling back to memory',
      error?.message,
    );
    entitlementRedisCache = null;
  }
  return entitlementRedisCache;
};

// Métricas internas para observabilidade
const ENTITLEMENT_METRICS = {
  cacheHits: 0,
  cacheMisses: 0,
  firestoreLookups: 0,
  billingLookups: 0,
  timeouts: 0,
  errors: 0,
  coalescedRequests: 0,
  totalRequests: 0,
  lastResetAt: Date.now(),
};

const incrementEntitlementMetric = (key, value = 1) => {
  if (ENTITLEMENT_METRICS[key] !== undefined) {
    ENTITLEMENT_METRICS[key] += value;
  }
};

const getEntitlementMetrics = () => ({
  ...ENTITLEMENT_METRICS,
  cacheHitRate:
    ENTITLEMENT_METRICS.totalRequests > 0
      ? ENTITLEMENT_METRICS.cacheHits / ENTITLEMENT_METRICS.totalRequests
      : 0,
  uptimeMs: Date.now() - ENTITLEMENT_METRICS.lastResetAt,
});

const resetEntitlementMetrics = () => {
  ENTITLEMENT_METRICS.cacheHits = 0;
  ENTITLEMENT_METRICS.cacheMisses = 0;
  ENTITLEMENT_METRICS.firestoreLookups = 0;
  ENTITLEMENT_METRICS.billingLookups = 0;
  ENTITLEMENT_METRICS.timeouts = 0;
  ENTITLEMENT_METRICS.errors = 0;
  ENTITLEMENT_METRICS.coalescedRequests = 0;
  ENTITLEMENT_METRICS.totalRequests = 0;
  ENTITLEMENT_METRICS.lastResetAt = Date.now();
};

const readPositiveInteger = (value, fallback, minValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.round(parsed));
};

const readEntitlementCacheTtlMs = () => {
  // Em safe mode, usar TTL mais agressivo (5-15min)
  if (process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true') {
    const parsed = Number(
      process.env.ALERT_ENTITLEMENT_CACHE_TTL_MS || 300_000,
    );
    return Number.isFinite(parsed)
      ? Math.max(300_000, Math.round(parsed))
      : 300_000;
  }
  return readPositiveInteger(
    process.env.ALERT_ENTITLEMENT_CACHE_TTL_MS,
    30_000,
    1_000,
  );
};

const readEntitlementLookupTimeoutMs = () =>
  readPositiveInteger(
    process.env.ALERT_ENTITLEMENT_LOOKUP_TIMEOUT_MS,
    350,
    100,
  );

const entitlementCacheKey = ({userId, deviceId}) =>
  String(userId || deviceId || 'anonymous');

const readCachedPremiumStatus = async (key, {allowExpired = false} = {}) => {
  // Tentar Redis primeiro em safe mode
  const redisCache = initEntitlementRedisCache();
  if (redisCache && typeof redisCache.getJson === 'function') {
    try {
      const cached = await redisCache.getJson(key);
      if (cached) {
        const isExpired = cached.expiresAt <= Date.now();
        if (!allowExpired && isExpired) {
          return null;
        }
        return {
          value: cached.value,
          expiresAt: cached.expiresAt,
          source: 'redis',
        };
      }
    } catch (error) {
      console.warn(
        '[entitlements] Redis cache read failed, using memory',
        error?.message,
      );
    }
  }

  // Fallback para cache em memória
  const row = PREMIUM_STATUS_CACHE.get(key);
  if (!row) return null;
  if (!allowExpired && row.expiresAt <= Date.now()) {
    PREMIUM_STATUS_CACHE.delete(key);
    return null;
  }
  return {
    value: row.value,
    expiresAt: row.expiresAt,
    source: 'memory',
  };
};

const writeCachedPremiumStatus = async (key, value) => {
  const expiresAt = Date.now() + readEntitlementCacheTtlMs();

  // Escrever no Redis primeiro em safe mode
  const redisCache = initEntitlementRedisCache();
  if (redisCache && typeof redisCache.setJson === 'function') {
    try {
      await redisCache.setJson(
        key,
        {value: Boolean(value), expiresAt},
        readEntitlementCacheTtlMs(),
      );
    } catch (error) {
      console.warn('[entitlements] Redis cache write failed', error?.message);
    }
  }

  // Também escrever no cache em memória (fallback)
  PREMIUM_STATUS_CACHE.set(key, {
    value: Boolean(value),
    expiresAt,
  });
  return Boolean(value);
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({timedOut: true}), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const fallbackPremiumStatus = ({userId, config}) =>
  Boolean(
    config?.premium?.forcedUsers?.has(userId) ||
      config?.premium?.defaultPremium,
  );

const firestoreTimeToMillis = value => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return null;
};

const stableBucket = seed => {
  const hash = crypto
    .createHash('sha256')
    .update(String(seed || ''))
    .digest();
  return hash.readUInt32BE(0) % 100;
};

const buildLimits = isPremium => ({
  monitoring: {
    maxRadiusKm: isPremium ? 80 : 35,
    maxItems: isPremium ? 180 : 90,
    refreshFloorSec: isPremium ? 20 : 60,
  },
  epidemic: {
    maxWindow: isPremium ? 'all' : '7d',
  },
  weather: {
    minRefreshSec: isPremium ? 60 : 120,
  },
});

const buildCostGates = isPremium => ({
  realtimeRiskFeed: true,
  extendedMonitoring: isPremium,
  epidemicAllWindow: isPremium,
  highFrequencyPolling: isPremium,
});

const buildReasonCodes = isPremium =>
  isPremium ? [] : ['plan_free_standard_limits'];

const isSafeMode = () => process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true';

// Safe mode: retorna entitlement determinístico sem chamar Firestore/Stripe
const getSafeModeEntitlement = ({userId, deviceId, config}) => {
  // Usa hash estável para determinar tier de forma determinística
  const bucket = stableBucket(userId);
  // 20% dos usuários recebem premium_test em safe mode
  const isPremium = bucket < 20 || config?.premium?.defaultPremium;

  return {
    isPremium,
    source: 'safe_mode',
    tier: isPremium ? 'premium_test' : 'free',
  };
};

const fetchPremiumStatus = async ({userId, deviceId, db, config}) => {
  incrementEntitlementMetric('totalRequests');

  // SAFE MODE HARD OVERRIDE: Não chamar Firestore/Stripe em safe mode
  // Retorna entitlement determinístico e cacheia
  if (isSafeMode()) {
    const cacheKey = entitlementCacheKey({userId, deviceId});
    const cached = await readCachedPremiumStatus(cacheKey);
    if (cached) {
      incrementEntitlementMetric('cacheHits');
      return cached.value;
    }

    incrementEntitlementMetric('cacheMisses');

    // Gera entitlement determinístico
    const {isPremium} = getSafeModeEntitlement({userId, deviceId, config});
    await writeCachedPremiumStatus(cacheKey, isPremium);
    recordEntitlementSuccess();
    return isPremium;
  }

  const fallback = fallbackPremiumStatus({userId, config});
  if (!db || !userId) {
    return fallback;
  }

  const cacheKey = entitlementCacheKey({userId, deviceId});
  const cached = await readCachedPremiumStatus(cacheKey);
  if (cached) {
    incrementEntitlementMetric('cacheHits');
    return cached.value;
  }

  incrementEntitlementMetric('cacheMisses');

  if (PREMIUM_STATUS_IN_FLIGHT.has(cacheKey)) {
    incrementEntitlementMetric('coalescedRequests');
    return await PREMIUM_STATUS_IN_FLIGHT.get(cacheKey);
  }

  // Verificar circuit breaker antes de fazer request ao Firestore
  if (!shouldAllowEntitlementRequest()) {
    incrementEntitlementMetric('timeouts');
    recordEntitlementFailure();
    // Fallback para cache expirado ou valor default
    const stale = await readCachedPremiumStatus(cacheKey, {allowExpired: true});
    return stale ? stale.value : fallback;
  }

  const lookupPromise = (async () => {
    try {
      const entitlementDoc = await withTimeout(
        db.collection('entitlements').doc(userId).get(),
        readEntitlementLookupTimeoutMs(),
      );

      incrementEntitlementMetric('firestoreLookups');
      if (entitlementDoc?.timedOut) {
        incrementEntitlementMetric('timeouts');
        recordEntitlementFailure();
        const stale = readCachedPremiumStatus(cacheKey, {allowExpired: true});
        return stale
          ? stale.value
          : writeCachedPremiumStatus(cacheKey, fallback);
      }

      const data = entitlementDoc.exists ? entitlementDoc.data() || {} : {};
      const plan = String(data.plan || '').toLowerCase();
      const expiresAtRaw = firestoreTimeToMillis(data.expiresAt);
      const notExpired = !expiresAtRaw || expiresAtRaw > Date.now();
      const fromDoc = plan === 'premium' && notExpired;

      const result = writeCachedPremiumStatus(cacheKey, fromDoc || fallback);
      recordEntitlementSuccess();
      return result;
    } catch (error) {
      incrementEntitlementMetric('errors');
      recordEntitlementFailure();
      const stale = readCachedPremiumStatus(cacheKey, {allowExpired: true});
      return stale ? stale.value : writeCachedPremiumStatus(cacheKey, fallback);
    }
  })();

  PREMIUM_STATUS_IN_FLIGHT.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    PREMIUM_STATUS_IN_FLIGHT.delete(cacheKey);
  }
};

const buildEntitlementSnapshot = async (
  {userId, deviceId, platform},
  {db, config},
) => {
  const safePlatform = String(platform || '').toLowerCase();
  const isPremium = await fetchPremiumStatus({userId, deviceId, db, config});
  const bucket = stableBucket(userId);
  const rollout = config?.premium?.rollout || {};

  return {
    userId,
    deviceId,
    plan: isPremium ? 'premium' : 'free',
    premium: isPremium,
    entitlements: {
      premium: isPremium,
    },
    featureFlags: {
      starlinkConnect:
        isPremium && bucket < Number(rollout.starlinkConnectPercent || 0),
      starlinkTunnelBeta:
        isPremium &&
        safePlatform === 'android' &&
        bucket < Number(rollout.starlinkTunnelPercent || 0),
      starlinkExclusive:
        isPremium &&
        safePlatform === 'android' &&
        bucket < Number(rollout.starlinkExclusivePercent || 0),
    },
    rollout: {
      starlinkConnectPercent: Number(rollout.starlinkConnectPercent || 0),
      starlinkTunnelPercent: Number(rollout.starlinkTunnelPercent || 0),
      starlinkExclusivePercent: Number(rollout.starlinkExclusivePercent || 0),
    },
    limits: buildLimits(isPremium),
    costGates: buildCostGates(isPremium),
    degradedMode: !isPremium,
    reasonCodes: buildReasonCodes(isPremium),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
};

module.exports = {
  buildEntitlementSnapshot,
  fetchPremiumStatus,
  firestoreTimeToMillis,
  stableBucket,
  getEntitlementMetrics,
  resetEntitlementMetrics,
  __dangerousResetEntitlementSnapshotCacheForTests: () => {
    PREMIUM_STATUS_CACHE.clear();
    PREMIUM_STATUS_IN_FLIGHT.clear();
    resetEntitlementMetrics();
  },
};
