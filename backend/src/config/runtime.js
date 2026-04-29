const crypto = require('node:crypto');
const os = require('node:os');

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

const readJsonObjectEnv = (key, env = process.env) => {
  const raw = readOptionalEnv(key, env);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (_error) {
    return {};
  }
};

const readAppEnv = (env = process.env) =>
  (readOptionalEnv('APP_ENV', env) ||
    readOptionalEnv('NODE_ENV', env) ||
    'development').toLowerCase();

const readFirstNonEmptyEnv = (keys, env = process.env) => {
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = readOptionalEnv(key, env);
    if (value) {
      return value;
    }
  }
  return '';
};

const sanitizeOpsIdentifier = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';

const normalizeProviderUrlForOps = value => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return null;
  }

  try {
    const parsed = new URL(normalizedValue);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch (_error) {
    return normalizedValue.replace(/\/+$/, '');
  }
};

const buildRouteRuntimeSignature = routingConfig => {
  const regionProviderBaseUrls = Object.fromEntries(
    Object.entries(routingConfig?.regionProviderBaseUrls || {})
      .map(([regionKey, baseUrl]) => [
        String(regionKey || '').trim().toLowerCase(),
        normalizeProviderUrlForOps(baseUrl),
      ])
      .filter(([regionKey, baseUrl]) => regionKey && baseUrl)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    providerBaseUrl: normalizeProviderUrlForOps(routingConfig?.providerBaseUrl),
    fallbackProviderBaseUrl: normalizeProviderUrlForOps(
      routingConfig?.fallbackProviderBaseUrl,
    ),
    regionProviderBaseUrls,
    timeoutMs: Number(routingConfig?.timeoutMs || 0),
    retries: Number(routingConfig?.retries || 0),
    retryDelayMs: Number(routingConfig?.retryDelayMs || 0),
    maxTotalWaitMs: Number(routingConfig?.maxTotalWaitMs || 0),
    failureThreshold: Number(routingConfig?.failureThreshold || 0),
    cooldownMs: Number(routingConfig?.cooldownMs || 0),
    maxConcurrentRequests: Number(routingConfig?.maxConcurrentRequests || 0),
    cacheTtlMs: Number(routingConfig?.cacheTtlMs || 0),
    staleRouteTtlMs: Number(routingConfig?.staleRouteTtlMs || 0),
    staleRouteMaxEntries: Number(routingConfig?.staleRouteMaxEntries || 0),
    maxPerMinute: Number(routingConfig?.maxPerMinute || 0),
  };
};

const buildRouteRuntimeDiagnostics = (config = null, env = process.env) => {
  const resolvedConfig = config || getRuntimeConfig(env);
  const routing = buildRouteRuntimeSignature(resolvedConfig?.routing || {});
  const signature = JSON.stringify(routing);

  return {
    environment: readAppEnv(env),
    deployId: sanitizeOpsIdentifier(
      readFirstNonEmptyEnv(
        [
          'ALERT_RELEASE_VERSION',
          'RENDER_GIT_COMMIT',
          'RENDER_DEPLOY_ID',
          'RENDER_SERVICE_ID',
        ],
        env,
      ),
    ),
    instanceId: sanitizeOpsIdentifier(
      readFirstNonEmptyEnv(
        ['RENDER_INSTANCE_ID', 'HOSTNAME', 'COMPUTERNAME'],
        env,
      ) || os.hostname(),
    ),
    configFingerprint: crypto
      .createHash('sha1')
      .update(signature)
      .digest('hex')
      .slice(0, 12),
    routing: {
      ...routing,
      regionKeys: Object.keys(routing.regionProviderBaseUrls),
    },
  };
};

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

const readRegionalProviderBaseUrls = (key, env = process.env) => {
  const configured = readJsonObjectEnv(key, env);
  return Object.entries(configured).reduce((accumulator, [regionKey, baseUrl]) => {
    const normalizedRegionKey = String(regionKey || '').trim().toLowerCase();
    const normalizedBaseUrl = String(baseUrl || '').trim();
    if (!normalizedRegionKey || !normalizedBaseUrl) {
      return accumulator;
    }
    accumulator[normalizedRegionKey] = normalizedBaseUrl;
    return accumulator;
  }, {});
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
    fallbackProviderBaseUrl: readOptionalEnv(
      'ROUTING_OSRM_FALLBACK_BASE_URL',
      env,
    ),
    regionProviderBaseUrls: readRegionalProviderBaseUrls(
      'ROUTING_OSRM_REGION_BASE_URLS_JSON',
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
      readNumberEnv('ROUTING_PROVIDER_MAX_CONCURRENT_REQUESTS', 4, env),
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
  readJsonObjectEnv,
  readAppEnv,
  readFirstNonEmptyEnv,
  sanitizeOpsIdentifier,
  normalizeProviderUrlForOps,
  allowPublicProviderDefaults,
  readProviderBaseUrl,
  readRegionalProviderBaseUrls,
  buildRouteRuntimeDiagnostics,
  buildRuntimeConfig,
  getRuntimeConfig,
  validateRuntimeConfig,
};
