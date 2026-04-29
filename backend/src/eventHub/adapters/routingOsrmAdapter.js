const { fetchJsonWithRetry } = require('../fetcher');

const ROUTING_PROVIDER_ID = 'osrm';
const DEFAULT_ROUTE_BASE_URL = 'https://router.project-osrm.org/route/v1';
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_TOTAL_WAIT_MS = 1_600;
const DEFAULT_STALE_ROUTE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_STALE_ROUTE_MAX_ENTRIES = 1000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;
const DEFAULT_TIMEOUT_MS = 1_400;
const DEFAULT_RETRY_DELAY_MS = 120;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_SOURCE_PRIORITY = {
  region: 0,
  primary: 1,
  fallback: 2,
};

const MODE_TO_PROFILE = {
  car: 'driving',
  bus: 'driving',
  motorcycle: 'driving',
  bike: 'cycling',
  walk: 'walking',
};

const PROVIDER_CIRCUIT_STATES = new Map();
const PROVIDER_ACTIVE_REQUESTS = new Map();
const PROVIDER_TARGET_PREFERENCES = new Map();
const STALE_ROUTE_CACHE = new Map();

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const buildEmptyProviderState = () => ({
  consecutiveFailures: 0,
  openUntil: 0,
  lastReasonCode: null,
  lastFailureAt: null,
});

const resolveRegionScope = (regionHint, providerTarget) =>
  normalizeRegionHint(regionHint) ||
  normalizeRegionHint(providerTarget?.regionKey) ||
  'global';

const buildProviderHealthKey = (providerTarget, mode, regionHint) =>
  sanitizeProviderTargetId(
    `${providerTarget?.targetId || `${ROUTING_PROVIDER_ID}:primary`}:${normalizeMode(
      mode,
    )}:${resolveRegionScope(regionHint, providerTarget)}`,
  );

const getProviderCircuitState = healthKey => {
  const key = String(healthKey || `${ROUTING_PROVIDER_ID}:primary:car:global`);
  if (!PROVIDER_CIRCUIT_STATES.has(key)) {
    PROVIDER_CIRCUIT_STATES.set(key, buildEmptyProviderState());
  }
  return PROVIDER_CIRCUIT_STATES.get(key);
};

const getActiveRequestCount = targetId =>
  Math.max(0, Number(PROVIDER_ACTIVE_REQUESTS.get(String(targetId || 'unknown')) || 0));

const incrementActiveRequestCount = targetId => {
  const key = String(targetId || 'unknown');
  PROVIDER_ACTIVE_REQUESTS.set(key, getActiveRequestCount(key) + 1);
};

const decrementActiveRequestCount = targetId => {
  const key = String(targetId || 'unknown');
  const nextValue = Math.max(0, getActiveRequestCount(key) - 1);
  if (nextValue <= 0) {
    PROVIDER_ACTIVE_REQUESTS.delete(key);
    return;
  }
  PROVIDER_ACTIVE_REQUESTS.set(key, nextValue);
};

const buildProviderPreferenceKey = (mode, regionHint, providerTarget) =>
  `${normalizeMode(mode)}:${resolveRegionScope(regionHint, providerTarget)}`;

const rememberPreferredProviderTarget = (mode, regionHint, providerTarget) => {
  PROVIDER_TARGET_PREFERENCES.set(
    buildProviderPreferenceKey(mode, regionHint, providerTarget),
    sanitizeProviderTargetId(providerTarget?.targetId || `${ROUTING_PROVIDER_ID}:primary`),
  );
};

const clearPreferredProviderTarget = (mode, regionHint, providerTarget) => {
  PROVIDER_TARGET_PREFERENCES.delete(
    buildProviderPreferenceKey(mode, regionHint, providerTarget),
  );
};

const readPreferredProviderTargetId = (mode, regionHint, providerTarget) =>
  PROVIDER_TARGET_PREFERENCES.get(
    buildProviderPreferenceKey(mode, regionHint, providerTarget),
  ) || null;

const readProviderSourcePriority = providerTarget =>
  Number(
    PROVIDER_SOURCE_PRIORITY[String(providerTarget?.source || '').trim().toLowerCase()],
  );

const normalizeMode = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'car' || normalized === 'drive' || normalized === 'driving') {
    return 'car';
  }
  if (normalized === 'bus') return 'bus';
  if (normalized === 'motorcycle') return 'motorcycle';
  if (normalized === 'bike' || normalized === 'bicycle' || normalized === 'cycling') {
    return 'bike';
  }
  if (
    normalized === 'walk' ||
    normalized === 'walking' ||
    normalized === 'pedestrian' ||
    normalized === 'foot'
  ) {
    return 'walk';
  }
  return 'car';
};

const normalizeRegionHint = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

const sanitizeProviderTargetId = value =>
  String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';

const buildProviderTarget = ({ source, baseUrl, regionKey }) => {
  const normalizedSource = String(source || 'primary').trim().toLowerCase();
  const normalizedRegionKey = normalizeRegionHint(regionKey);
  let targetId = `${ROUTING_PROVIDER_ID}:${normalizedSource}`;
  if (normalizedSource === 'region' && normalizedRegionKey) {
    targetId = `${ROUTING_PROVIDER_ID}:region:${normalizedRegionKey}`;
  }
  return {
    source: normalizedSource,
    baseUrl: String(baseUrl || '').trim(),
    regionKey: normalizedRegionKey || null,
    targetId: sanitizeProviderTargetId(targetId),
  };
};

const normalizeProviderBaseUrl = value =>
  String(value || '').trim().replace(/\/+$/, '') || null;

const resolveRegionalProviderBaseUrl = (regionHint, routingConfig) => {
  const normalizedRegionHint = normalizeRegionHint(regionHint);
  if (!normalizedRegionHint) return null;
  const configuredMap =
    routingConfig && typeof routingConfig.regionProviderBaseUrls === 'object'
      ? routingConfig.regionProviderBaseUrls
      : {};
  if (configuredMap[normalizedRegionHint]) {
    return {
      regionKey: normalizedRegionHint,
      baseUrl: configuredMap[normalizedRegionHint],
    };
  }

  let bestMatch = null;
  for (const [configuredRegionKey, baseUrl] of Object.entries(configuredMap)) {
    const normalizedConfiguredKey = normalizeRegionHint(configuredRegionKey);
    if (
      normalizedConfiguredKey &&
      (normalizedRegionHint === normalizedConfiguredKey ||
        normalizedRegionHint.startsWith(`${normalizedConfiguredKey}-`))
    ) {
      if (
        !bestMatch ||
        normalizedConfiguredKey.length > bestMatch.regionKey.length
      ) {
        bestMatch = {
          regionKey: normalizedConfiguredKey,
          baseUrl,
        };
      }
    }
  }
  return bestMatch;
};

const resolveProviderTargets = (routingConfig, regionHint, mode) => {
  const targets = [];
  const seenBaseUrls = new Set();
  const appendTarget = params => {
    const next = buildProviderTarget(params);
    if (!next.baseUrl) return;
    const dedupeKey = next.baseUrl.replace(/\/+$/, '');
    if (seenBaseUrls.has(dedupeKey)) return;
    seenBaseUrls.add(dedupeKey);
    targets.push(next);
  };

  const regionalTarget = resolveRegionalProviderBaseUrl(regionHint, routingConfig);
  if (regionalTarget) {
    appendTarget({
      source: 'region',
      baseUrl: regionalTarget.baseUrl,
      regionKey: regionalTarget.regionKey,
    });
  }

  appendTarget({
    source: 'primary',
    baseUrl: routingConfig?.providerBaseUrl || DEFAULT_ROUTE_BASE_URL,
  });

  appendTarget({
    source: 'fallback',
    baseUrl: routingConfig?.fallbackProviderBaseUrl || '',
  });

  const preferredTargetId = readPreferredProviderTargetId(mode, regionHint, {
    regionKey: resolveRegionalProviderBaseUrl(regionHint, routingConfig)?.regionKey || null,
  });
  if (!preferredTargetId) {
    return targets;
  }

  return targets.sort((left, right) => {
    const leftPriority = readProviderSourcePriority(left);
    const rightPriority = readProviderSourcePriority(right);
    if (Number.isFinite(leftPriority) || Number.isFinite(rightPriority)) {
      const normalizedLeftPriority = Number.isFinite(leftPriority) ? leftPriority : 99;
      const normalizedRightPriority = Number.isFinite(rightPriority)
        ? rightPriority
        : 99;
      if (normalizedLeftPriority !== normalizedRightPriority) {
        return normalizedLeftPriority - normalizedRightPriority;
      }
    }
    if (left.targetId === preferredTargetId && right.targetId !== preferredTargetId) {
      return -1;
    }
    if (right.targetId === preferredTargetId && left.targetId !== preferredTargetId) {
      return 1;
    }
    return 0;
  });
};

const buildRoutingProviderDebugSnapshot = (
  { regionHint, transportMode },
  { config } = {},
) => {
  const routingConfig = config?.routing || {};
  const resolvedRegionalTarget = resolveRegionalProviderBaseUrl(
    regionHint,
    routingConfig,
  );
  const candidateTargets = resolveProviderTargets(
    routingConfig,
    regionHint,
    transportMode,
  ).map(providerTarget => ({
    targetId: providerTarget.targetId,
    source: providerTarget.source,
    regionKey: providerTarget.regionKey || null,
    baseUrl: normalizeProviderBaseUrl(providerTarget.baseUrl),
  }));

  return {
    requestedRegionHint: String(regionHint || '').trim() || null,
    normalizedRegionHint: normalizeRegionHint(regionHint) || null,
    resolvedRegionalTarget: resolvedRegionalTarget
      ? {
          targetId: buildProviderTarget({
            source: 'region',
            baseUrl: resolvedRegionalTarget.baseUrl,
            regionKey: resolvedRegionalTarget.regionKey,
          }).targetId,
          regionKey: normalizeRegionHint(resolvedRegionalTarget.regionKey) || null,
          baseUrl: normalizeProviderBaseUrl(resolvedRegionalTarget.baseUrl),
        }
      : null,
    candidateTargets,
  };
};

const isStrictFiniteNumber = value => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return Number.isFinite(Number(value));
};

const buildTitle = (index, mode) => {
  if (index === 0) return 'Fastest';
  return `${String(mode || 'route').toUpperCase()} ${index + 1}`;
};

const readCircuitState = (providerState, nowMs) => {
  if (providerState.openUntil > nowMs) return 'open';
  if (
    providerState.openUntil > 0 &&
    providerState.openUntil <= nowMs &&
    providerState.consecutiveFailures > 0
  ) {
    return 'half_open';
  }
  return 'closed';
};

const resetCircuit = providerState => {
  providerState.consecutiveFailures = 0;
  providerState.openUntil = 0;
  providerState.lastReasonCode = null;
  providerState.lastFailureAt = null;
};

const buildMeta = params => ({
  providerTargetId: params?.providerTargetId || `${ROUTING_PROVIDER_ID}:primary`,
  providerSource: params?.providerSource || 'primary',
  providerRegionKey: params?.providerRegionKey || null,
  circuitState: params?.circuitState || 'closed',
  attempts: Number.isFinite(params?.attempts) ? params.attempts : 0,
  cacheHit: Boolean(params?.cacheHit),
  latencyMs: Number.isFinite(params?.latencyMs) ? params.latencyMs : 0,
  timeoutMs: Number.isFinite(params?.timeoutMs) ? params.timeoutMs : 0,
  lastFailureAt: params?.lastFailureAt || null,
});

const logProviderEvent = (logger, level, event, payload) => {
  const target = logger && typeof logger[level] === 'function' ? logger[level] : null;
  if (!target) return;
  target(`[routing/osrm] ${event}`, payload);
};

const classifyFailure = response => {
  if (response?.status === 429 || response?.error === 'provider_rate_limited') {
    return {
      reasonCode: 'routing_provider_rate_limited',
      retryable: true,
      transient: true,
    };
  }

  if (response?.errorType === 'timeout') {
    return {
      reasonCode: 'routing_provider_timeout',
      retryable: true,
      transient: true,
    };
  }

  if (
    response?.errorType === 'network' ||
    response?.status >= 500 ||
    response?.status === 0
  ) {
    return {
      reasonCode: 'routing_provider_unavailable',
      retryable: true,
      transient: true,
    };
  }

  return {
    reasonCode: 'routing_provider_invalid_response',
    retryable: false,
    transient: false,
  };
};

const registerFailure = (providerState, failure, config, nowMs) => {
  if (!failure?.transient) return readCircuitState(providerState, nowMs);

  providerState.consecutiveFailures += 1;
  providerState.lastReasonCode = failure.reasonCode || 'routing_provider_unavailable';
  providerState.lastFailureAt = new Date(nowMs).toISOString();

  const failureThreshold = Math.max(
    2,
    Number(config?.routing?.failureThreshold || DEFAULT_FAILURE_THRESHOLD),
  );
  if (providerState.consecutiveFailures >= failureThreshold) {
    const cooldownMs = Math.max(
      5_000,
      Number(config?.routing?.cooldownMs || DEFAULT_COOLDOWN_MS),
    );
    providerState.openUntil = nowMs + cooldownMs;
  }

  return readCircuitState(providerState, nowMs);
};

const registerSuccess = providerState => {
  resetCircuit(providerState);
};

const toBackendRoute = (route, index, mode) => {
  const geometry = Array.isArray(route?.geometry?.coordinates)
    ? route.geometry.coordinates
    : [];
  if (geometry.length < 2) return null;

  const distanceMeters = Number(route?.distance);
  const durationSec = Number(route?.duration);

  return {
    id: `osrm-${mode}-${index}`,
    title: buildTitle(index, mode),
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    geometry,
    trafficLevel: 'unknown',
  };
};

const destinationSafe = value => Number(value).toFixed(6);

const readStaleRouteTtlMs = config =>
  Math.max(
    30_000,
    Number(config?.routing?.staleRouteTtlMs || DEFAULT_STALE_ROUTE_TTL_MS),
  );

const readStaleRouteMaxEntries = config =>
  Math.max(
    25,
    Number(
      config?.routing?.staleRouteMaxEntries || DEFAULT_STALE_ROUTE_MAX_ENTRIES,
    ),
  );

const readMaxConcurrentRequests = config =>
  Math.max(
    1,
    Number(
      config?.routing?.maxConcurrentRequests ||
        DEFAULT_MAX_CONCURRENT_REQUESTS,
    ),
  );

const buildRouteCacheKey = ({
  mode,
  originLat,
  originLon,
  destinationLat,
  destinationLon,
}) =>
  `maps-route:${mode}:` +
  `${originLat.toFixed(4)}:${originLon.toFixed(4)}:` +
  `${destinationLat.toFixed(4)}:${destinationLon.toFixed(4)}`;

const pruneStaleRouteCache = maxEntries => {
  while (STALE_ROUTE_CACHE.size > maxEntries) {
    const oldestKey = STALE_ROUTE_CACHE.keys().next().value;
    if (!oldestKey) break;
    STALE_ROUTE_CACHE.delete(oldestKey);
  }
};

const writeStaleRouteSnapshot = (cacheKey, payload, config) => {
  if (!cacheKey || !payload?.routes?.length) return;
  STALE_ROUTE_CACHE.set(cacheKey, {
    payload: {
      routes: payload.routes,
      updatedAt: payload.updatedAt,
      transportMode: payload.transportMode,
    },
    expiresAt: Date.now() + readStaleRouteTtlMs(config),
  });
  pruneStaleRouteCache(readStaleRouteMaxEntries(config));
};

const readStaleRouteSnapshot = cacheKey => {
  const row = STALE_ROUTE_CACHE.get(cacheKey);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    STALE_ROUTE_CACHE.delete(cacheKey);
    return null;
  }
  return row.payload;
};

const buildStaleSnapshotResponse = ({
  staleSnapshot,
  mode,
  providerTarget,
  circuitState,
  attempts = 0,
  latencyMs = 0,
  timeoutMs = 0,
}) => ({
  ok: true,
  status: 200,
  error: null,
  reasonCode: 'routing_provider_stale_snapshot',
  retryable: true,
  degraded: true,
  stale: true,
  routes: staleSnapshot.routes,
  updatedAt: staleSnapshot.updatedAt || new Date().toISOString(),
  providerId: ROUTING_PROVIDER_ID,
  providerTargetId: providerTarget?.targetId || `${ROUTING_PROVIDER_ID}:primary`,
  providerSource: providerTarget?.source || 'primary',
  providerRegionKey: providerTarget?.regionKey || null,
  transportMode: mode,
  meta: buildMeta({
    providerTargetId: providerTarget?.targetId,
    providerSource: providerTarget?.source,
    providerRegionKey: providerTarget?.regionKey,
    circuitState,
    attempts,
    cacheHit: true,
    latencyMs,
    timeoutMs,
    lastFailureAt: null,
  }),
});

const buildProviderFailurePayload = ({
  mode,
  providerTarget,
  circuitState,
  attempts = 0,
  latencyMs = 0,
  timeoutMs = 0,
  status = 503,
  error = 'routing_provider_unavailable',
  reasonCode = 'routing_provider_unavailable',
  retryable = true,
  degraded = true,
  updatedAt,
  lastFailureAt = null,
}) => ({
  ok: false,
  status,
  error,
  reasonCode,
  retryable,
  degraded,
  routes: [],
  updatedAt: updatedAt || new Date().toISOString(),
  providerId: ROUTING_PROVIDER_ID,
  providerTargetId: providerTarget?.targetId || `${ROUTING_PROVIDER_ID}:primary`,
  providerSource: providerTarget?.source || 'primary',
  providerRegionKey: providerTarget?.regionKey || null,
  transportMode: mode,
  meta: buildMeta({
    providerTargetId: providerTarget?.targetId,
    providerSource: providerTarget?.source,
    providerRegionKey: providerTarget?.regionKey,
    circuitState,
    attempts,
    cacheHit: false,
    latencyMs,
    timeoutMs,
    lastFailureAt,
  }),
});

const computeRetryBudget = ({
  configuredRetries,
  timeoutMs,
  retryDelayMs,
  maxTotalWaitMs,
}) => {
  const retries = Math.max(0, Number(configuredRetries || 0));
  const boundedTimeoutMs = Math.max(100, Number(timeoutMs || 0));
  const boundedRetryDelayMs = Math.max(0, Number(retryDelayMs || 0));
  const totalBudgetMs = Math.max(
    boundedTimeoutMs,
    Number(maxTotalWaitMs || DEFAULT_MAX_TOTAL_WAIT_MS),
  );

  let allowedRetries = 0;
  let projectedWaitMs = boundedTimeoutMs;

  while (allowedRetries < retries) {
    const nextAttemptWaitMs =
      projectedWaitMs +
      boundedRetryDelayMs * (allowedRetries + 1) +
      boundedTimeoutMs;
    if (nextAttemptWaitMs > totalBudgetMs) {
      break;
    }
    allowedRetries += 1;
    projectedWaitMs = nextAttemptWaitMs;
  }

  return allowedRetries;
};

const PRIMARY_PROVIDER_MIN_TIMEOUT_MS = 900;
const ALTERNATE_PROVIDER_MIN_TIMEOUT_MS = 250;

const readMinimumAttemptTimeoutMs = targetIndex =>
  targetIndex > 0
    ? ALTERNATE_PROVIDER_MIN_TIMEOUT_MS
    : PRIMARY_PROVIDER_MIN_TIMEOUT_MS;

const canTryAnotherProviderTarget = (targets, currentIndex, remainingBudgetMs) =>
  currentIndex < targets.length - 1 &&
  Number(remainingBudgetMs || 0) >= readMinimumAttemptTimeoutMs(currentIndex + 1);

const fetchRouteOptions = async (
  { fromLat, fromLon, toLat, toLon, transportMode, regionHint },
  {
    userAgent,
    config,
    fetchJson = fetchJsonWithRetry,
    logger = silentLogger,
    now = Date.now,
  } = {},
) => {
  const startedAt = now();
  const originLat = Number(fromLat);
  const originLon = Number(fromLon);
  const destinationLat = Number(toLat);
  const destinationLon = Number(toLon);

  if (
    !isStrictFiniteNumber(fromLat) ||
    !isStrictFiniteNumber(fromLon) ||
    !isStrictFiniteNumber(toLat) ||
    !isStrictFiniteNumber(toLon) ||
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLon) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLon)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_coordinates',
      reasonCode: 'invalid_coordinates',
      retryable: false,
      degraded: false,
      routes: [],
      updatedAt: new Date(startedAt).toISOString(),
      providerId: ROUTING_PROVIDER_ID,
      providerTargetId: `${ROUTING_PROVIDER_ID}:primary`,
      providerSource: 'primary',
      providerRegionKey: normalizeRegionHint(regionHint) || null,
      transportMode: normalizeMode(transportMode),
      meta: buildMeta({
        providerRegionKey: normalizeRegionHint(regionHint) || null,
        circuitState: 'closed',
        lastFailureAt: null,
      }),
    };
  }

  const mode = normalizeMode(transportMode);
  const routingConfig = config?.routing || {};
  const timeoutMs = Math.max(
    900,
    Number(routingConfig.timeoutMs || DEFAULT_TIMEOUT_MS),
  );
  const retryDelayMs = Math.max(
    80,
    Number(routingConfig.retryDelayMs || DEFAULT_RETRY_DELAY_MS),
  );
  const maxTotalWaitMs = Math.max(
    timeoutMs,
    Number(routingConfig.maxTotalWaitMs || DEFAULT_MAX_TOTAL_WAIT_MS),
  );
  const retries = computeRetryBudget({
    configuredRetries: Number(routingConfig.retries || 0),
    timeoutMs,
    retryDelayMs,
    maxTotalWaitMs,
  });
  const cacheKey = buildRouteCacheKey({
    mode,
    originLat,
    originLon,
    destinationLat,
    destinationLon,
  });
  const staleSnapshot = readStaleRouteSnapshot(cacheKey);
  const providerTargets = resolveProviderTargets(routingConfig, regionHint, mode);
  const profile = MODE_TO_PROFILE[mode] || MODE_TO_PROFILE.car;
  const alternatives = profile === 'driving' ? 'true' : 'false';
  const maxConcurrentRequests = readMaxConcurrentRequests(config);
  const deadlineMs = startedAt + maxTotalWaitMs;
  let lastFailurePayload = null;

  for (let targetIndex = 0; targetIndex < providerTargets.length; targetIndex += 1) {
    const providerTarget = providerTargets[targetIndex];
    const providerHealthKey = buildProviderHealthKey(providerTarget, mode, regionHint);
    const providerState = getProviderCircuitState(providerHealthKey);
    const attemptStartedAt = now();
    const remainingBudgetMs = Math.max(
      0,
      deadlineMs - Number(attemptStartedAt || Date.now()),
    );
    const currentCircuitState = readCircuitState(providerState, attemptStartedAt);
    const lastFailureAt = providerState.lastFailureAt;

    if (remainingBudgetMs < readMinimumAttemptTimeoutMs(targetIndex)) {
      if (staleSnapshot) {
        logProviderEvent(logger, 'warn', 'stale_snapshot_preferred', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          transportMode: mode,
          reasonCode: 'routing_provider_budget_exhausted',
          circuitState: currentCircuitState,
        });
        return buildStaleSnapshotResponse({
          staleSnapshot,
          mode,
          providerTarget,
          circuitState: currentCircuitState,
          timeoutMs,
        });
      }
      lastFailurePayload = buildProviderFailurePayload({
        mode,
        providerTarget,
        circuitState: currentCircuitState,
        timeoutMs,
        status: 503,
        error: 'routing_provider_budget_exhausted',
        reasonCode: 'routing_provider_budget_exhausted',
        retryable: true,
        degraded: true,
        lastFailureAt,
      });
      break;
    }

    if (currentCircuitState === 'open') {
      logProviderEvent(logger, 'warn', 'short_circuit', {
        providerId: ROUTING_PROVIDER_ID,
        providerTargetId: providerTarget.targetId,
        providerSource: providerTarget.source,
        providerRegionKey: providerTarget.regionKey,
        providerBaseUrl: providerTarget.baseUrl,
        reasonCode:
          providerState.lastReasonCode || 'routing_provider_circuit_open',
        transportMode: mode,
        circuitState: currentCircuitState,
        retryable: true,
      });

      if (canTryAnotherProviderTarget(providerTargets, targetIndex, remainingBudgetMs)) {
        logProviderEvent(logger, 'warn', 'provider_fallback_next', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          nextProviderTargetId: providerTargets[targetIndex + 1]?.targetId || null,
          reasonCode:
            providerState.lastReasonCode || 'routing_provider_circuit_open',
          transportMode: mode,
        });
        continue;
      }

      if (staleSnapshot) {
        return buildStaleSnapshotResponse({
          staleSnapshot,
          mode,
          providerTarget,
          circuitState: currentCircuitState,
          timeoutMs,
        });
      }

      return buildProviderFailurePayload({
        mode,
        providerTarget,
        circuitState: currentCircuitState,
        timeoutMs,
        status: 503,
        error: 'routing_provider_circuit_open',
        reasonCode: 'routing_provider_circuit_open',
        retryable: true,
        degraded: true,
        lastFailureAt,
      });
    }

    const activeRequests = getActiveRequestCount(providerTarget.targetId);
    if (activeRequests >= maxConcurrentRequests) {
      logProviderEvent(logger, 'warn', 'provider_saturated', {
        providerId: ROUTING_PROVIDER_ID,
        providerTargetId: providerTarget.targetId,
        providerSource: providerTarget.source,
        providerRegionKey: providerTarget.regionKey,
        providerBaseUrl: providerTarget.baseUrl,
        transportMode: mode,
        activeRequests,
        maxConcurrentRequests,
      });

      if (canTryAnotherProviderTarget(providerTargets, targetIndex, remainingBudgetMs)) {
        logProviderEvent(logger, 'warn', 'provider_fallback_next', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          nextProviderTargetId: providerTargets[targetIndex + 1]?.targetId || null,
          reasonCode: 'routing_provider_saturated',
          transportMode: mode,
        });
        continue;
      }

      if (staleSnapshot) {
        logProviderEvent(logger, 'warn', 'provider_saturated_stale_snapshot', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          transportMode: mode,
          activeRequests,
          maxConcurrentRequests,
        });
        return buildStaleSnapshotResponse({
          staleSnapshot,
          mode,
          providerTarget,
          circuitState: 'saturated',
          timeoutMs,
        });
      }

      return buildProviderFailurePayload({
        mode,
        providerTarget,
        circuitState: 'saturated',
        timeoutMs,
        status: 503,
        error: 'routing_provider_saturated',
        reasonCode: 'routing_provider_saturated',
        retryable: true,
        degraded: true,
        lastFailureAt,
      });
    }

    const routeBaseUrl = String(providerTarget.baseUrl || DEFAULT_ROUTE_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const url =
      `${routeBaseUrl}/${profile}/` +
      `${destinationSafe(originLon)},${destinationSafe(originLat)};` +
      `${destinationSafe(destinationLon)},${destinationSafe(destinationLat)}` +
      `?overview=full&geometries=geojson&alternatives=${alternatives}` +
      '&steps=false&annotations=false';
    const effectiveTimeoutMs = Math.max(
      readMinimumAttemptTimeoutMs(targetIndex),
      Math.min(timeoutMs, remainingBudgetMs),
    );

    logProviderEvent(logger, 'info', 'provider_selected', {
      providerId: ROUTING_PROVIDER_ID,
      providerTargetId: providerTarget.targetId,
      providerSource: providerTarget.source,
      providerRegionKey: providerTarget.regionKey,
      providerBaseUrl: providerTarget.baseUrl,
      transportMode: mode,
      timeoutMs: effectiveTimeoutMs,
      retries,
      remainingBudgetMs,
      circuitState: currentCircuitState,
    });

    incrementActiveRequestCount(providerTarget.targetId);
    let response;
    try {
      response = await fetchJson(url, {
        cacheKey,
        cacheTtlMs: Math.max(
          30_000,
          Number(routingConfig.cacheTtlMs || DEFAULT_CACHE_TTL_MS),
        ),
        providerId: `maps-route:${mode}`,
        retries,
        retryDelayMs,
        timeoutMs: effectiveTimeoutMs,
        rateLimitKey: `maps-route:${mode}:${providerTarget.targetId}`,
        maxPerMinute: Math.max(30, Number(routingConfig.maxPerMinute || 120)),
        headers: {
          'User-Agent': userAgent,
        },
      });
    } finally {
      decrementActiveRequestCount(providerTarget.targetId);
    }

    if (!response.ok) {
      const failure = classifyFailure(response);
      const nextCircuitState = registerFailure(
        providerState,
        failure,
        config,
        now(),
      );
      logProviderEvent(logger, 'warn', 'provider_failure', {
        providerId: ROUTING_PROVIDER_ID,
        providerTargetId: providerTarget.targetId,
        providerSource: providerTarget.source,
        providerRegionKey: providerTarget.regionKey,
        providerBaseUrl: providerTarget.baseUrl,
        transportMode: mode,
        reasonCode: failure.reasonCode,
        retryable: failure.retryable,
        circuitState: nextCircuitState,
        statusCode: Number(response.status || 0),
        attempts: Number(response.attempts || 0),
        latencyMs: Number(response.durationMs || 0),
      });

      lastFailurePayload = buildProviderFailurePayload({
        mode,
        providerTarget,
        circuitState: nextCircuitState,
        attempts: Number(response.attempts || 0),
        latencyMs: Number(response.durationMs || 0),
        timeoutMs: effectiveTimeoutMs,
        status: response.status || 0,
        error: response.error || failure.reasonCode,
        reasonCode: failure.reasonCode,
        retryable: failure.retryable,
        degraded: true,
        updatedAt: response.fetchedAt || new Date().toISOString(),
        lastFailureAt: providerState.lastFailureAt,
      });
      clearPreferredProviderTarget(mode, regionHint, providerTarget);

      if (canTryAnotherProviderTarget(providerTargets, targetIndex, remainingBudgetMs)) {
        logProviderEvent(logger, 'warn', 'provider_fallback_next', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          nextProviderTargetId: providerTargets[targetIndex + 1]?.targetId || null,
          reasonCode: failure.reasonCode,
          transportMode: mode,
        });
        continue;
      }

      if (
        staleSnapshot &&
        [
          'routing_provider_timeout',
          'routing_provider_unavailable',
          'routing_provider_rate_limited',
          'routing_provider_circuit_open',
          'routing_provider_budget_exhausted',
        ].includes(failure.reasonCode)
      ) {
        logProviderEvent(logger, 'warn', 'stale_snapshot_used', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          transportMode: mode,
          reasonCode: failure.reasonCode,
          circuitState: nextCircuitState,
        });
        return buildStaleSnapshotResponse({
          staleSnapshot,
          mode,
          providerTarget,
          circuitState: nextCircuitState,
          attempts: Number(response.attempts || 0),
          latencyMs: Number(response.durationMs || 0),
          timeoutMs: effectiveTimeoutMs,
        });
      }

      return lastFailurePayload;
    }

    const rawRoutes = Array.isArray(response.json?.routes) ? response.json.routes : [];
    const routes = rawRoutes
      .map((route, index) => toBackendRoute(route, index, mode))
      .filter(Boolean);

    if (routes.length === 0) {
      const reasonCode =
        rawRoutes.length > 0 ? 'routing_invalid_payload' : 'routing_no_route';
      const nextCircuitState =
        reasonCode === 'routing_invalid_payload'
          ? registerFailure(
              providerState,
              {
                reasonCode,
                retryable: false,
                transient: true,
              },
              config,
              now(),
            )
          : readCircuitState(providerState, now());

      if (reasonCode === 'routing_invalid_payload') {
        logProviderEvent(logger, 'warn', 'invalid_payload', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          providerBaseUrl: providerTarget.baseUrl,
          transportMode: mode,
          circuitState: nextCircuitState,
          attempts: Number(response.attempts || 0),
        });
      }

      lastFailurePayload = buildProviderFailurePayload({
        mode,
        providerTarget,
        circuitState: nextCircuitState,
        attempts: Number(response.attempts || 0),
        latencyMs: Number(response.durationMs || 0),
        timeoutMs: effectiveTimeoutMs,
        status: reasonCode === 'routing_no_route' ? 404 : 502,
        error: reasonCode,
        reasonCode,
        retryable: reasonCode !== 'routing_invalid_payload',
        degraded: reasonCode !== 'routing_no_route',
        updatedAt: response.fetchedAt || new Date().toISOString(),
        lastFailureAt: providerState.lastFailureAt,
      });
      clearPreferredProviderTarget(mode, regionHint, providerTarget);

      if (
        reasonCode === 'routing_no_route' &&
        canTryAnotherProviderTarget(providerTargets, targetIndex, remainingBudgetMs)
      ) {
        logProviderEvent(logger, 'warn', 'provider_fallback_next', {
          providerId: ROUTING_PROVIDER_ID,
          providerTargetId: providerTarget.targetId,
          providerSource: providerTarget.source,
          providerRegionKey: providerTarget.regionKey,
          nextProviderTargetId: providerTargets[targetIndex + 1]?.targetId || null,
          reasonCode,
          transportMode: mode,
        });
        continue;
      }

      return lastFailurePayload;
    }

    registerSuccess(providerState);
    rememberPreferredProviderTarget(mode, regionHint, providerTarget);
    const completedCircuitState = readCircuitState(providerState, now());
    writeStaleRouteSnapshot(
      cacheKey,
      {
        routes,
        updatedAt: response.fetchedAt || new Date().toISOString(),
        transportMode: mode,
      },
      config,
    );

    return {
      ok: true,
      status: 200,
      error: null,
      reasonCode: null,
      retryable: false,
      degraded:
        completedCircuitState === 'half_open' || Number(response.attempts || 0) > 1,
      routes,
      updatedAt: response.fetchedAt || new Date().toISOString(),
      providerId: ROUTING_PROVIDER_ID,
      providerTargetId: providerTarget.targetId,
      providerSource: providerTarget.source,
      providerRegionKey: providerTarget.regionKey,
      transportMode: mode,
      meta: buildMeta({
        providerTargetId: providerTarget.targetId,
        providerSource: providerTarget.source,
        providerRegionKey: providerTarget.regionKey,
        circuitState: completedCircuitState,
        attempts: Number(response.attempts || 0),
        cacheHit: Boolean(response.cached),
        latencyMs: Number(response.durationMs || 0),
        timeoutMs: effectiveTimeoutMs,
        lastFailureAt: providerState.lastFailureAt,
      }),
    };
  }

  return (
    lastFailurePayload ||
    buildProviderFailurePayload({
      mode,
      providerTarget: providerTargets[0],
      circuitState: 'closed',
      timeoutMs,
      status: 503,
      error: 'routing_provider_unavailable',
      reasonCode: 'routing_provider_unavailable',
      retryable: true,
      degraded: true,
    })
  );
};

module.exports = {
  fetchRouteOptions,
  buildRoutingProviderDebugSnapshot,
  __dangerousResetRoutingProviderStateForTests: () => {
    PROVIDER_CIRCUIT_STATES.clear();
    PROVIDER_ACTIVE_REQUESTS.clear();
    PROVIDER_TARGET_PREFERENCES.clear();
  },
  __dangerousResetStaleRouteCacheForTests: () => {
    STALE_ROUTE_CACHE.clear();
  },
  __dangerousGetRoutingProviderStateForTests: () => ({
    providers: Array.from(PROVIDER_CIRCUIT_STATES.entries()).map(([healthKey, state]) => ({
      healthKey,
      ...state,
      circuitState: readCircuitState(state, Date.now()),
    })),
    activeRequests: Object.fromEntries(PROVIDER_ACTIVE_REQUESTS.entries()),
    preferences: Object.fromEntries(PROVIDER_TARGET_PREFERENCES.entries()),
  }),
};
