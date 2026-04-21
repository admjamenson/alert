const { fetchRouteOptions } = require('../eventHub/adapters/routingOsrmAdapter');
const { haversineKm, nowIso } = require('../eventHub/utils');

const SOURCE_NAME = 'Alert Routing';
const ROUTE_MODE_PROVIDER = 'provider';
const ROUTE_MODE_ESTIMATED = 'estimated_straight_line';
const ROUTE_MODE_UNAVAILABLE = 'unavailable';
const PRECISION_HIGH = 'high';
const PRECISION_LOW = 'low';
const PRECISION_NONE = 'none';

const MODE_TO_SPEED_KMH = {
  car: 34,
  bus: 22,
  motorcycle: 30,
  bike: 17,
  walk: 5,
};

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

const isFiniteCoordinate = value => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return Number.isFinite(Number(value));
};

const hasValidCoordinates = params =>
  isFiniteCoordinate(params?.fromLat) &&
  isFiniteCoordinate(params?.fromLon) &&
  isFiniteCoordinate(params?.toLat) &&
  isFiniteCoordinate(params?.toLon);

const estimateDurationSec = (distanceKm, mode) => {
  const speedKmH = MODE_TO_SPEED_KMH[normalizeMode(mode)] || MODE_TO_SPEED_KMH.car;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(speedKmH) || speedKmH <= 0) {
    return 60;
  }
  return Math.max(60, Math.round((distanceKm / speedKmH) * 3600));
};

const buildFallbackRoute = params => {
  const from = {
    latitude: Number(params.fromLat),
    longitude: Number(params.fromLon),
  };
  const to = {
    latitude: Number(params.toLat),
    longitude: Number(params.toLon),
  };

  const distanceKm = haversineKm(from, to);
  return {
    id: `fallback-${normalizeMode(params.transportMode)}-direct`,
    title: 'Estimated direction',
    distanceMeters: Number.isFinite(distanceKm)
      ? Math.round(distanceKm * 1000)
      : 0,
    durationSec: estimateDurationSec(distanceKm, params.transportMode),
    geometry: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ],
    trafficLevel: 'unknown',
  };
};

const buildProviderSnapshot = payload => ({
  id: String(payload?.providerId || 'osrm'),
  available: Boolean(payload?.ok),
  degraded: Boolean(!payload?.ok || payload?.degraded),
  stale: Boolean(payload?.stale),
  reasonCode: payload?.reasonCode || payload?.error || null,
  retryable: Boolean(payload?.retryable),
  circuitState: String(payload?.meta?.circuitState || 'closed'),
  attempts: Number(payload?.meta?.attempts || 0),
  cacheHit: Boolean(payload?.meta?.cacheHit),
  latencyMs: Number(payload?.meta?.latencyMs || 0),
  timeoutMs: Number(payload?.meta?.timeoutMs || 0),
  nonCriticalDependency: true,
});

const buildAdvisory = (code, severity = 'warning') =>
  code
    ? {
        code,
        severity,
      }
    : null;

const buildUnavailablePayload = (params, overrides = {}) => ({
  available: false,
  degraded: Boolean(overrides.degraded),
  reasonCode: overrides.reasonCode || 'invalid_coordinates',
  retryable: Boolean(overrides.retryable),
  fallbackUsed: false,
  routeMode: ROUTE_MODE_UNAVAILABLE,
  precision: PRECISION_NONE,
  providerAvailable: Boolean(overrides.providerAvailable),
  advisory:
    overrides.advisory ||
    buildAdvisory('route_advisory_unavailable'),
  routes: [],
  source: SOURCE_NAME,
  updatedAt: overrides.updatedAt || nowIso(),
  provider:
    overrides.provider ||
    {
      id: 'osrm',
      available: false,
      degraded: Boolean(overrides.degraded),
      reasonCode: overrides.reasonCode || 'invalid_coordinates',
      retryable: Boolean(overrides.retryable),
      circuitState: 'closed',
      attempts: 0,
      cacheHit: false,
      latencyMs: 0,
      timeoutMs: 0,
      nonCriticalDependency: true,
    },
  transportMode: normalizeMode(params?.transportMode),
});

const buildSuccessPayload = providerPayload => ({
  available: true,
  degraded: Boolean(providerPayload?.degraded),
  reasonCode: providerPayload?.reasonCode || null,
  retryable: Boolean(providerPayload?.retryable),
  fallbackUsed: Boolean(providerPayload?.stale),
  routeMode: ROUTE_MODE_PROVIDER,
  precision: PRECISION_HIGH,
  providerAvailable: !providerPayload?.stale,
  advisory: providerPayload?.stale
    ? buildAdvisory('route_advisory_stale_provider_snapshot')
    : null,
  routes: Array.isArray(providerPayload?.routes) ? providerPayload.routes : [],
  source: SOURCE_NAME,
  updatedAt: providerPayload?.updatedAt || nowIso(),
  provider: buildProviderSnapshot(providerPayload),
  transportMode: normalizeMode(providerPayload?.transportMode),
});

const buildFallbackPayload = (params, providerPayload) => ({
  available: true,
  degraded: true,
  reasonCode:
    providerPayload?.reasonCode ||
    providerPayload?.error ||
    'routing_provider_unavailable',
  retryable: Boolean(providerPayload?.retryable),
  fallbackUsed: true,
  routeMode: ROUTE_MODE_ESTIMATED,
  precision: PRECISION_LOW,
  providerAvailable: false,
  advisory: buildAdvisory('route_advisory_estimated_straight_line'),
  routes: [buildFallbackRoute(params)],
  source: SOURCE_NAME,
  updatedAt: providerPayload?.updatedAt || nowIso(),
  provider: buildProviderSnapshot(providerPayload),
  transportMode: normalizeMode(params?.transportMode),
});

const ESTIMATED_ROUTE_REASON_CODES = new Set([
  'routing_provider_timeout',
  'routing_provider_unavailable',
  'routing_provider_rate_limited',
  'routing_provider_circuit_open',
]);

const logDegradedRouting = (logger, payload) => {
  const target = logger && typeof logger.warn === 'function' ? logger.warn : null;
  if (!target) return;
  target('[routing/service] degraded_route_snapshot', {
    providerId: payload?.provider?.id || 'osrm',
    routeMode: payload?.routeMode || ROUTE_MODE_UNAVAILABLE,
    degraded: Boolean(payload?.degraded),
    reasonCode: payload?.reasonCode || null,
    retryable: Boolean(payload?.retryable),
    fallbackUsed: Boolean(payload?.fallbackUsed),
    circuitState: payload?.provider?.circuitState || 'closed',
    attempts: Number(payload?.provider?.attempts || 0),
    transportMode: normalizeMode(payload?.transportMode),
  });
};

const getRouteOptionsSnapshot = async (params, deps = {}) => {
  const { config, logger = console, routingProvider = fetchRouteOptions } = deps;
  if (!hasValidCoordinates(params)) {
    return buildUnavailablePayload(params);
  }

  try {
    const providerPayload = await routingProvider(params, {
      config,
      userAgent: config?.weather?.userAgent,
      logger,
    });

    if (providerPayload?.ok && Array.isArray(providerPayload.routes) && providerPayload.routes.length > 0) {
      return buildSuccessPayload(providerPayload);
    }

    const providerSnapshot = buildProviderSnapshot(providerPayload || {});
    const reasonCode =
      providerPayload?.reasonCode ||
      providerPayload?.error ||
      'routing_provider_unavailable';

    if (ESTIMATED_ROUTE_REASON_CODES.has(reasonCode)) {
      const payload = buildFallbackPayload(params, providerPayload || {});
      logDegradedRouting(logger, payload);
      return payload;
    }

    const payload = buildUnavailablePayload(params, {
      degraded: Boolean(providerPayload?.degraded),
      reasonCode,
      retryable: Boolean(providerPayload?.retryable),
      providerAvailable: Boolean(providerPayload?.ok),
      updatedAt: providerPayload?.updatedAt || nowIso(),
      provider: providerSnapshot,
      advisory: buildAdvisory(
        reasonCode === 'routing_no_route'
          ? 'route_advisory_no_verified_route'
          : 'route_advisory_unavailable',
      ),
    });
    logDegradedRouting(logger, payload);
    return payload;
  } catch (_error) {
    const payload = buildUnavailablePayload(params, {
      degraded: true,
      reasonCode: 'routing_internal_error',
      retryable: true,
      providerAvailable: false,
      updatedAt: nowIso(),
      provider: {
        id: 'osrm',
        available: false,
        degraded: true,
        reasonCode: 'routing_internal_error',
        retryable: true,
        circuitState: 'closed',
        attempts: 0,
        cacheHit: false,
        latencyMs: 0,
        timeoutMs: Number(config?.routing?.timeoutMs || 0),
        nonCriticalDependency: true,
      },
      advisory: buildAdvisory('route_advisory_unavailable'),
    });
    logDegradedRouting(logger, payload);

    const target = logger && typeof logger.error === 'function' ? logger.error : null;
    if (target) {
      target('[routing/service] unexpected_failure', {
        reasonCode: 'routing_internal_error',
        retryable: true,
        providerId: 'osrm',
      });
    }

    return payload;
  }
};

module.exports = {
  getRouteOptionsSnapshot,
  buildFallbackRoute,
};
