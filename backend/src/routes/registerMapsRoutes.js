const {
  searchPlaces,
  reverseGeocode,
} = require('../eventHub/adapters/geocodingAdapter');
const { getRouteOptionsSnapshot } = require('../services/RouteOptionsService');

const parseFiniteQueryNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const { config, logger = console } = deps;

  const handleSearch = async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim();
      if (!query) {
        return res.json({ results: [] });
      }

      const results = await searchPlaces(
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

      const payload = await reverseGeocode(
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

      const payload = await getRouteOptionsSnapshot(
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

      if (!payload.available && payload.reasonCode === 'invalid_coordinates') {
        return res.status(400).json(payload);
      }

      return res.json(payload);
    } catch (error) {
      logger.error('[maps/routes]', {
        error: 'maps_routes_internal',
      });
      return res.status(200).json({
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
      });
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
