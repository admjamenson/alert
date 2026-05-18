const {
  getMetaCountries,
  getEpidemicFeed,
} = require('../services/EpidemicFeedService');
const {resolveRequestIdentity} = require('../http/identity');
const {recordWeatherUsage} = require('../billing/billingUsageRepository');
const {
  buildEntitlementSnapshot,
} = require('../services/EntitlementSnapshotService');
const {
  resolveLocationByCoordinates,
} = require('../services/LocationResolverService');
const {
  getWeatherFeed,
  buildUnavailableWeatherFeed,
  buildSafeModeWeatherFeed,
} = require('../services/WeatherFeedService');
const {getRiskFeed} = require('../services/RiskFeedService');
const {sendJsonError} = require('../http/errorContract');
const {
  isLoadTestSafeMode,
  buildSafeModeRiskFeedPayload,
} = require('../config/safeMode');
const {
  BACKEND_REQUEST_BASE,
  WEATHER_PROVIDER,
  GEOCODING_PROVIDER,
  FIRESTORE_WRITE,
  sumOperationCosts,
} = require('../economics/CostCatalog');
const {
  withEconomicGate,
  registerEconomicCost,
} = require('../economics/EconomicGate');
const {normalizeTier} = require('../economics/EconomicsPolicy');

const parseFiniteQueryNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampByLimits = (requested, fallback, maxValue) => {
  const parsed = Number(requested);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(
    1,
    Math.min(Number(maxValue || fallback), Math.round(parsed)),
  );
};

const readHeader = (req, name) => {
  if (typeof req?.get === 'function') {
    const value = req.get(name);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const stableName = String(name || '')
    .trim()
    .toLowerCase();
  const headerValue =
    req?.headers?.[stableName] ??
    req?.headers?.[name];
  return typeof headerValue === 'string' && headerValue.trim()
    ? headerValue.trim()
    : '';
};

const resolveRegionKey = req =>
  String(
    readHeader(req, 'x-alert-region') ||
      req.query?.region ||
      req.query?.country ||
      'global',
  )
    .trim()
    .toLowerCase() || 'global';

const resolveTierHint = (req, fallbackTier = 'free') =>
  normalizeTier(
    readHeader(req, 'x-alert-tier') ||
      req.query?.tier ||
      req.query?.plan ||
      fallbackTier,
  );

const buildEconomicsContext = (req, overrides = {}) => {
  const identity = resolveRequestIdentity(req);
  return {
    identity,
    userKey: identity.userId || identity.deviceId,
    tier: normalizeTier(overrides.tier || resolveTierHint(req)),
    regionKey: String(overrides.regionKey || resolveRegionKey(req)),
    criticality: String(overrides.criticality || 'standard'),
  };
};

const attachEconomics = (payload, decision, operation) => ({
  ...payload,
  economics: {
    ...(payload?.economics || {}),
    degraded: Boolean(decision?.degraded),
    reason: String(decision?.reason || 'economics_not_evaluated'),
    operation: String(operation || decision?.operation || 'UNKNOWN'),
    fallbackMode: decision?.fallbackMode || null,
    estimatedCostUsd: Number(decision?.estimatedCostUsd || 0),
  },
});

const registerFeedRoutes = (app, deps = {}) => {
  const {
    db,
    config,
    logger = console,
    getWeatherFeedFn = getWeatherFeed,
    recordWeatherUsageFn = recordWeatherUsage,
  } = deps;

  const resolveEntitlements = async req => {
    const economicsContext = buildEconomicsContext(req, {
      criticality: 'read_critical',
    });
    return buildEntitlementSnapshot(
      {
        userId: economicsContext.identity.userId,
        deviceId: economicsContext.identity.deviceId,
        platform: req.query?.platform,
        regionKey: economicsContext.regionKey,
        tier: economicsContext.tier,
      },
      {db, config},
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
      const {country, admin1, city, disease, metric, window, normalize} =
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
          {config},
        );
        resolvedCountry = String(resolvedLocation?.country || '');
        resolvedAdmin1 =
          resolvedAdmin1 || String(resolvedLocation?.admin1 || '');
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
        {config},
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

  app.get('/api/v1/weather/feed', (req, res, next) => {
    // HARD BYPASS em safe mode — responde imediatamente sem providers externos
    if (isLoadTestSafeMode()) {
      const latitude = parseFiniteQueryNumber(req.query?.lat) ?? 0;
      const longitude = parseFiniteQueryNumber(req.query?.lon) ?? 0;
      const safePayload = buildSafeModeWeatherFeed({
        lat: latitude,
        lon: longitude,
        locale: req.query?.locale,
      });
      return res.status(200).json({
        ...safePayload,
        source: 'safe_mode_hard_bypass',
        economics: {
          degraded: false,
          reason: 'safe_mode_hard_bypass',
          operation: 'WEATHER_PROVIDER',
          fallbackMode: null,
          estimatedCostUsd: 0,
        },
      });
    }
    return next();
  });

  app.get('/api/v1/weather/feed', async (req, res) => {
    try {
      const latitude = parseFiniteQueryNumber(req.query?.lat);
      const longitude = parseFiniteQueryNumber(req.query?.lon);
      const economicsContext = buildEconomicsContext(req);
      const estimatedWeatherCostUsd = sumOperationCosts([
        BACKEND_REQUEST_BASE,
        WEATHER_PROVIDER,
        GEOCODING_PROVIDER,
      ]);
      const payload = await withEconomicGate(
        {
          userKey: economicsContext.userKey,
          tier: economicsContext.tier,
          operation: WEATHER_PROVIDER,
          estimatedCostUsd: estimatedWeatherCostUsd,
          actualCostUsd: estimatedWeatherCostUsd,
          fallbackCostUsd: sumOperationCosts([BACKEND_REQUEST_BASE]),
          regionKey: economicsContext.regionKey,
          criticality: 'standard',
        },
        async decision => {
          const responsePayload = await getWeatherFeedFn(
            {
              latitude,
              longitude,
              locale: req.query?.locale,
            },
            {config},
          );
          if (responsePayload?.available) {
            await recordWeatherUsageFn({
              db,
              identity: economicsContext.identity,
            }).catch(error => {
              logger.warn('[weather/feed] usage_tracking_failed', {
                error: error?.message || 'unknown',
              });
            });
            await registerEconomicCost({
              userKey: economicsContext.userKey,
              tier: economicsContext.tier,
              operation: FIRESTORE_WRITE,
              actualCostUsd: sumOperationCosts([FIRESTORE_WRITE]),
              regionKey: economicsContext.regionKey,
              criticality: 'standard',
            });
          }
          return attachEconomics(responsePayload, decision, WEATHER_PROVIDER);
        },
        async decision =>
          attachEconomics(
            buildUnavailableWeatherFeed(latitude, longitude),
            decision,
            WEATHER_PROVIDER,
          ),
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
    // HARD BYPASS em safe mode - responde imediatamente sem await
    if (isLoadTestSafeMode()) {
      return res.status(200).json(buildSafeModeRiskFeedPayload(req));
    }

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
        {
          db,
          economicsContext: {
            userKey: resolveRequestIdentity(req).userId,
            tier: entitlementSnapshot?.plan || 'free',
            regionKey: resolveRegionKey(req),
            criticality: 'standard',
          },
        },
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
