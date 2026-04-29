const {
  searchPlaces,
  reverseGeocode,
} = require('../eventHub/adapters/geocodingAdapter');
const {
  buildRoutingProviderDebugSnapshot,
} = require('../eventHub/adapters/routingOsrmAdapter');
const { buildRouteRuntimeDiagnostics } = require('../config/runtime');
const { getRouteOptionsSnapshot } = require('../services/RouteOptionsService');

const parseFiniteQueryNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const DEBUG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const isRouteOpsDebugEnabled = req => {
  const headerValue = String(req.get('x-alert-ops-route-debug') || '')
    .trim()
    .toLowerCase();
  if (DEBUG_TRUE_VALUES.has(headerValue)) {
    return true;
  }

  const queryValue = String(req.query?.opsDebug || '')
    .trim()
    .toLowerCase();
  return DEBUG_TRUE_VALUES.has(queryValue);
};

const buildRouteOpsDebugPayload = ({
  config,
  params,
  payload,
}) => {
  const runtimeDiagnostics = buildRouteRuntimeDiagnostics(config);
  const targetResolution = buildRoutingProviderDebugSnapshot(params, { config });
  return {
    instanceId: runtimeDiagnostics.instanceId,
    deployId: runtimeDiagnostics.deployId,
    configFingerprint: runtimeDiagnostics.configFingerprint,
    routingConfig: runtimeDiagnostics.routing,
    targetResolution,
    finalProvider: {
      targetId: payload?.provider?.targetId || 'osrm:primary',
      source: payload?.provider?.source || 'primary',
      regionKey: payload?.provider?.regionKey || null,
      degraded: Boolean(payload?.degraded),
      fallbackUsed: Boolean(payload?.fallbackUsed),
      reasonCode: payload?.provider?.reasonCode || payload?.reasonCode || null,
      circuitState: payload?.provider?.circuitState || 'closed',
      attempts: Number(payload?.provider?.attempts || 0),
      latencyMs: Number(payload?.provider?.latencyMs || 0),
      timeoutMs: Number(payload?.provider?.timeoutMs || 0),
      cacheHit: Boolean(payload?.provider?.cacheHit),
      stale: Boolean(payload?.provider?.stale),
    },
  };
};

const writeRouteOpsDebugHeaders = (res, opsDebug) => {
  res.set('x-alert-route-instance', String(opsDebug?.instanceId || 'unknown'));
  res.set('x-alert-route-deploy', String(opsDebug?.deployId || 'unknown'));
  res.set(
    'x-alert-route-config',
    String(opsDebug?.configFingerprint || 'unknown'),
  );
  res.set(
    'x-alert-route-target',
    String(opsDebug?.finalProvider?.targetId || 'osrm:primary'),
  );
  res.set(
    'x-alert-route-source',
    String(opsDebug?.finalProvider?.source || 'primary'),
  );
  res.set(
    'x-alert-route-region',
    String(opsDebug?.targetResolution?.normalizedRegionHint || 'unknown'),
  );
  res.set(
    'x-alert-route-reason',
    String(opsDebug?.finalProvider?.reasonCode || 'none'),
  );
};

const attachRouteOpsDebugPayload = (req, res, payload, config, params) => {
  if (!isRouteOpsDebugEnabled(req)) {
    return payload;
  }

  const opsDebug = buildRouteOpsDebugPayload({
    config,
    params,
    payload,
  });
  writeRouteOpsDebugHeaders(res, opsDebug);
  return {
    ...payload,
    opsDebug,
  };
};

const normalizeSearchResults = results =>
  (Array.isArray(results) ? results : []).map(item => ({
    id: String(item?.id || ''),
    name: String(item?.name || '').trim(),
    address: String(item?.address || '').trim(),
    latitude: Number(item?.latitude),
    longitude: Number(item?.longitude),
    countryCode: item?.countryCode ? String(item.countryCode) : null,
    providerId: 'alert_backend',
    sourceName: 'Alert Maps',
    connectionStatus: 'online',
  }));

const registerMapsRoutes = (app, deps = {}) => {
  const {
    config,
    logger = console,
    searchPlacesFn = searchPlaces,
    reverseGeocodeFn = reverseGeocode,
    routeOptionsSnapshot = getRouteOptionsSnapshot,
  } = deps;

  const handleSearch = async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim();
      if (!query) {
        return res.json({ results: [] });
      }

      const results = await searchPlacesFn(
        {
          query,
          locale: req.query?.locale,
          countryCode: req.query?.country,
        },
        {
          userAgent: config?.weather?.userAgent,
        },
      );

      return res.json({
        results: normalizeSearchResults(results),
      });
    } catch (error) {
      logger.error('[maps/geocode/search]', error);
      return res.status(500).json({
        error: 'maps_geocode_search_internal',
        results: [],
      });
    }
  };

  const handleReverse = async (req, res) => {
    try {
      const latitude = parseFiniteQueryNumber(req.query?.lat);
      const longitude = parseFiniteQueryNumber(req.query?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ error: 'invalid_coordinates' });
      }

      const payload = await reverseGeocodeFn(
        {
          latitude,
          longitude,
          locale: req.query?.locale,
        },
        {
          userAgent: config?.weather?.userAgent,
        },
      );

      return res.json({
        place: payload?.place
          ? {
              ...payload.place,
              providerId: 'alert_backend',
              sourceName: 'Alert Maps',
              connectionStatus: 'online',
            }
          : null,
        adminContext: payload?.adminContext || null,
      });
    } catch (error) {
      logger.error('[maps/geocode/reverse]', error);
      return res.status(500).json({
        error: 'maps_geocode_reverse_internal',
        place: null,
        adminContext: null,
      });
    }
  };

  const handleRoutes = async (req, res) => {
    try {
      const fromLat = parseFiniteQueryNumber(req.query?.fromLat);
      const fromLon = parseFiniteQueryNumber(req.query?.fromLon);
      const toLat = parseFiniteQueryNumber(req.query?.toLat);
      const toLon = parseFiniteQueryNumber(req.query?.toLon);

      if (
        !Number.isFinite(fromLat) ||
        !Number.isFinite(fromLon) ||
        !Number.isFinite(toLat) ||
        !Number.isFinite(toLon)
      ) {
        return res.status(400).json({
          error: 'invalid_coordinates',
          routes: [],
        });
      }

      const payload = await routeOptionsSnapshot(
        {
          fromLat,
          fromLon,
          toLat,
          toLon,
          transportMode: req.query?.mode || req.query?.transportMode,
          regionHint:
            req.get('x-alert-region') ||
            req.query?.region ||
            req.query?.regionHint,
        },
        {
          config,
          logger,
        },
      );
      const routeParams = {
        fromLat,
        fromLon,
        toLat,
        toLon,
        transportMode: req.query?.mode || req.query?.transportMode,
        regionHint:
          req.get('x-alert-region') ||
          req.query?.region ||
          req.query?.regionHint,
      };

      if (!payload.available && payload.reasonCode === 'invalid_coordinates') {
        return res
          .status(400)
          .json(
            attachRouteOpsDebugPayload(
              req,
              res,
              payload,
              config,
              routeParams,
            ),
          );
      }

      return res.json(
        attachRouteOpsDebugPayload(req, res, payload, config, routeParams),
      );
    } catch (error) {
      logger.error('[maps/routes]', {
        error: 'maps_routes_internal',
      });
      const routeParams = {
        fromLat: req.query?.fromLat,
        fromLon: req.query?.fromLon,
        toLat: req.query?.toLat,
        toLon: req.query?.toLon,
        transportMode: req.query?.mode || req.query?.transportMode,
        regionHint:
          req.get('x-alert-region') ||
          req.query?.region ||
          req.query?.regionHint,
      };
      const failurePayload = {
        available: false,
        degraded: true,
        reasonCode: 'maps_routes_internal',
        retryable: true,
        fallbackUsed: false,
        routeMode: 'unavailable',
        precision: 'none',
        providerAvailable: false,
        advisory: {
          code: 'route_advisory_unavailable',
          severity: 'warning',
        },
        routes: [],
        source: 'Alert Routing',
        updatedAt: new Date().toISOString(),
        provider: {
          id: 'osrm',
          available: false,
          degraded: true,
          reasonCode: 'maps_routes_internal',
          retryable: true,
          circuitState: 'closed',
          attempts: 0,
          cacheHit: false,
          latencyMs: 0,
          timeoutMs: Number(config?.routing?.timeoutMs || 0),
          nonCriticalDependency: true,
        },
      };
      return res
        .status(200)
        .json(
          attachRouteOpsDebugPayload(
            req,
            res,
            failurePayload,
            config,
            routeParams,
          ),
        );
    }
  };

  app.get('/v1/maps/geocode/autocomplete', handleSearch);
  app.get('/api/v1/maps/geocode/autocomplete', handleSearch);
  app.get('/api/v1/maps/geocode/search', handleSearch);
  app.get('/api/v1/maps/geocode/reverse', handleReverse);
  app.get('/v1/maps/routes', handleRoutes);
  app.get('/api/v1/maps/routes', handleRoutes);
};

module.exports = registerMapsRoutes;
