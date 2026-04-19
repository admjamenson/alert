const {
  getMetaCountries,
  getEpidemicFeed,
} = require('../services/EpidemicFeedService');
const { resolveRequestIdentity } = require('../http/identity');
const {
  buildEntitlementSnapshot,
} = require('../services/EntitlementSnapshotService');
const {
  resolveLocationByCoordinates,
} = require('../services/LocationResolverService');
const { getWeatherFeed } = require('../services/WeatherFeedService');
const { getRiskFeed } = require('../services/RiskFeedService');
const { sendJsonError } = require('../http/errorContract');

const parseFiniteQueryNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampByLimits = (requested, fallback, maxValue) => {
  const parsed = Number(requested);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Number(maxValue || fallback), Math.round(parsed)));
};

const registerFeedRoutes = (app, deps = {}) => {
  const { db, config, logger = console } = deps;

  const resolveEntitlements = async req => {
    const identity = resolveRequestIdentity(req);
    return buildEntitlementSnapshot(
      {
        userId: identity.userId,
        deviceId: identity.deviceId,
        platform: req.query?.platform,
      },
      { db, config },
    );
  };

  const handleMetaCountries = (_req, res) => {
    try {
      const payload = getMetaCountries();
      return res.json(payload);
    } catch (error) {
      logger.error('[meta/countries]', error);
      return sendJsonError(res, 500, {
        code: 'meta_countries_internal',
        retryable: true,
      });
    }
  };

  const handleEpidemicFeed = async (req, res) => {
    try {
      const entitlementSnapshot = await resolveEntitlements(req);
      const { country, admin1, city, disease, metric, window, normalize } =
        req.query || {};
      let resolvedCountry = country ? String(country) : '';
      let resolvedAdmin1 = admin1 ? String(admin1) : '';
      let resolvedCity = city ? String(city) : '';

      if (!resolvedCountry) {
        const resolvedLocation = await resolveLocationByCoordinates(
          {
            latitude: parseFiniteQueryNumber(req.query?.lat),
            longitude: parseFiniteQueryNumber(req.query?.lon),
            locale: req.query?.locale,
          },
          { config },
        );
        resolvedCountry = String(resolvedLocation?.country || '');
        resolvedAdmin1 = resolvedAdmin1 || String(resolvedLocation?.admin1 || '');
        resolvedCity = resolvedCity || String(resolvedLocation?.city || '');
      }

      if (!resolvedCountry || !/^[A-Z]{2}$/.test(resolvedCountry)) {
        return sendJsonError(res, 400, {
          code: 'invalid_country',
          message: 'country must be ISO 3166-1 alpha-2',
          failClosed: true,
          retryable: false,
        });
      }
      const payload = await getEpidemicFeed(
        {
          country: resolvedCountry,
          admin1: resolvedAdmin1,
          city: resolvedCity,
          disease: disease ? String(disease) : 'covid19',
          metric: metric ? String(metric) : 'cases',
          window:
            entitlementSnapshot?.limits?.epidemic?.maxWindow === '7d'
              ? '7d'
              : window
                ? String(window)
                : '7d',
          normalize: normalize ? String(normalize) : 'count',
        },
        { config },
      );
      return res.json(payload);
    } catch (error) {
      logger.error('[epidemic/feed]', error);
      return sendJsonError(res, 500, {
        code: 'epidemic_feed_internal',
        retryable: true,
      });
    }
  };

  app.get('/v1/meta/countries', handleMetaCountries);
  app.get('/api/v1/meta/countries', handleMetaCountries);

  app.get('/v1/epidemic/feed', handleEpidemicFeed);
  app.get('/api/v1/epidemic/feed', handleEpidemicFeed);

  app.get('/api/v1/weather/feed', async (req, res) => {
    try {
      const latitude = parseFiniteQueryNumber(req.query?.lat);
      const longitude = parseFiniteQueryNumber(req.query?.lon);
      const payload = await getWeatherFeed(
        {
          latitude,
          longitude,
          locale: req.query?.locale,
        },
        { config },
      );
      return res.json(payload);
    } catch (error) {
      logger.error('[weather/feed]', error);
      return sendJsonError(res, 500, {
        code: 'weather_feed_internal',
        retryable: true,
      });
    }
  });

  app.get('/api/v1/risk/feed', async (req, res) => {
    try {
      const entitlementSnapshot = await resolveEntitlements(req);
      const latitude = parseFiniteQueryNumber(req.query?.lat);
      const longitude = parseFiniteQueryNumber(req.query?.lon);
      const payload = await getRiskFeed(
        {
          latitude,
          longitude,
          radiusKm: clampByLimits(
            req.query?.radiusKm,
            35,
            entitlementSnapshot?.limits?.monitoring?.maxRadiusKm || 35,
          ),
          limit: clampByLimits(
            req.query?.limit,
            120,
            entitlementSnapshot?.limits?.monitoring?.maxItems || 120,
          ),
          riskScore: req.query?.riskScore,
          sosPublicOptIn:
            req.query?.sosPublicOptIn === '1' ||
            String(req.query?.sosPublicOptIn || '').toLowerCase() === 'true',
        },
        { db },
      );
      return res.json(payload);
    } catch (error) {
      logger.error('[risk/feed]', error);
      return sendJsonError(res, 500, {
        code: 'risk_feed_internal',
        retryable: true,
        meta: {
          hubAvailable: false,
        },
        data: {
          alerts: [],
          providers: [],
        },
      });
    }
  });
};

module.exports = registerFeedRoutes;
