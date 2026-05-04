const {EventHubService} = require('../eventHub/EventHubService');
const {bboxFromPoint, nowIso} = require('../eventHub/utils');
const {createCacheStore} = require('../platform/cache/createCacheStore');

const DEFAULT_RISK_FEED_TYPES = [
  'sos',
  'earthquake',
  'flood',
  'cyclone',
  'hurricane',
  'storm',
  'wildfire',
  'volcano',
  'tsunami',
  'drought',
  'high_tide',
  'rogue_waves',
  'sandstorm',
  'dust_devils',
  'downdraft',
  'heat',
  'heatwave',
  'snowstorm',
  'lightning',
  'hail',
  'gale',
  'wind',
  'wind_gust_10',
  'wind_gust_50',
  'energy_outage',
  'water_outage',
];

const HOT_PATH_PROVIDER_IDS = [
  'community_alert_sos',
  'geophysical_usgs',
  'meteo_nowcast_openmeteo',
  'infra_outages',
];

const RISK_FEED_CACHE = new Map();
const RISK_FEED_INFLIGHT = new Map();
const MAX_RISK_FEED_CACHE_ENTRIES = Math.max(
  50,
  Number(process.env.ALERT_RISK_FEED_CACHE_MAX_ENTRIES || 250),
);

// Circuit breaker para evitar avalanche de requests
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: Number(
    process.env.ALERT_RISK_FEED_CB_FAILURE_THRESHOLD || 5,
  ),
  resetTimeout: Number(process.env.ALERT_RISK_FEED_CB_RESET_TIMEOUT || 30000),
  monitoringPeriod: Number(
    process.env.ALERT_RISK_FEED_CB_MONITORING_PERIOD || 60000,
  ),
};

const circuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  nextAttempt: 0,
};

const shouldAllowRequest = () => {
  const now = Date.now();
  if (circuitBreakerState.state === 'CLOSED') return true;
  if (circuitBreakerState.state === 'OPEN') {
    if (now >= circuitBreakerState.nextAttempt) {
      circuitBreakerState.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }
  // HALF_OPEN: permite apenas 1 request de teste
  return true;
};

const recordSuccess = () => {
  circuitBreakerState.failures = 0;
  circuitBreakerState.state = 'CLOSED';
};

const recordFailure = () => {
  const now = Date.now();
  circuitBreakerState.failures++;
  circuitBreakerState.lastFailureTime = now;

  if (circuitBreakerState.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    circuitBreakerState.state = 'OPEN';
    circuitBreakerState.nextAttempt = now + CIRCUIT_BREAKER_CONFIG.resetTimeout;
    console.warn(
      `[risk-feed] Circuit breaker OPENED after ${circuitBreakerState.failures} failures`,
    );
  }
};

// Cache Redis para safe mode / load test
let riskFeedRedisCache = null;
let riskFeedRedisCacheInitialized = false;

const initRiskFeedRedisCache = () => {
  if (riskFeedRedisCacheInitialized) return riskFeedRedisCache;
  riskFeedRedisCacheInitialized = true;

  // Apenas inicializar Redis em safe mode ou se explicitamente configurado
  if (
    process.env.ALERT_LOAD_TEST_SAFE_MODE !== 'true' &&
    process.env.ALERT_RISK_FEED_REDIS_CACHE !== 'true'
  ) {
    return null;
  }

  try {
    riskFeedRedisCache = createCacheStore({
      name: 'risk-feed',
      prefix: 'alert:risk-feed',
      driver: 'redis',
    });
    console.log('[risk-feed] Redis cache initialized for safe mode');
  } catch (error) {
    console.warn(
      '[risk-feed] Failed to initialize Redis cache, falling back to memory',
      error?.message,
    );
    riskFeedRedisCache = null;
  }
  return riskFeedRedisCache;
};

// Métricas internas para observabilidade
const RISK_FEED_METRICS = {
  cacheHits: 0,
  cacheMisses: 0,
  cacheStaleHits: 0,
  providerCalls: 0,
  firestoreCalls: 0,
  timeouts: 0,
  errors: 0,
  coalescedRequests: 0,
  totalRequests: 0,
  lastResetAt: Date.now(),
};

const incrementMetric = (key, value = 1) => {
  if (RISK_FEED_METRICS[key] !== undefined) {
    RISK_FEED_METRICS[key] += value;
  }
};

const getRiskFeedMetrics = () => ({
  ...RISK_FEED_METRICS,
  cacheHitRate:
    RISK_FEED_METRICS.totalRequests > 0
      ? RISK_FEED_METRICS.cacheHits / RISK_FEED_METRICS.totalRequests
      : 0,
  uptimeMs: Date.now() - RISK_FEED_METRICS.lastResetAt,
});

const resetRiskFeedMetrics = () => {
  RISK_FEED_METRICS.cacheHits = 0;
  RISK_FEED_METRICS.cacheMisses = 0;
  RISK_FEED_METRICS.cacheStaleHits = 0;
  RISK_FEED_METRICS.providerCalls = 0;
  RISK_FEED_METRICS.firestoreCalls = 0;
  RISK_FEED_METRICS.timeouts = 0;
  RISK_FEED_METRICS.errors = 0;
  RISK_FEED_METRICS.coalescedRequests = 0;
  RISK_FEED_METRICS.totalRequests = 0;
  RISK_FEED_METRICS.lastResetAt = Date.now();
};

const recordRiskFeedUpstreamCall = db => {
  incrementMetric('providerCalls');
  if (db) {
    incrementMetric('firestoreCalls');
  }
};

const parseFiniteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampRadiusKm = value => {
  const parsed = parseFiniteNumber(value);
  if (!parsed) return 35;
  return Math.max(5, Math.min(80, Math.round(parsed)));
};

const clampLimit = value => {
  const parsed = parseFiniteNumber(value);
  if (!parsed) return 120;
  return Math.max(10, Math.min(180, Math.round(parsed)));
};

const readRiskFeedTimeoutMs = () => {
  const parsed = Number(process.env.ALERT_RISK_FEED_TIMEOUT_MS || 1800);
  return Number.isFinite(parsed) ? Math.max(500, Math.round(parsed)) : 1800;
};

const readRiskFeedCacheTtlMs = () => {
  // Em safe mode, usar TTL mais agressivo (15-60s)
  if (process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true') {
    const parsed = Number(process.env.ALERT_RISK_FEED_CACHE_TTL_MS || 30_000);
    return Number.isFinite(parsed)
      ? Math.max(15_000, Math.round(parsed))
      : 30_000;
  }
  const parsed = Number(process.env.ALERT_RISK_FEED_CACHE_TTL_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.round(parsed)) : 60_000;
};

const readRiskFeedStaleTtlMs = () => {
  const parsed = Number(process.env.ALERT_RISK_FEED_STALE_TTL_MS || 5 * 60_000);
  return Number.isFinite(parsed)
    ? Math.max(readRiskFeedCacheTtlMs(), Math.round(parsed))
    : 5 * 60_000;
};

const readRiskFeedTypes = () => {
  const raw = String(process.env.ALERT_RISK_FEED_TYPES || '').trim();
  const items = (raw ? raw.split(',') : DEFAULT_RISK_FEED_TYPES)
    .map(item =>
      String(item || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return Array.from(new Set(items));
};

const cloneRiskFeedPayload = payload => JSON.parse(JSON.stringify(payload));

const riskFeedCacheKeyFor = ({
  latitude,
  longitude,
  radiusKm,
  limit,
  sosPublicOptIn,
  riskFeedTypes,
}) =>
  JSON.stringify({
    latitude: Number(latitude).toFixed(3),
    longitude: Number(longitude).toFixed(3),
    radiusKm: clampRadiusKm(radiusKm),
    limit: clampLimit(limit),
    sosPublicOptIn: Boolean(sosPublicOptIn),
    riskFeedTypes,
  });

const pruneRiskFeedCache = () => {
  while (RISK_FEED_CACHE.size > MAX_RISK_FEED_CACHE_ENTRIES) {
    const oldestKey = RISK_FEED_CACHE.keys().next().value;
    if (!oldestKey) break;
    RISK_FEED_CACHE.delete(oldestKey);
  }
};

const readRiskFeedCacheEntry = async key => {
  // Tentar Redis primeiro em safe mode
  const redisCache = initRiskFeedRedisCache();
  if (redisCache && typeof redisCache.getJson === 'function') {
    try {
      const cached = await redisCache.getJson(key);
      if (cached) {
        incrementMetric('cacheHits');
        return {
          payload: cached,
          fresh: cached.fresh !== false,
          source: 'redis',
        };
      }
      incrementMetric('cacheMisses');
    } catch (error) {
      // Fallback para memória se Redis falhar
      console.warn(
        '[risk-feed] Redis cache read failed, using memory',
        error?.message,
      );
    }
  }

  // Fallback para cache em memória
  const row = RISK_FEED_CACHE.get(key);
  if (!row) return null;
  const now = Date.now();
  if (row.staleExpiresAt <= now) {
    RISK_FEED_CACHE.delete(key);
    return null;
  }
  return {
    payload: cloneRiskFeedPayload(row.payload),
    fresh: row.expiresAt > now,
    source: 'memory',
  };
};

const writeRiskFeedCacheEntry = async (key, payload) => {
  // Escrever no Redis primeiro em safe mode
  const redisCache = initRiskFeedRedisCache();
  if (redisCache && typeof redisCache.setJson === 'function') {
    try {
      await redisCache.setJson(key, payload, readRiskFeedCacheTtlMs());
    } catch (error) {
      console.warn('[risk-feed] Redis cache write failed', error?.message);
    }
  }

  // Também escrever no cache em memória (fallback)
  RISK_FEED_CACHE.delete(key);
  RISK_FEED_CACHE.set(key, {
    payload: cloneRiskFeedPayload(payload),
    expiresAt: Date.now() + readRiskFeedCacheTtlMs(),
    staleExpiresAt: Date.now() + readRiskFeedStaleTtlMs(),
  });
  pruneRiskFeedCache();
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(
      () =>
        resolve({
          timedOut: true,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const riskLevelFromSeverity = severity => {
  const normalized = String(severity || '').toLowerCase();
  if (normalized.includes('extreme') || normalized.includes('critical')) {
    return 'Extreme';
  }
  if (normalized.includes('severe') || normalized.includes('high')) {
    return 'Severe';
  }
  if (normalized.includes('moderate') || normalized.includes('medium')) {
    return 'Moderate';
  }
  return 'Minor';
};

const toAlertNotification = event => {
  const lat = Number(event?.geometry?.coordinates?.[1]);
  const lon = Number(event?.geometry?.coordinates?.[0]);
  const title = String(event?.type || 'alert')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  return {
    id: String(event?.id || ''),
    type: event?.type === 'sos' ? 'sos' : 'hazard',
    title,
    summary:
      Array.isArray(event?.recommendedActions) &&
      typeof event.recommendedActions[0] === 'string'
        ? event.recommendedActions[0]
        : 'Relevant risk signal in your area.',
    timestamp: String(event?.updatedAt || event?.startTime || nowIso()),
    sourceName: String(event?.source?.name || 'Alert'),
    sourceUrl:
      typeof event?.source?.referenceUrl === 'string'
        ? event.source.referenceUrl
        : undefined,
    severity: riskLevelFromSeverity(event?.severity),
    data: {
      kind: 'event_hub',
      eventType: String(event?.type || '')
        .trim()
        .toLowerCase(),
      severity: String(event?.severity || ''),
      urgency: String(event?.urgency || ''),
      certainty: String(event?.certainty || ''),
      confidence: Number(event?.confidence || 0),
      trustTier: String(event?.source?.trustTier || 'C'),
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

const shouldPreAlert = (alerts, riskScore) => {
  if (!Array.isArray(alerts) || alerts.length === 0) return false;
  if (Number.isFinite(Number(riskScore)) && Number(riskScore) >= 0.46) {
    return true;
  }
  return alerts.some(alert =>
    ['Severe', 'Extreme', 'Major'].includes(String(alert?.severity || '')),
  );
};

const buildRiskFeedTimeoutPayload = ({riskFeedTypes}) => ({
  alerts: [],
  providers: [],
  preAlert: {
    shouldNotify: false,
    reasonCodes: ['risk_feed_timeout'],
  },
  meta: {
    generatedAt: nowIso(),
    failClosed: true,
    cacheHit: false,
    hubAvailable: false,
    degraded: true,
    reason: 'risk_feed_timeout',
    timeoutMs: readRiskFeedTimeoutMs(),
    types: riskFeedTypes,
  },
});

// Safe mode: retorna payload sintético determinístico
const buildSafeModePayload = ({riskFeedTypes, lat, lon}) => {
  // Gera alerts sintéticos baseados na localização (determinístico)
  const seed = Math.abs(Math.floor(lat * 1000 + lon * 100)) % 100;
  const alerts = [];

  // Gera 0-3 alerts sintéticos baseado no seed
  const alertCount = seed % 4;
  for (let i = 0; i < alertCount; i++) {
    const typeIndex = (seed + i) % riskFeedTypes.length;
    alerts.push({
      id: `safe-${seed}-${i}`,
      type: 'hazard',
      title:
        riskFeedTypes[typeIndex]
          ?.replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()) || 'Alert',
      summary: 'Safe mode synthetic alert for load testing.',
      timestamp: nowIso(),
      sourceName: 'Alert Safe Mode',
      severity: ['Minor', 'Moderate', 'Severe'][i % 3],
      data: {
        kind: 'safe_mode',
        eventType: riskFeedTypes[typeIndex] || 'unknown',
        location: {latitude: lat, longitude: lon},
      },
    });
  }

  return {
    alerts,
    providers: [
      {
        id: 'safe_mode',
        name: 'Safe Mode Provider',
        ok: true,
      },
    ],
    preAlert: {
      shouldNotify:
        alerts.length > 0 && alerts.some(a => a.severity === 'Severe'),
      reasonCodes: alerts.length > 0 ? ['safe_mode_alerts'] : [],
    },
    meta: {
      generatedAt: nowIso(),
      failClosed: true,
      cacheHit: false,
      hubAvailable: false,
      degraded: false,
      safeMode: true,
      reason: 'safe_mode_synthetic',
      types: riskFeedTypes,
    },
  };
};

const isSafeMode = () => process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true';

const buildRiskFeedStalePayload = ({
  cachedPayload,
  riskFeedTypes,
  reason,
  riskScore,
}) => ({
  ...cachedPayload,
  preAlert: {
    shouldNotify: shouldPreAlert(cachedPayload.alerts, riskScore),
    reasonCodes: [reason],
  },
  meta: {
    ...cachedPayload.meta,
    generatedAt: nowIso(),
    cacheHit: true,
    cacheLayer: 'risk_feed',
    stale: true,
    hubAvailable: false,
    degraded: true,
    reason,
    timeoutMs: readRiskFeedTimeoutMs(),
    types: riskFeedTypes,
  },
});

const getRiskFeed = async (
  {latitude, longitude, radiusKm, limit, riskScore, sosPublicOptIn},
  {db} = {},
) => {
  incrementMetric('totalRequests');
  const lat = parseFiniteNumber(latitude);
  const lon = parseFiniteNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      alerts: [],
      providers: [],
      preAlert: {
        shouldNotify: false,
        reasonCodes: ['location_invalid'],
      },
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
        cacheHit: false,
        hubAvailable: false,
      },
    };
  }

  const bbox = bboxFromPoint(lat, lon, clampRadiusKm(radiusKm));
  const riskFeedTypes = readRiskFeedTypes();
  const cacheKey = riskFeedCacheKeyFor({
    latitude: lat,
    longitude: lon,
    radiusKm,
    limit,
    sosPublicOptIn,
    riskFeedTypes,
  });
  const cached = await readRiskFeedCacheEntry(cacheKey);
  if (cached?.fresh) {
    incrementMetric('cacheHits');
    return {
      ...cached.payload,
      preAlert: {
        shouldNotify: shouldPreAlert(cached.payload.alerts, riskScore),
        reasonCodes: shouldPreAlert(cached.payload.alerts, riskScore)
          ? ['elevated_risk_signal']
          : [],
      },
      meta: {
        ...cached.payload.meta,
        generatedAt: nowIso(),
        cacheHit: true,
        cacheLayer: 'risk_feed',
        stale: false,
        coalesced: false,
      },
    };
  }

  incrementMetric('cacheMisses');

  const existing = RISK_FEED_INFLIGHT.get(cacheKey);
  if (cached?.payload) {
    if (!existing) {
      const backgroundRefresh = (async () => {
        try {
          recordRiskFeedUpstreamCall(db);
          const payload = await withTimeout(
            EventHubService.getEvents(
              {
                bbox: [
                  bbox.minLon.toFixed(4),
                  bbox.minLat.toFixed(4),
                  bbox.maxLon.toFixed(4),
                  bbox.maxLat.toFixed(4),
                ].join(','),
                types: riskFeedTypes.join(','),
                limit: clampLimit(limit),
                sosPublicOptIn,
              },
              {
                db,
                providerIdsOverride: HOT_PATH_PROVIDER_IDS,
              },
            ),
            readRiskFeedTimeoutMs(),
          );

          if (payload?.timedOut) {
            return buildRiskFeedStalePayload({
              cachedPayload: cached.payload,
              riskFeedTypes,
              reason: 'risk_feed_timeout_stale',
              riskScore,
            });
          }

          const alerts = Array.isArray(payload?.events)
            ? payload.events.map(toAlertNotification).filter(alert => alert.id)
            : [];
          const notify = shouldPreAlert(alerts, riskScore);
          const result = {
            alerts,
            providers: Array.isArray(payload?.providers)
              ? payload.providers
              : [],
            preAlert: {
              shouldNotify: notify,
              reasonCodes: notify ? ['elevated_risk_signal'] : [],
            },
            meta: {
              generatedAt: payload?.meta?.generatedAt || nowIso(),
              failClosed: Boolean(payload?.meta?.failClosed ?? true),
              cacheHit: Boolean(payload?.meta?.cacheHit),
              cacheLayer: payload?.meta?.cacheHit
                ? payload?.meta?.cacheDriver || 'event_hub'
                : 'none',
              hubAvailable: true,
              stale: false,
              coalesced: false,
              types: riskFeedTypes,
            },
          };
          writeRiskFeedCacheEntry(cacheKey, result);
          return result;
        } catch {
          return buildRiskFeedStalePayload({
            cachedPayload: cached.payload,
            riskFeedTypes,
            reason: 'risk_feed_refresh_failed',
            riskScore,
          });
        }
      })();

      RISK_FEED_INFLIGHT.set(cacheKey, backgroundRefresh);
      backgroundRefresh.finally(() => {
        RISK_FEED_INFLIGHT.delete(cacheKey);
      });
    }

    const stalePayload = buildRiskFeedStalePayload({
      cachedPayload: cached.payload,
      riskFeedTypes,
      reason: 'risk_feed_stale_revalidate',
      riskScore,
    });

    return {
      ...stalePayload,
      meta: {
        ...stalePayload.meta,
        coalesced: Boolean(existing),
        refreshing: true,
      },
    };
  }

  if (existing) {
    incrementMetric('coalescedRequests');
    const payload = await existing;
    return {
      ...payload,
      meta: {
        ...payload.meta,
        generatedAt: nowIso(),
        coalesced: true,
      },
    };
  }

  // SAFE MODE HARD OVERRIDE: Não chamar EventHubService em safe mode
  // Retorna payload sintético determinístico e cacheia
  if (isSafeMode()) {
    const safePayload = buildSafeModePayload({riskFeedTypes, lat, lon});
    // Cacheia o payload safe mode para próximas requisições
    await writeRiskFeedCacheEntry(cacheKey, {
      ...safePayload,
      meta: {
        ...safePayload.meta,
        generatedAt: nowIso(),
        cacheHit: false,
        hubAvailable: false,
        safeMode: true,
      },
    });
    recordSuccess();
    return {
      ...safePayload,
      preAlert: {
        shouldNotify: shouldPreAlert(safePayload.alerts, riskScore),
        reasonCodes: shouldPreAlert(safePayload.alerts, riskScore)
          ? ['elevated_risk_signal']
          : [],
      },
      meta: {
        ...safePayload.meta,
        generatedAt: nowIso(),
        cacheHit: false,
        cacheLayer: 'safe_mode',
        stale: false,
        coalesced: false,
      },
    };
  }

  // Verificar circuit breaker antes de fazer request ao provider
  if (!shouldAllowRequest()) {
    incrementMetric('timeouts');
    recordFailure();
    if (cached?.payload) {
      return buildRiskFeedStalePayload({
        cachedPayload: cached.payload,
        riskFeedTypes,
        reason: 'circuit_breaker_open',
        riskScore,
      });
    }
    return buildRiskFeedTimeoutPayload({riskFeedTypes});
  }

  const request = (async () => {
    try {
      recordRiskFeedUpstreamCall(db);
      const payload = await withTimeout(
        EventHubService.getEvents(
          {
            bbox: [
              bbox.minLon.toFixed(4),
              bbox.minLat.toFixed(4),
              bbox.maxLon.toFixed(4),
              bbox.maxLat.toFixed(4),
            ].join(','),
            types: riskFeedTypes.join(','),
            limit: clampLimit(limit),
            sosPublicOptIn,
          },
          {
            db,
            providerIdsOverride: HOT_PATH_PROVIDER_IDS,
          },
        ),
        readRiskFeedTimeoutMs(),
      );

      if (payload?.timedOut) {
        if (cached?.payload) {
          return buildRiskFeedStalePayload({
            cachedPayload: cached.payload,
            riskFeedTypes,
            reason: 'risk_feed_timeout_stale',
            riskScore,
          });
        }
        return buildRiskFeedTimeoutPayload({riskFeedTypes});
      }

      const alerts = Array.isArray(payload?.events)
        ? payload.events.map(toAlertNotification).filter(alert => alert.id)
        : [];
      const notify = shouldPreAlert(alerts, riskScore);

      const result = {
        alerts,
        providers: Array.isArray(payload?.providers) ? payload.providers : [],
        preAlert: {
          shouldNotify: notify,
          reasonCodes: notify ? ['elevated_risk_signal'] : [],
        },
        meta: {
          generatedAt: payload?.meta?.generatedAt || nowIso(),
          failClosed: Boolean(payload?.meta?.failClosed ?? true),
          cacheHit: Boolean(payload?.meta?.cacheHit),
          cacheLayer: payload?.meta?.cacheHit
            ? payload?.meta?.cacheDriver || 'event_hub'
            : 'none',
          hubAvailable: true,
          stale: false,
          coalesced: false,
          types: riskFeedTypes,
        },
      };
      writeRiskFeedCacheEntry(cacheKey, result);
      recordSuccess();
      return result;
    } catch (error) {
      incrementMetric('errors');
      recordFailure();
      if (cached?.payload) {
        return buildRiskFeedStalePayload({
          cachedPayload: cached.payload,
          riskFeedTypes,
          reason: 'risk_feed_error_fallback',
          riskScore,
        });
      }
      return buildRiskFeedTimeoutPayload({riskFeedTypes});
    }
  })();

  RISK_FEED_INFLIGHT.set(cacheKey, request);
  try {
    return await request;
  } finally {
    RISK_FEED_INFLIGHT.delete(cacheKey);
  }
};

module.exports = {
  getRiskFeed,
  readRiskFeedCacheTtlMs,
  readRiskFeedStaleTtlMs,
  readRiskFeedTimeoutMs,
  readRiskFeedTypes,
  getRiskFeedMetrics,
  resetRiskFeedMetrics,
  __dangerousResetRiskFeedCacheForTests: () => {
    RISK_FEED_CACHE.clear();
    RISK_FEED_INFLIGHT.clear();
    resetRiskFeedMetrics();
  },
};
