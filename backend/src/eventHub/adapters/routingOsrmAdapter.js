const { fetchJsonWithRetry } = require('../fetcher');

const ROUTING_PROVIDER_ID = 'osrm';
const DEFAULT_ROUTE_BASE_URL = 'https://router.project-osrm.org/route/v1';
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 45_000;

const MODE_TO_PROFILE = {
  car: 'driving',
  bus: 'driving',
  motorcycle: 'driving',
  bike: 'cycling',
  walk: 'walking',
};

const providerState = {
  consecutiveFailures: 0,
  openUntil: 0,
  lastReasonCode: null,
  lastFailureAt: null,
};

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const normalizeMode = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'bus') return 'bus';
  if (normalized === 'motorcycle') return 'motorcycle';
  if (normalized === 'bike') return 'bike';
  if (normalized === 'walk') return 'walk';
  return 'car';
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

const readCircuitState = nowMs => {
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

const resetCircuit = () => {
  providerState.consecutiveFailures = 0;
  providerState.openUntil = 0;
  providerState.lastReasonCode = null;
  providerState.lastFailureAt = null;
};

const buildMeta = params => ({
  circuitState: params?.circuitState || 'closed',
  attempts: Number.isFinite(params?.attempts) ? params.attempts : 0,
  cacheHit: Boolean(params?.cacheHit),
  latencyMs: Number.isFinite(params?.latencyMs) ? params.latencyMs : 0,
  timeoutMs: Number.isFinite(params?.timeoutMs) ? params.timeoutMs : 0,
  lastFailureAt: providerState.lastFailureAt,
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

const registerFailure = (failure, config, nowMs) => {
  if (!failure?.transient) return readCircuitState(nowMs);

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

  return readCircuitState(nowMs);
};

const registerSuccess = () => {
  resetCircuit();
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

const fetchRouteOptions = async (
  { fromLat, fromLon, toLat, toLon, transportMode },
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
      transportMode: normalizeMode(transportMode),
      meta: buildMeta({
        circuitState: readCircuitState(startedAt),
      }),
    };
  }

  const mode = normalizeMode(transportMode);
  const routingConfig = config?.routing || {};
  const timeoutMs = Math.max(900, Number(routingConfig.timeoutMs || 2600));
  const circuitState = readCircuitState(startedAt);

  if (circuitState === 'open') {
    logProviderEvent(logger, 'warn', 'short_circuit', {
      providerId: ROUTING_PROVIDER_ID,
      reasonCode: providerState.lastReasonCode || 'routing_provider_circuit_open',
      transportMode: mode,
      circuitState,
      retryable: true,
    });

    return {
      ok: false,
      status: 503,
      error: 'routing_provider_circuit_open',
      reasonCode: 'routing_provider_circuit_open',
      retryable: true,
      degraded: true,
      routes: [],
      updatedAt: new Date(startedAt).toISOString(),
      providerId: ROUTING_PROVIDER_ID,
      transportMode: mode,
      meta: buildMeta({
        circuitState,
        timeoutMs,
      }),
    };
  }

  const profile = MODE_TO_PROFILE[mode] || MODE_TO_PROFILE.car;
  const alternatives = profile === 'driving' ? 'true' : 'false';
  const routeBaseUrl = String(
    routingConfig.providerBaseUrl || DEFAULT_ROUTE_BASE_URL,
  ).replace(/\/+$/, '');
  const url =
    `${routeBaseUrl}/${profile}/` +
    `${destinationSafe(originLon)},${destinationSafe(originLat)};` +
    `${destinationSafe(destinationLon)},${destinationSafe(destinationLat)}` +
    `?overview=full&geometries=geojson&alternatives=${alternatives}` +
    '&steps=false&annotations=false';

  const response = await fetchJson(url, {
    cacheKey:
      `maps-route:${mode}:` +
      `${originLat.toFixed(4)}:${originLon.toFixed(4)}:` +
      `${destinationLat.toFixed(4)}:${destinationLon.toFixed(4)}`,
    cacheTtlMs: Math.max(
      30_000,
      Number(routingConfig.cacheTtlMs || 2 * 60 * 1000),
    ),
    retries: Math.max(0, Number(routingConfig.retries || 1)),
    retryDelayMs: Math.max(80, Number(routingConfig.retryDelayMs || 180)),
    timeoutMs,
    rateLimitKey: `maps-route:${mode}`,
    maxPerMinute: Math.max(30, Number(routingConfig.maxPerMinute || 120)),
    headers: {
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    const failure = classifyFailure(response);
    const nextCircuitState = registerFailure(failure, config, now());
    logProviderEvent(logger, 'warn', 'provider_failure', {
      providerId: ROUTING_PROVIDER_ID,
      transportMode: mode,
      reasonCode: failure.reasonCode,
      retryable: failure.retryable,
      circuitState: nextCircuitState,
      statusCode: Number(response.status || 0),
      attempts: Number(response.attempts || 0),
      latencyMs: Number(response.durationMs || 0),
    });

    return {
      ok: false,
      status: response.status || 0,
      error: response.error || failure.reasonCode,
      reasonCode: failure.reasonCode,
      retryable: failure.retryable,
      degraded: true,
      routes: [],
      updatedAt: response.fetchedAt || new Date().toISOString(),
      providerId: ROUTING_PROVIDER_ID,
      transportMode: mode,
      meta: buildMeta({
        circuitState: nextCircuitState,
        attempts: Number(response.attempts || 0),
        cacheHit: Boolean(response.cached),
        latencyMs: Number(response.durationMs || 0),
        timeoutMs,
      }),
    };
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
            {
              reasonCode,
              retryable: false,
              transient: true,
            },
            config,
            now(),
          )
        : readCircuitState(now());

    if (reasonCode === 'routing_invalid_payload') {
      logProviderEvent(logger, 'warn', 'invalid_payload', {
        providerId: ROUTING_PROVIDER_ID,
        transportMode: mode,
        circuitState: nextCircuitState,
        attempts: Number(response.attempts || 0),
      });
    }

    return {
      ok: false,
      status: reasonCode === 'routing_no_route' ? 404 : 502,
      error: reasonCode,
      reasonCode,
      retryable: reasonCode !== 'routing_invalid_payload',
      degraded: reasonCode !== 'routing_no_route',
      routes: [],
      updatedAt: response.fetchedAt || new Date().toISOString(),
      providerId: ROUTING_PROVIDER_ID,
      transportMode: mode,
      meta: buildMeta({
        circuitState: nextCircuitState,
        attempts: Number(response.attempts || 0),
        cacheHit: Boolean(response.cached),
        latencyMs: Number(response.durationMs || 0),
        timeoutMs,
      }),
    };
  }

  registerSuccess();
  const completedCircuitState = readCircuitState(now());

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
    transportMode: mode,
    meta: buildMeta({
      circuitState: completedCircuitState,
      attempts: Number(response.attempts || 0),
      cacheHit: Boolean(response.cached),
      latencyMs: Number(response.durationMs || 0),
      timeoutMs,
    }),
  };
};

module.exports = {
  fetchRouteOptions,
  __dangerousResetRoutingProviderStateForTests: resetCircuit,
  __dangerousGetRoutingProviderStateForTests: () => ({
    ...providerState,
    circuitState: readCircuitState(Date.now()),
  }),
};
