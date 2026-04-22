const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const clampPercent = value => Math.max(0, Math.min(100, Number(value || 0)));

const readOptionalEnv = (key, env = process.env) =>
  String(env[key] || '').trim();

const readRequiredEnv = (key, env = process.env) => {
  const value = readOptionalEnv(key, env);
  if (!value) {
    const error = new Error(`missing_env_${String(key || '').toLowerCase()}`);
    error.statusCode = 500;
    throw error;
  }
  return value;
};

const readBooleanEnv = (key, defaultValue = false, env = process.env) => {
  const raw = readOptionalEnv(key, env).toLowerCase();
  if (!raw) return defaultValue;
  return BOOLEAN_TRUE_VALUES.has(raw);
};

const readCsvSet = (key, env = process.env) =>
  new Set(
    readOptionalEnv(key, env)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  );

const readNumberEnv = (key, defaultValue, env = process.env) => {
  const raw = readOptionalEnv(key, env);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const readAppEnv = (env = process.env) =>
  (readOptionalEnv('APP_ENV', env) ||
    readOptionalEnv('NODE_ENV', env) ||
    'development').toLowerCase();

const allowPublicProviderDefaults = (env = process.env) =>
  readBooleanEnv(
    'ALERT_ALLOW_PUBLIC_PROVIDER_DEFAULTS',
    readAppEnv(env) !== 'production',
    env,
  );

const readProviderBaseUrl = (key, fallback, env = process.env) => {
  const configured = readOptionalEnv(key, env);
  if (configured) {
    return configured;
  }
  if (!allowPublicProviderDefaults(env)) {
    const error = new Error(`missing_env_${String(key || '').toLowerCase()}`);
    error.statusCode = 500;
    throw error;
  }
  return fallback;
};

const buildRuntimeConfig = (env = process.env) => ({
  app: {
    environment: readAppEnv(env),
    allowPublicProviderDefaults: allowPublicProviderDefaults(env),
  },
  server: {
    host: readOptionalEnv('HOST', env) || '0.0.0.0',
    port: Math.max(1, readNumberEnv('PORT', 5005, env)),
  },
  guardians: {
    conversationId:
      readOptionalEnv('GUARDIANS_CONVERSATION_ID', env) ||
      'guardians-group',
  },
  relay: {
    hmacSecret: readRequiredEnv('RELAY_HMAC_SECRET', env),
    tokenTtlSec: Math.max(120, readNumberEnv('RELAY_TOKEN_TTL_SEC', 900, env)),
    maxClockSkewMs: 2 * 60 * 1000,
  },
  premium: {
    defaultPremium: readBooleanEnv('ALERT_PREMIUM_DEFAULT', false, env),
    forcedUsers: readCsvSet('ALERT_PREMIUM_USERS', env),
    rollout: {
      starlinkConnectPercent: clampPercent(
        readNumberEnv('STARLINK_CONNECT_ROLLOUT_PERCENT', 100, env),
      ),
      starlinkTunnelPercent: clampPercent(
        readNumberEnv('STARLINK_TUNNEL_ROLLOUT_PERCENT', 0, env),
      ),
      starlinkExclusivePercent: clampPercent(
        readNumberEnv('STARLINK_EXCLUSIVE_ROLLOUT_PERCENT', 100, env),
      ),
    },
  },
  epidemic: {
    notificaBaseUrl: readProviderBaseUrl(
      'EPIDEMIC_BR_NOTIFICA_BASE_URL',
      'https://notifica-prd-es.saude.gov.br',
      env,
    ),
    notificaBasicAuth: readOptionalEnv('EPIDEMIC_BR_NOTIFICA_BASIC_AUTH', env),
  },
  weather: {
    userAgent:
      readOptionalEnv('WEATHER_FEED_USER_AGENT', env) ||
      'AlertBackend/1.0 (+support@alertapp.com)',
  },
  routing: {
    providerBaseUrl: readProviderBaseUrl(
      'ROUTING_OSRM_BASE_URL',
      'https://router.project-osrm.org/route/v1',
      env,
    ),
    timeoutMs: Math.max(
      900,
      readNumberEnv('ROUTING_PROVIDER_TIMEOUT_MS', 1400, env),
    ),
    retries: Math.max(0, readNumberEnv('ROUTING_PROVIDER_RETRIES', 0, env)),
    retryDelayMs: Math.max(
      80,
      readNumberEnv('ROUTING_PROVIDER_RETRY_DELAY_MS', 120, env),
    ),
    maxTotalWaitMs: Math.max(
      1_000,
      readNumberEnv('ROUTING_PROVIDER_MAX_TOTAL_WAIT_MS', 1_600, env),
    ),
    cooldownMs: Math.max(
      5_000,
      readNumberEnv('ROUTING_PROVIDER_COOLDOWN_MS', 30_000, env),
    ),
    failureThreshold: Math.max(
      2,
      readNumberEnv('ROUTING_PROVIDER_FAILURE_THRESHOLD', 2, env),
    ),
    maxConcurrentRequests: Math.max(
      1,
      readNumberEnv('ROUTING_PROVIDER_MAX_CONCURRENT_REQUESTS', 2, env),
    ),
    cacheTtlMs: Math.max(
      30_000,
      readNumberEnv('ROUTING_PROVIDER_CACHE_TTL_MS', 5 * 60 * 1000, env),
    ),
    staleRouteTtlMs: Math.max(
      60_000,
      readNumberEnv('ROUTING_PROVIDER_STALE_ROUTE_TTL_MS', 15 * 60 * 1000, env),
    ),
    staleRouteMaxEntries: Math.max(
      100,
      readNumberEnv('ROUTING_PROVIDER_STALE_ROUTE_MAX_ENTRIES', 1000, env),
    ),
    maxPerMinute: Math.max(
      30,
      readNumberEnv('ROUTING_PROVIDER_MAX_PER_MINUTE', 120, env),
    ),
  },
});

let cachedRuntimeConfig = null;

const getRuntimeConfig = (env = process.env) => {
  if (!cachedRuntimeConfig || env !== process.env) {
    cachedRuntimeConfig = buildRuntimeConfig(env);
  }
  return cachedRuntimeConfig;
};

const validateRuntimeConfig = (env = process.env) => getRuntimeConfig(env);

module.exports = {
  clampPercent,
  readOptionalEnv,
  readRequiredEnv,
  readBooleanEnv,
  readCsvSet,
  readNumberEnv,
  readAppEnv,
  allowPublicProviderDefaults,
  readProviderBaseUrl,
  buildRuntimeConfig,
  getRuntimeConfig,
  validateRuntimeConfig,
};
