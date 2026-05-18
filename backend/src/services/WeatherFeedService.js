const {
  fetchWeatherFeedOpenMeteo,
} = require('../eventHub/adapters/weatherFeedOpenMeteoAdapter');
const {nowIso} = require('../eventHub/utils');
const {createCacheStore} = require('../platform/cache/createCacheStore');
const {
  BACKEND_REQUEST_BASE,
  REDIS_COMMAND,
  WEATHER_PROVIDER,
  sumOperationCosts,
} = require('../economics/CostCatalog');
const {
  evaluateEconomicGate,
  registerEconomicCost,
} = require('../economics/EconomicGate');
const {normalizeTier} = require('../economics/EconomicsPolicy');

const WEATHER_FEED_CACHE = new Map();
const WEATHER_FEED_INFLIGHT = new Map();
const MAX_WEATHER_FEED_CACHE_ENTRIES = Math.max(
  50,
  Number(process.env.ALERT_WEATHER_FEED_CACHE_MAX_ENTRIES || 250),
);
const MIN_BACKEND_FORECAST_DAYS_FOR_MOBILE = 6;

// Circuit breaker para evitar avalanche de requests
const WEATHER_CB_CONFIG = {
  failureThreshold: Number(
    process.env.ALERT_WEATHER_FEED_CB_FAILURE_THRESHOLD || 5,
  ),
  resetTimeout: Number(
    process.env.ALERT_WEATHER_FEED_CB_RESET_TIMEOUT || 30000,
  ),
  monitoringPeriod: Number(
    process.env.ALERT_WEATHER_FEED_CB_MONITORING_PERIOD || 60000,
  ),
};

const weatherCBState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  nextAttempt: 0,
};

const shouldAllowWeatherRequest = () => {
  const now = Date.now();
  if (weatherCBState.state === 'CLOSED') return true;
  if (weatherCBState.state === 'OPEN') {
    if (now >= weatherCBState.nextAttempt) {
      weatherCBState.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }
  // HALF_OPEN: permite apenas 1 request de teste
  return true;
};

const recordWeatherSuccess = () => {
  weatherCBState.failures = 0;
  weatherCBState.state = 'CLOSED';
};

const recordWeatherFailure = () => {
  const now = Date.now();
  weatherCBState.failures++;
  weatherCBState.lastFailureTime = now;

  if (weatherCBState.failures >= WEATHER_CB_CONFIG.failureThreshold) {
    weatherCBState.state = 'OPEN';
    weatherCBState.nextAttempt = now + WEATHER_CB_CONFIG.resetTimeout;
    console.warn(
      `[weather-feed] Circuit breaker OPENED after ${weatherCBState.failures} failures`,
    );
  }
};

// Cache Redis para safe mode / load test
let weatherFeedRedisCache = null;
let weatherFeedRedisCacheInitialized = false;

const initWeatherFeedRedisCache = () => {
  if (weatherFeedRedisCacheInitialized) return weatherFeedRedisCache;
  weatherFeedRedisCacheInitialized = true;

  // Apenas inicializar Redis em safe mode ou se explicitamente configurado
  if (
    process.env.ALERT_LOAD_TEST_SAFE_MODE !== 'true' &&
    process.env.ALERT_WEATHER_FEED_REDIS_CACHE !== 'true'
  ) {
    return null;
  }

  try {
    weatherFeedRedisCache = createCacheStore({
      name: 'weather-feed',
      prefix: 'alert:weather-feed',
      driver: 'redis',
    });
    console.log('[weather-feed] Redis cache initialized for safe mode');
  } catch (error) {
    console.warn(
      '[weather-feed] Failed to initialize Redis cache, falling back to memory',
      error?.message,
    );
    weatherFeedRedisCache = null;
  }
  return weatherFeedRedisCache;
};

// Métricas internas para observabilidade
const WEATHER_FEED_METRICS = {
  cacheHits: 0,
  cacheMisses: 0,
  cacheStaleHits: 0,
  providerCalls: 0,
  timeouts: 0,
  errors: 0,
  coalescedRequests: 0,
  totalRequests: 0,
  lastResetAt: Date.now(),
};

const incrementWeatherMetric = (key, value = 1) => {
  if (WEATHER_FEED_METRICS[key] !== undefined) {
    WEATHER_FEED_METRICS[key] += value;
  }
};

const getWeatherFeedMetrics = () => ({
  ...WEATHER_FEED_METRICS,
  cacheHitRate:
    WEATHER_FEED_METRICS.totalRequests > 0
      ? WEATHER_FEED_METRICS.cacheHits / WEATHER_FEED_METRICS.totalRequests
      : 0,
  uptimeMs: Date.now() - WEATHER_FEED_METRICS.lastResetAt,
});

const resetWeatherFeedMetrics = () => {
  WEATHER_FEED_METRICS.cacheHits = 0;
  WEATHER_FEED_METRICS.cacheMisses = 0;
  WEATHER_FEED_METRICS.cacheStaleHits = 0;
  WEATHER_FEED_METRICS.providerCalls = 0;
  WEATHER_FEED_METRICS.timeouts = 0;
  WEATHER_FEED_METRICS.errors = 0;
  WEATHER_FEED_METRICS.coalescedRequests = 0;
  WEATHER_FEED_METRICS.totalRequests = 0;
  WEATHER_FEED_METRICS.lastResetAt = Date.now();
};

const buildWeatherFeedEconomicsContext = economicsContext => ({
  userKey: String(economicsContext?.userKey || 'anonymous'),
  tier: normalizeTier(economicsContext?.tier),
  regionKey: String(economicsContext?.regionKey || 'global'),
  criticality: String(economicsContext?.criticality || 'standard'),
});

const buildWeatherFeedEconomicsPayload = (decision, overrides = {}) => ({
  allowed: Boolean(decision?.allowed && !decision?.degraded),
  degraded: Boolean(overrides.degraded ?? decision?.degraded),
  reason: String(
    overrides.reason || decision?.reason || 'economics_not_evaluated',
  ),
  operation: String(
    overrides.operation || decision?.operation || WEATHER_PROVIDER,
  ),
  fallbackMode: overrides.fallbackMode || decision?.fallbackMode || null,
  estimatedCostUsd: Number(decision?.estimatedCostUsd || 0),
  budgetUsd: Number(decision?.budgetUsd || 0),
  projectedCostUsd: Number(decision?.projectedCostUsd || 0),
});

const estimateWeatherFeedCostUsd = ({
  includeRedis = false,
  includeProvider = false,
} = {}) =>
  sumOperationCosts(
    [
      BACKEND_REQUEST_BASE,
      includeRedis ? REDIS_COMMAND : null,
      includeProvider ? WEATHER_PROVIDER : null,
    ].filter(Boolean),
  );

const registerWeatherFeedCost = async ({
  economicsContext,
  operation = WEATHER_PROVIDER,
  actualCostUsd,
}) => {
  await registerEconomicCost({
    userKey: economicsContext.userKey,
    tier: economicsContext.tier,
    operation,
    actualCostUsd,
    regionKey: economicsContext.regionKey,
    criticality: economicsContext.criticality,
  });
};

const recordWeatherFeedUpstreamCall = () => {
  incrementWeatherMetric('providerCalls');
};

const readWeatherFeedTimeoutMs = () => {
  const parsed = Number(process.env.ALERT_WEATHER_FEED_TIMEOUT_MS || 5000);
  return Number.isFinite(parsed) ? Math.max(500, Math.round(parsed)) : 5000;
};

const readWeatherFeedCacheTtlMs = () => {
  // Em safe mode, usar TTL mais agressivo (60-120s)
  if (process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true') {
    const parsed = Number(process.env.ALERT_WEATHER_FEED_CACHE_TTL_MS || 90000);
    return Number.isFinite(parsed)
      ? Math.max(60000, Math.round(parsed))
      : 90000;
  }
  const parsed = Number(process.env.ALERT_WEATHER_FEED_CACHE_TTL_MS || 180000);
  return Number.isFinite(parsed) ? Math.max(60000, Math.round(parsed)) : 180000;
};

const readWeatherFeedStaleTtlMs = () => {
  const parsed = Number(
    process.env.ALERT_WEATHER_FEED_STALE_TTL_MS || 10 * 60_000,
  );
  return Number.isFinite(parsed)
    ? Math.max(readWeatherFeedCacheTtlMs(), Math.round(parsed))
    : 10 * 60_000;
};

const weatherFeedCacheKeyFor = ({latitude, longitude, locale}) =>
  JSON.stringify({
    latitude: Number(latitude).toFixed(3),
    longitude: Number(longitude).toFixed(3),
    locale: String(locale || 'en').trim(),
  });

const pruneWeatherFeedCache = () => {
  while (WEATHER_FEED_CACHE.size > MAX_WEATHER_FEED_CACHE_ENTRIES) {
    const oldestKey = WEATHER_FEED_CACHE.keys().next().value;
    if (!oldestKey) break;
    WEATHER_FEED_CACHE.delete(oldestKey);
  }
};

const readWeatherFeedMemoryCacheEntry = key => {
  const row = WEATHER_FEED_CACHE.get(key);
  if (!row) return null;
  const now = Date.now();
  if (row.staleExpiresAt <= now) {
    WEATHER_FEED_CACHE.delete(key);
    return null;
  }
  if (!hasUsableBackendForecastForMobile(row.payload)) {
    logForecastCacheInvalidation('memory', row.payload);
    WEATHER_FEED_CACHE.delete(key);
    return null;
  }
  return {
    payload: JSON.parse(JSON.stringify(row.payload)),
    fresh: row.expiresAt > now,
    source: 'memory',
  };
};

const readWeatherFeedCacheEntry = async key => {
  // Tentar Redis primeiro em safe mode
  const redisCache = initWeatherFeedRedisCache();
  if (redisCache && typeof redisCache.getJson === 'function') {
    try {
      const cached = await redisCache.getJson(key);
      if (cached) {
        if (!hasUsableBackendForecastForMobile(cached)) {
          logForecastCacheInvalidation('redis', cached);
          incrementWeatherMetric('cacheMisses');
          return null;
        }
        incrementWeatherMetric('cacheHits');
        return {
          payload: cached,
          fresh: cached.fresh !== false,
          source: 'redis',
        };
      }
      incrementWeatherMetric('cacheMisses');
    } catch (error) {
      // Fallback para memória se Redis falhar
      console.warn(
        '[weather-feed] Redis cache read failed, using memory',
        error?.message,
      );
    }
  }

  // Fallback para cache em memória
  return readWeatherFeedMemoryCacheEntry(key);
};

const writeWeatherFeedCacheEntry = async (key, payload) => {
  if (!hasUsableBackendForecastForMobile(payload)) {
    logForecastCacheInvalidation('write_skip', payload);
    return;
  }

  // Escrever no Redis primeiro em safe mode
  const redisCache = initWeatherFeedRedisCache();
  if (redisCache && typeof redisCache.setJson === 'function') {
    try {
      await redisCache.setJson(key, payload, readWeatherFeedCacheTtlMs());
    } catch (error) {
      console.warn('[weather-feed] Redis cache write failed', error?.message);
    }
  }

  // Também escrever no cache em memória (fallback)
  WEATHER_FEED_CACHE.delete(key);
  WEATHER_FEED_CACHE.set(key, {
    payload: JSON.parse(JSON.stringify(payload)),
    expiresAt: Date.now() + readWeatherFeedCacheTtlMs(),
    staleExpiresAt: Date.now() + readWeatherFeedStaleTtlMs(),
  });
  pruneWeatherFeedCache();
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

const isFiniteNumber = value =>
  typeof value === 'number' && Number.isFinite(value);

const getDailyForecastArray = (daily, key) =>
  Array.isArray(daily?.[key]) ? daily[key] : [];

const countUsableBackendForecastDays = payload => {
  const forecastDays = Array.isArray(payload?.daily?.forecastDays)
    ? payload.daily.forecastDays
    : [];
  return forecastDays.filter(
    day =>
      day &&
      typeof day.date === 'string' &&
      day.date.trim().length > 0 &&
      isFiniteNumber(day.maxTempC) &&
      isFiniteNumber(day.minTempC),
  ).length;
};

const hasUsableBackendForecastForMobile = payload =>
  payload?.available === false ||
  countUsableBackendForecastDays(payload) >= MIN_BACKEND_FORECAST_DAYS_FOR_MOBILE;

const logForecastCacheInvalidation = (source, payload) => {
  try {
    console.warn(
      '[weather/feed] invalidating_incomplete_forecast_cache',
      JSON.stringify({
        source,
        backendForecastCount: Array.isArray(payload?.daily?.forecastDays)
          ? payload.daily.forecastDays.length
          : 0,
        usableBackendForecastCount: countUsableBackendForecastDays(payload),
        minRequired: MIN_BACKEND_FORECAST_DAYS_FOR_MOBILE,
      }),
    );
  } catch {
    // diagnostics must not block weather feed cache handling
  }
};

const logDailyForecastDiagnostics = (daily, count) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const timeLen = getDailyForecastArray(daily, 'time').length;
    const codeLen = getDailyForecastArray(daily, 'weather_code').length;
    const maxLen = getDailyForecastArray(daily, 'temperature_2m_max').length;
    const minLen = getDailyForecastArray(daily, 'temperature_2m_min').length;
    const rainLen = getDailyForecastArray(
      daily,
      'precipitation_probability_max',
    ).length;
    console.info(
      '[weather/feed] forecast_arrays',
      JSON.stringify({
        timeLen,
        codeLen,
        maxLen,
        minLen,
        rainLen,
        validCount: count,
      }),
    );
  }
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pickFirst = (...values) =>
  values.find(value => typeof value === 'string' && value.trim().length > 0) ||
  '';

const mapWmoToIcon = (code, isDay) => {
  const safeCode = Number(code || 0);
  if (safeCode === 0) {
    return {
      icon: isDay ? 'weather-sunny' : 'weather-night',
      labelKey: isDay ? 'weather_clear_sky_day' : 'weather_clear_sky_night',
    };
  }
  if ([1, 2].includes(safeCode)) {
    return {
      icon: isDay ? 'weather-partly-cloudy' : 'weather-night-partly-cloudy',
      labelKey: 'weather_partly_cloudy',
    };
  }
  if (safeCode === 3) {
    return {icon: 'weather-cloudy', labelKey: 'weather_overcast'};
  }
  if ([45, 48].includes(safeCode)) {
    return {icon: 'weather-fog', labelKey: 'weather_fog'};
  }
  if (safeCode >= 51 && safeCode <= 67) {
    return {icon: 'weather-rainy', labelKey: 'weather_rain'};
  }
  if (safeCode >= 71 && safeCode <= 77) {
    return {icon: 'weather-snowy', labelKey: 'weather_snow'};
  }
  if (safeCode === 79) {
    return {icon: 'weather-hail', labelKey: 'weather_hail'};
  }
  if (safeCode >= 80 && safeCode <= 82) {
    return {icon: 'weather-pouring', labelKey: 'weather_showers'};
  }
  if (safeCode >= 85 && safeCode <= 86) {
    return {icon: 'weather-snowy-heavy', labelKey: 'weather_snow_showers'};
  }
  if (safeCode === 95) {
    return {
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_thunder',
    };
  }
  if (safeCode >= 96 && safeCode <= 99) {
    return {
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_hail',
    };
  }
  return {icon: 'weather-cloudy', labelKey: 'weather_overcast'};
};

const mapWmoToLegacyCondition = code => {
  const safeCode = Number(code || 0);
  if (safeCode === 0) return 'clear';
  if ([1, 2].includes(safeCode)) return 'partly_cloudy';
  if (safeCode === 3) return 'overcast';
  if ([45, 48].includes(safeCode)) return 'fog';
  if (safeCode >= 51 && safeCode <= 82) return 'rain';
  if (safeCode >= 71 && safeCode <= 86) return 'snow';
  if (safeCode === 79) return 'hail';
  if (safeCode >= 95 && safeCode <= 99) return 'thunderstorm';
  return 'overcast';
};

const resolveCityFromReverse = reverseData => {
  if (reverseData && typeof reverseData === 'object') {
    const direct = pickFirst(
      reverseData.city,
      reverseData.locality,
      reverseData.principalSubdivision,
      reverseData.countryName,
    );
    if (direct) {
      return direct;
    }
  }

  const result = Array.isArray(reverseData?.results)
    ? reverseData.results[0]
    : null;
  if (result) {
    return pickFirst(
      result?.name,
      result?.locality,
      result?.admin2,
      result?.admin1,
      result?.country,
    );
  }

  const address = reverseData?.address || {};
  return pickFirst(
    address.city,
    address.town,
    address.village,
    address.hamlet,
    address.municipality,
    address.county,
    address.city_district,
    address.suburb,
    address.neighbourhood,
    reverseData?.name,
    address.state,
    address.country,
  );
};

const buildIntelligenceSignal = weatherData => {
  const current = weatherData?.current || {};
  const hourly = weatherData?.hourly || {};
  const weatherCode = Number(current?.weather_code || 0);
  const precipitation = Number(current?.precipitation || 0);
  const rain = Number(current?.rain || 0);
  const showers = Number(current?.showers || 0);
  const snowfall = Number(current?.snowfall || 0);
  const liquid = Math.max(precipitation, rain, showers);

  if (weatherCode >= 96 && weatherCode <= 99) {
    return {
      kind: 'hail',
      icon: 'weather-hail',
      labelKey: 'weather_signal_hail',
      confidence: 0.94,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if (weatherCode === 95) {
    return {
      kind: 'thunder',
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_thunder',
      confidence: 0.92,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if ((weatherCode >= 71 && weatherCode <= 77) || snowfall >= 0.2) {
    return {
      kind: 'snow',
      icon: 'weather-snowy',
      labelKey: 'weather_signal_snow',
      confidence: 0.9,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if ((weatherCode >= 51 && weatherCode <= 82) || liquid >= 0.2) {
    return {
      kind: 'rain',
      icon: liquid >= 1.2 ? 'weather-pouring' : 'weather-rainy',
      labelKey: 'weather_signal_rain',
      confidence: liquid >= 1 ? 0.9 : 0.78,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const rainProbability = Array.isArray(hourly?.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const now = Date.now();

  for (let index = 0; index < Math.min(times.length, 6); index += 1) {
    const startsAt = Date.parse(times[index]);
    if (!Number.isFinite(startsAt)) continue;
    const startsInMinutes = Math.max(0, Math.round((startsAt - now) / 60000));
    if (startsInMinutes > 180) continue;
    const code = Number(codes[index] || 0);
    const probability = Number(rainProbability[index] || 0);
    if (code >= 96 && code <= 99) {
      return {
        kind: 'hail',
        icon: 'weather-hail',
        labelKey: 'weather_signal_hail',
        confidence: 0.82,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if (code === 95) {
      return {
        kind: 'lightning',
        icon: 'weather-lightning-rainy',
        labelKey: 'weather_signal_lightning',
        confidence: 0.8,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if ((code >= 71 && code <= 86) || probability >= 75) {
      return {
        kind: 'snow',
        icon: 'weather-snowy',
        labelKey: 'weather_signal_snow',
        confidence: 0.76,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if ((code >= 51 && code <= 82) || probability >= 58) {
      return {
        kind: 'rain',
        icon: 'weather-rainy',
        labelKey: 'weather_signal_rain',
        confidence: 0.74,
        startsInMinutes,
        source: 'forecast',
      };
    }
  }

  return null;
};

const buildForecastDaysFromDaily = daily => {
  const times = getDailyForecastArray(daily, 'time');
  const weatherCodes = getDailyForecastArray(daily, 'weather_code');
  const maxTemps = getDailyForecastArray(daily, 'temperature_2m_max');
  const minTemps = getDailyForecastArray(daily, 'temperature_2m_min');
  const rainProbabilities = getDailyForecastArray(
    daily,
    'precipitation_probability_max',
  );
  const count = Math.min(
    times.length,
    weatherCodes.length,
    maxTemps.length,
    minTemps.length,
    8,
  );
  logDailyForecastDiagnostics(daily, count);
  if (count <= 0) return [];

  return Array.from({length: count}, (_, index) => {
    const weatherCode = Number(weatherCodes[index] || 0);
    return {
      date: String(times[index] || ''),
      weatherCode,
      icon: mapWmoToIcon(weatherCode, true).icon,
      labelKey: mapWmoToIcon(weatherCode, true).labelKey,
      maxTempC: isFiniteNumber(maxTemps[index])
        ? Number(maxTemps[index])
        : null,
      minTempC: isFiniteNumber(minTemps[index])
        ? Number(minTemps[index])
        : null,
      rainChance: isFiniteNumber(rainProbabilities[index])
        ? Math.round(Number(rainProbabilities[index]))
        : null,
    };
  });
};

const buildDateKeyOffset = offsetDays => {
  const date = new Date(nowIso());
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().split('T')[0];
};

const buildUnavailableWeatherFeed = (lat, lon) => ({
  available: false,
  location: {
    city: '',
    latitude: lat,
    longitude: lon,
    timezone: 'UTC',
  },
  current: null,
  daily: {
    forecastDays: [],
    sunrise: '',
    sunset: '',
  },
  intelligenceSignal: null,
  freshness: {
    fetchedAt: nowIso(),
    cacheTtlSec: 60,
    status: 'UNKNOWN',
  },
});

// Safe mode: retorna payload sintético determinístico
const buildSafeModeWeatherFeed = ({lat, lon, locale}) => {
  // Gera dados sintéticos baseados na localização (determinístico)
  const seed = Math.abs(Math.floor(lat * 1000 + lon * 100)) % 100;
  const tempC = 20 + (seed % 20) - 10; // 10-30°C
  const weatherCode = [0, 1, 2, 3, 45, 51, 61, 71, 95][seed % 9];
  const forecastCodes = [1, 2, 3, 61, 1, 2, 3, 0];
  const isDay = true;
  const forecastDays = Array.from({length: 8}, (_, index) => {
    const forecastCode = forecastCodes[index];
    const visual = mapWmoToIcon(forecastCode, true);
    return {
      date: buildDateKeyOffset(index),
      weatherCode: forecastCode,
      icon: visual.icon,
      labelKey: visual.labelKey,
      maxTempC: tempC + 3 - index,
      minTempC: tempC - 3 - index,
      rainChance: Math.min(80, 20 + index * 5),
    };
  });

  return {
    available: true,
    location: {
      city: `Safe City ${seed}`,
      latitude: lat,
      longitude: lon,
      timezone: 'UTC',
    },
    current: {
      tempC,
      apparentTempC: tempC + (seed % 5) - 2,
      humidity: 50 + (seed % 50),
      windKmh: seed % 20,
      weatherCode,
      icon: mapWmoToIcon(weatherCode, isDay).icon,
      labelKey: mapWmoToIcon(weatherCode, isDay).labelKey,
      isDay,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
    },
    weather: {
      temperature: {value: tempC, unit: 'C'},
      condition: mapWmoToLegacyCondition(weatherCode),
      humidity: {value: 50 + (seed % 50), unit: '%'},
      windSpeed: {value: seed % 20, unit: 'km/h'},
      windDirection: 'N',
      visibility: {value: 10, unit: 'km'},
      uvIndex: 3,
      pressure: {value: 1015, unit: 'hPa'},
      dewPoint: {value: tempC - 10, unit: 'C'},
      feelsLike: {value: tempC + (seed % 5) - 2, unit: 'C'},
    },
    forecast: forecastDays.map((day, index) => ({
      day: index,
      condition: mapWmoToLegacyCondition(day.weatherCode),
      tempHigh: day.maxTempC,
      tempLow: day.minTempC,
    })),
    daily: {
      maxTempC: tempC + 5,
      minTempC: tempC - 5,
      sunrise: '06:00',
      sunset: '18:00',
      forecastDays,
    },
    intelligenceSignal: null,
    freshness: {
      fetchedAt: nowIso(),
      cacheTtlSec: 90,
      status: 'SAFE_MODE',
    },
  };
};

const isSafeMode = () => process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true';

const getWeatherFeed = async (
  {latitude, longitude, locale},
  {config, economicsContext: rawEconomicsContext} = {},
) => {
  incrementWeatherMetric('totalRequests');
  const lat = Number(latitude);
  const lon = Number(longitude);
  const economicsContext =
    buildWeatherFeedEconomicsContext(rawEconomicsContext);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return buildUnavailableWeatherFeed(lat, lon);
  }

  const safeLocale = String(locale || 'en').trim() || 'en';
  const cacheKey = weatherFeedCacheKeyFor({
    latitude: lat,
    longitude: lon,
    locale: safeLocale,
  });
  const memoryCached = readWeatherFeedMemoryCacheEntry(cacheKey);
  if (memoryCached?.fresh) {
    await registerWeatherFeedCost({
      economicsContext,
      operation: BACKEND_REQUEST_BASE,
      actualCostUsd: estimateWeatherFeedCostUsd(),
    });
    return {
      ...memoryCached.payload,
      freshness: {
        ...memoryCached.payload.freshness,
        fetchedAt: nowIso(),
        cacheHit: true,
        cacheLayer: 'weather_feed',
        stale: false,
        coalesced: false,
      },
      economics: buildWeatherFeedEconomicsPayload(
        {
          allowed: true,
          degraded: false,
          reason: 'memory_cache_hit',
          operation: BACKEND_REQUEST_BASE,
        },
        {
          operation: BACKEND_REQUEST_BASE,
        },
      ),
    };
  }

  const gateDecision = await evaluateEconomicGate({
    userKey: economicsContext.userKey,
    tier: economicsContext.tier,
    operation: WEATHER_PROVIDER,
    estimatedCostUsd: estimateWeatherFeedCostUsd({
      includeRedis: true,
      includeProvider: true,
    }),
    regionKey: economicsContext.regionKey,
    criticality: economicsContext.criticality,
  });

  const cached = await readWeatherFeedCacheEntry(cacheKey);
  if (cached?.fresh) {
    await registerWeatherFeedCost({
      economicsContext,
      operation:
        cached.source === 'redis' ? REDIS_COMMAND : BACKEND_REQUEST_BASE,
      actualCostUsd: estimateWeatherFeedCostUsd({
        includeRedis: cached.source === 'redis',
      }),
    });
    incrementWeatherMetric('cacheHits');
    return {
      ...cached.payload,
      freshness: {
        ...cached.payload.freshness,
        fetchedAt: nowIso(),
        cacheHit: true,
        cacheLayer: 'weather_feed',
        stale: false,
        coalesced: false,
      },
      economics: buildWeatherFeedEconomicsPayload(gateDecision, {
        operation:
          cached.source === 'redis' ? REDIS_COMMAND : BACKEND_REQUEST_BASE,
      }),
    };
  }

  incrementWeatherMetric('cacheMisses');

  const existing = WEATHER_FEED_INFLIGHT.get(cacheKey);
  if (cached?.payload) {
    if (!existing) {
      const backgroundRefresh = (async () => {
        try {
          recordWeatherFeedUpstreamCall();
          const {forecastResult: weatherResult, reverseResult} =
            await withTimeout(
              fetchWeatherFeedOpenMeteo(
                {
                  latitude: lat,
                  longitude: lon,
                  locale: safeLocale,
                },
                {
                  userAgent: config?.weather?.userAgent,
                },
              ),
              readWeatherFeedTimeoutMs(),
            );

          if (weatherResult?.timedOut) {
            return {
              ...cached.payload,
              freshness: {
                ...cached.payload.freshness,
                fetchedAt: nowIso(),
                cacheHit: true,
                cacheLayer: 'weather_feed',
                stale: true,
                reason: 'weather_feed_timeout_stale',
              },
            };
          }

          if (!weatherResult.ok || !weatherResult.json) {
            return {
              ...cached.payload,
              freshness: {
                ...cached.payload.freshness,
                fetchedAt: nowIso(),
                cacheHit: true,
                cacheLayer: 'weather_feed',
                stale: true,
                reason: 'weather_feed_error_fallback',
              },
            };
          }

          const weatherData = weatherResult.json;
          const city = reverseResult.ok
            ? resolveCityFromReverse(reverseResult.json)
            : '';
          const current = weatherData?.current || {};
          const daily = weatherData?.daily || {};
          const currentCode = Number(current?.weather_code || 0);
          const isDay = current?.is_day === 1 || current?.is_day === true;
          const currentVisual = mapWmoToIcon(currentCode, isDay);
          const forecastDays = buildForecastDaysFromDaily(daily);

          const result = {
            available: true,
            location: {
              city,
              latitude: lat,
              longitude: lon,
              timezone: String(weatherData?.timezone || 'UTC'),
            },
            current: {
              tempC: isFiniteNumber(current?.temperature_2m)
                ? Number(current.temperature_2m)
                : null,
              apparentTempC: isFiniteNumber(current?.apparent_temperature)
                ? Number(current.apparent_temperature)
                : null,
              humidity: isFiniteNumber(current?.relative_humidity_2m)
                ? clamp(Number(current.relative_humidity_2m), 0, 100)
                : null,
              windKmh: isFiniteNumber(current?.wind_speed_10m)
                ? Number(current.wind_speed_10m)
                : 0,
              weatherCode: currentCode,
              icon: currentVisual.icon,
              labelKey: currentVisual.labelKey,
              isDay,
              precipitation: isFiniteNumber(current?.precipitation)
                ? Number(current.precipitation)
                : 0,
              rain: isFiniteNumber(current?.rain) ? Number(current.rain) : 0,
              showers: isFiniteNumber(current?.showers)
                ? Number(current.showers)
                : 0,
              snowfall: isFiniteNumber(current?.snowfall)
                ? Number(current.snowfall)
                : 0,
            },
            daily: {
              maxTempC: isFiniteNumber(daily?.temperature_2m_max?.[0])
                ? Number(daily.temperature_2m_max[0])
                : null,
              minTempC: isFiniteNumber(daily?.temperature_2m_min?.[0])
                ? Number(daily.temperature_2m_min[0])
                : null,
              sunrise:
                typeof daily?.sunrise?.[0] === 'string' ? daily.sunrise[0] : '',
              sunset:
                typeof daily?.sunset?.[0] === 'string' ? daily.sunset[0] : '',
              forecastDays,
            },
            intelligenceSignal: buildIntelligenceSignal(weatherData),
            freshness: {
              fetchedAt: nowIso(),
              cacheTtlSec: 90,
              status: 'FRESH',
            },
          };
          writeWeatherFeedCacheEntry(cacheKey, result);
          await registerWeatherFeedCost({
            economicsContext,
            operation: WEATHER_PROVIDER,
            actualCostUsd: estimateWeatherFeedCostUsd({
              includeProvider: true,
              includeRedis: true,
            }),
          });
          return result;
        } catch {
          return {
            ...cached.payload,
            freshness: {
              ...cached.payload.freshness,
              fetchedAt: nowIso(),
              cacheHit: true,
              cacheLayer: 'weather_feed',
              stale: true,
              reason: 'weather_feed_refresh_failed',
            },
          };
        }
      })();

      WEATHER_FEED_INFLIGHT.set(cacheKey, backgroundRefresh);
      backgroundRefresh.finally(() => {
        WEATHER_FEED_INFLIGHT.delete(cacheKey);
      });
    }

    const stalePayload = {
      ...cached.payload,
      freshness: {
        ...cached.payload.freshness,
        fetchedAt: nowIso(),
        cacheHit: true,
        cacheLayer: 'weather_feed',
        stale: true,
        reason: 'weather_feed_stale_revalidate',
        coalesced: Boolean(existing),
        refreshing: true,
      },
    };

    return {
      ...stalePayload,
      economics: buildWeatherFeedEconomicsPayload(gateDecision, {
        degraded: true,
        reason: 'weather_feed_stale_revalidate',
      }),
    };
  }

  if (existing) {
    await registerWeatherFeedCost({
      economicsContext,
      operation: BACKEND_REQUEST_BASE,
      actualCostUsd: estimateWeatherFeedCostUsd(),
    });
    incrementWeatherMetric('coalescedRequests');
    const payload = await existing;
    return {
      ...payload,
      freshness: {
        ...payload.freshness,
        fetchedAt: nowIso(),
        coalesced: true,
      },
      economics: buildWeatherFeedEconomicsPayload(gateDecision),
    };
  }

  // SAFE MODE HARD OVERRIDE: Não chamar provider em safe mode
  // Retorna payload sintético determinístico e cacheia
  if (isSafeMode()) {
    const safePayload = buildSafeModeWeatherFeed({
      lat,
      lon,
      locale: safeLocale,
    });
    await writeWeatherFeedCacheEntry(cacheKey, {
      ...safePayload,
      freshness: {
        ...safePayload.freshness,
        fetchedAt: nowIso(),
        cacheHit: false,
        safeMode: true,
      },
    });
    recordWeatherSuccess();
    return {
      ...safePayload,
      freshness: {
        ...safePayload.freshness,
        fetchedAt: nowIso(),
        cacheHit: false,
        cacheLayer: 'safe_mode',
        stale: false,
        coalesced: false,
      },
      economics: buildWeatherFeedEconomicsPayload(gateDecision, {
        operation: BACKEND_REQUEST_BASE,
      }),
    };
  }

  // Verificar circuit breaker antes de fazer request ao provider
  if (!shouldAllowWeatherRequest()) {
    incrementWeatherMetric('timeouts');
    recordWeatherFailure();
    if (cached?.payload) {
      return {
        ...cached.payload,
        freshness: {
          ...cached.payload.freshness,
          fetchedAt: nowIso(),
          cacheHit: true,
          cacheLayer: 'weather_feed',
          stale: true,
          reason: 'circuit_breaker_open',
        },
      };
    }
    return buildUnavailableWeatherFeed(lat, lon);
  }

  const request = (async () => {
    try {
      recordWeatherFeedUpstreamCall();
      const {forecastResult: weatherResult, reverseResult} = await withTimeout(
        fetchWeatherFeedOpenMeteo(
          {
            latitude: lat,
            longitude: lon,
            locale: safeLocale,
          },
          {
            userAgent: config?.weather?.userAgent,
          },
        ),
        readWeatherFeedTimeoutMs(),
      );

      if (weatherResult?.timedOut) {
        incrementWeatherMetric('timeouts');
        recordWeatherFailure();
        if (cached?.payload) {
          return {
            ...cached.payload,
            freshness: {
              ...cached.payload.freshness,
              fetchedAt: nowIso(),
              cacheHit: true,
              cacheLayer: 'weather_feed',
              stale: true,
              reason: 'weather_feed_timeout_stale',
            },
          };
        }
        return buildUnavailableWeatherFeed(lat, lon);
      }

      if (!weatherResult.ok || !weatherResult.json) {
        incrementWeatherMetric('errors');
        recordWeatherFailure();
        if (cached?.payload) {
          return {
            ...cached.payload,
            freshness: {
              ...cached.payload.freshness,
              fetchedAt: nowIso(),
              cacheHit: true,
              cacheLayer: 'weather_feed',
              stale: true,
              reason: 'weather_feed_error_fallback',
            },
          };
        }
        return buildUnavailableWeatherFeed(lat, lon);
      }

      const weatherData = weatherResult.json;
      const city = reverseResult.ok
        ? resolveCityFromReverse(reverseResult.json)
        : '';
      const current = weatherData?.current || {};
      const daily = weatherData?.daily || {};
      const currentCode = Number(current?.weather_code || 0);
      const isDay = current?.is_day === 1 || current?.is_day === true;
      const currentVisual = mapWmoToIcon(currentCode, isDay);
      const forecastDays = buildForecastDaysFromDaily(daily);

      const result = {
        available: true,
        location: {
          city,
          latitude: lat,
          longitude: lon,
          timezone: String(weatherData?.timezone || 'UTC'),
        },
        current: {
          tempC: isFiniteNumber(current?.temperature_2m)
            ? Number(current.temperature_2m)
            : null,
          apparentTempC: isFiniteNumber(current?.apparent_temperature)
            ? Number(current.apparent_temperature)
            : null,
          humidity: isFiniteNumber(current?.relative_humidity_2m)
            ? clamp(Number(current.relative_humidity_2m), 0, 100)
            : null,
          windKmh: isFiniteNumber(current?.wind_speed_10m)
            ? Number(current.wind_speed_10m)
            : 0,
          weatherCode: currentCode,
          icon: currentVisual.icon,
          labelKey: currentVisual.labelKey,
          isDay,
          precipitation: isFiniteNumber(current?.precipitation)
            ? Number(current.precipitation)
            : 0,
          rain: isFiniteNumber(current?.rain) ? Number(current.rain) : 0,
          showers: isFiniteNumber(current?.showers)
            ? Number(current.showers)
            : 0,
          snowfall: isFiniteNumber(current?.snowfall)
            ? Number(current.snowfall)
            : 0,
        },
        daily: {
          maxTempC: isFiniteNumber(daily?.temperature_2m_max?.[0])
            ? Number(daily.temperature_2m_max[0])
            : null,
          minTempC: isFiniteNumber(daily?.temperature_2m_min?.[0])
            ? Number(daily.temperature_2m_min[0])
            : null,
          sunrise:
            typeof daily?.sunrise?.[0] === 'string' ? daily.sunrise[0] : '',
          sunset: typeof daily?.sunset?.[0] === 'string' ? daily.sunset[0] : '',
          forecastDays,
        },
        intelligenceSignal: buildIntelligenceSignal(weatherData),
        freshness: {
          fetchedAt: nowIso(),
          cacheTtlSec: 90,
          status: 'FRESH',
        },
      };
      writeWeatherFeedCacheEntry(cacheKey, result);
      recordWeatherSuccess();
      await registerWeatherFeedCost({
        economicsContext,
        operation: WEATHER_PROVIDER,
        actualCostUsd: estimateWeatherFeedCostUsd({
          includeProvider: true,
          includeRedis: true,
        }),
      });
      return result;
    } catch (error) {
      incrementWeatherMetric('errors');
      recordWeatherFailure();
      if (cached?.payload) {
        return {
          ...cached.payload,
          freshness: {
            ...cached.payload.freshness,
            fetchedAt: nowIso(),
            cacheHit: true,
            cacheLayer: 'weather_feed',
            stale: true,
            reason: 'weather_feed_error_fallback',
          },
        };
      }
      return buildUnavailableWeatherFeed(lat, lon);
    }
  })();

  WEATHER_FEED_INFLIGHT.set(cacheKey, request);
  try {
    return {
      ...(await request),
      economics: buildWeatherFeedEconomicsPayload(gateDecision),
    };
  } finally {
    WEATHER_FEED_INFLIGHT.delete(cacheKey);
  }
};

module.exports = {
  getWeatherFeed,
  buildUnavailableWeatherFeed,
  buildSafeModeWeatherFeed,
  mapWmoToIcon,
  getWeatherFeedMetrics,
  resetWeatherFeedMetrics,
  __buildForecastDaysFromDailyForTests: buildForecastDaysFromDaily,
  __countUsableBackendForecastDaysForTests: countUsableBackendForecastDays,
  __hasUsableBackendForecastForMobileForTests:
    hasUsableBackendForecastForMobile,
  __dangerousResetWeatherFeedCacheForTests: () => {
    WEATHER_FEED_CACHE.clear();
    WEATHER_FEED_INFLIGHT.clear();
    resetWeatherFeedMetrics();
  },
};
