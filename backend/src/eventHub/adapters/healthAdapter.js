const { getEpidemicFeed } = require('../../services/EpidemicFeedService');
const { PANDEMIC_WATCHLIST } = require('../providerRegistry');
const { createUnifiedEvent, nowIso, toIso } = require('../utils');

const inferCountryFromBbox = bbox => {
  if (!bbox) return null;
  const centerLon = (bbox.minLon + bbox.maxLon) / 2;
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;

  // Brazil
  if (centerLat >= -34 && centerLat <= 6 && centerLon >= -74 && centerLon <= -32) {
    return 'BR';
  }
  // United States (continental + Alaska/Hawaii broad envelope)
  if (centerLat >= 18 && centerLat <= 72 && centerLon >= -171 && centerLon <= -66) {
    return 'US';
  }
  // UK
  if (centerLat >= 49 && centerLat <= 61 && centerLon >= -11 && centerLon <= 2) {
    return 'GB';
  }

  return null;
};

const severityFromCases = cases => {
  const n = Number(cases || 0);
  if (n >= 100_000) return 'Extreme';
  if (n >= 10_000) return 'Severe';
  if (n >= 1_000) return 'Moderate';
  return 'Minor';
};

const computeRiskScore = params => {
  const cases = Math.max(0, Number(params.cases || 0));
  const growthRate = Number(params.growthRate || 0);
  const spread = Number(params.spread || 0);
  const severity = Number(params.severity || 0);
  const officialSignal = Number(params.officialSignal || 0);

  return (
    0.42 * Math.log(cases + 1) +
    0.18 * growthRate +
    0.1 * spread +
    0.2 * severity +
    0.1 * officialSignal
  );
};

const asLevelCases = snapshot => {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const municipal = Number(snapshot?.rollups?.municipal?.metrics?.cases || 0);
  const state = Number(snapshot?.rollups?.state?.metrics?.cases || 0);
  const country = Number(snapshot?.rollups?.country?.metrics?.cases || 0);
  if (municipal > 0) return municipal;
  if (state > 0) return state;
  return country;
};

const buildHealthUnifiedEvent = ({ feed, type, bbox, provider, countryCode }) => {
  if (!feed?.available) return null;
  const levelCases = asLevelCases(feed);
  const severity = severityFromCases(levelCases);
  const centerLat = bbox ? (bbox.minLat + bbox.maxLat) / 2 : 0;
  const centerLon = bbox ? (bbox.minLon + bbox.maxLon) / 2 : 0;
  const asOf = toIso(feed?.freshness?.asOf) || nowIso();
  const fetchedAt = toIso(feed?.freshness?.fetchedAt) || nowIso();
  const source = Array.isArray(feed?.sources) ? feed.sources[0] : null;

  return createUnifiedEvent({
    id: `health:${countryCode}:${type}:${asOf}`,
    type,
    subtype: feed?.disease?.id || type,
    severity,
    urgency: feed?.freshness?.status === 'FRESH' ? 'Expected' : 'Future',
    certainty: feed?.freshness?.status === 'FRESH' ? 'Observed' : 'Possible',
    confidence: Number(feed?.confidence || 0.65),
    startTime: asOf,
    updatedAt: fetchedAt,
    geometry: bbox ? { type: 'point', coordinates: [centerLon, centerLat] } : null,
    bbox: bbox || null,
    region: {
      country: countryCode,
      admin1: String(feed?.rollups?.state?.name || '') || null,
      city: String(feed?.rollups?.municipal?.name || '') || null,
    },
    source: {
      name: String(source?.name || 'Official public health source'),
      trustTier: provider.trustTier,
      sourceClass: provider.sourceClass,
      sourceAuthority: provider.sourceAuthority,
      referenceUrl: typeof source?.url === 'string' ? source.url : undefined,
    },
    recommendedActions:
      type === 'pandemic'
        ? ['Review local health guidance.', 'Avoid crowded indoor spaces when symptomatic.']
        : ['Review local health bulletins.', 'Use preventive measures for respiratory outbreaks.'],
    privacyLevel: 'public',
  });
};

const fetchFeed = async ({ country, disease }) => {
  return getEpidemicFeed({
    country,
    disease,
    metric: 'cases',
    window: '7d',
    normalize: 'count',
  });
};

const top3FromFeeds = ({ countryCode, bbox, pandemicFeed, epidemicFeed }) => {
  const centerLat = bbox ? (bbox.minLat + bbox.maxLat) / 2 : 0;
  const centerLon = bbox ? (bbox.minLon + bbox.maxLon) / 2 : 0;
  const sources = Array.isArray(pandemicFeed?.sources) ? pandemicFeed.sources : [];
  const officialSignal =
    (pandemicFeed?.freshness?.status === 'FRESH' ? 1 : 0.35) * (sources.length > 0 ? 1 : 0.45);
  const pandemicCases = asLevelCases(pandemicFeed);
  const epidemicCases = asLevelCases(epidemicFeed);

  const rows = PANDEMIC_WATCHLIST.map(item => {
    const normalizedTags = item.tags.map(tag => String(tag || '').toLowerCase());
    const covidMatch = normalizedTags.some(tag => ['covid', 'sars', 'mers'].includes(tag));
    const fluMatch = normalizedTags.some(tag => tag.includes('influenza') || tag.includes('h5') || tag.includes('h7'));
    const cases = covidMatch ? pandemicCases : fluMatch ? epidemicCases : 0;
    const severity = cases >= 100_000 ? 1 : cases >= 10_000 ? 0.8 : cases >= 1_000 ? 0.5 : 0.25;
    const riskScore = computeRiskScore({
      cases,
      growthRate: 0,
      spread: 0,
      severity,
      officialSignal,
    });
    return {
      id: `watch:${countryCode}:${item.id}`,
      diseaseId: item.id,
      diseaseLabel: item.label,
      rank: 0,
      riskScore: Number(riskScore.toFixed(4)),
      trend: 'flat',
      source: sources[0]
        ? {
            name: String(sources[0].name),
            url: String(sources[0].url || ''),
          }
        : null,
      updatedAt:
        toIso(pandemicFeed?.freshness?.asOf) ||
        toIso(epidemicFeed?.freshness?.asOf) ||
        nowIso(),
      region: {
        country: countryCode,
      },
      center: {
        latitude: centerLat,
        longitude: centerLon,
      },
      cases,
    };
  })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return rows;
};

const fetchHealthEvents = async ({ bbox, country, provider }) => {
  const startedAt = Date.now();
  const resolvedCountry = String(country || '').toUpperCase() || inferCountryFromBbox(bbox);
  if (!resolvedCountry) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'unavailable',
        reason: 'country_not_resolved',
      },
      countryCode: null,
      top3: [],
    };
  }

  try {
    const [pandemicFeed, epidemicFeed] = await Promise.all([
      fetchFeed({ country: resolvedCountry, disease: 'covid19' }),
      fetchFeed({ country: resolvedCountry, disease: 'influenza' }),
    ]);

    const events = [
      buildHealthUnifiedEvent({
        feed: pandemicFeed,
        type: 'pandemic',
        bbox,
        provider,
        countryCode: resolvedCountry,
      }),
      buildHealthUnifiedEvent({
        feed: epidemicFeed,
        type: 'epidemic',
        bbox,
        provider,
        countryCode: resolvedCountry,
      }),
    ].filter(Boolean);

    const top3 = top3FromFeeds({
      countryCode: resolvedCountry,
      bbox,
      pandemicFeed,
      epidemicFeed,
    });

    const hasOfficialData = events.length > 0;

    return {
      events,
      top3,
      countryCode: resolvedCountry,
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: hasOfficialData,
        stale: !hasOfficialData,
        status: hasOfficialData ? 'online' : 'unavailable',
        reason: hasOfficialData ? undefined : 'official_data_unavailable',
        eventCount: events.length,
      },
    };
  } catch (error) {
    return {
      events: [],
      top3: [],
      countryCode: resolvedCountry,
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: String(error?.message || 'health_provider_error'),
      },
    };
  }
};

module.exports = {
  fetchHealthEvents,
};
