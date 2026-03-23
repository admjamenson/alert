const { fetchJsonWithRetry } = require('../fetcher');
const { createUnifiedEvent, nowIso, toIso } = require('../utils');

const USGS_BASE_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

const severityFromMagnitude = magnitude => {
  const mag = Number(magnitude || 0);
  if (mag >= 7) return 'Extreme';
  if (mag >= 6) return 'Severe';
  if (mag >= 5) return 'Moderate';
  return 'Minor';
};

const urgencyFromMillis = ts => {
  const ageMs = Math.max(0, Date.now() - Number(ts || 0));
  if (ageMs <= 2 * 60 * 60 * 1000) return 'Immediate';
  if (ageMs <= 24 * 60 * 60 * 1000) return 'Expected';
  return 'Future';
};

const buildUrl = ({ bbox, since, limit = 200 }) => {
  const query = new URLSearchParams({
    format: 'geojson',
    orderby: 'time',
    limit: String(limit),
    minmagnitude: '2.5',
  });
  if (bbox) {
    query.set('minlatitude', String(bbox.minLat));
    query.set('maxlatitude', String(bbox.maxLat));
    query.set('minlongitude', String(bbox.minLon));
    query.set('maxlongitude', String(bbox.maxLon));
  }
  const sinceIso = toIso(since);
  if (sinceIso) {
    query.set('starttime', sinceIso);
  }
  return `${USGS_BASE_URL}?${query.toString()}`;
};

const fetchGeophysicalEvents = async ({ bbox, since, provider }) => {
  const startedAt = Date.now();
  const url = buildUrl({ bbox, since });
  const result = await fetchJsonWithRetry(url, {
    cacheKey: `usgs:${url}`,
    cacheTtlMs: provider.cacheTTLms,
    retries: 2,
    retryDelayMs: 240,
    timeoutMs: provider.latencyBudgetMs || 1200,
    rateLimitKey: provider.id,
    maxPerMinute: 60,
  });

  if (!result.ok) {
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
        status: 'offline',
        reason: result.error || 'usgs_unavailable',
      },
    };
  }

  const features = Array.isArray(result.json?.features) ? result.json.features : [];
  const events = features.map(feature => {
    const props = feature?.properties || {};
    const geometry = feature?.geometry;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
    const lon = Number(coordinates?.[0]);
    const lat = Number(coordinates?.[1]);
    const depthKm = Number(coordinates?.[2]);
    const timestampMs = Number(props.time || 0);
    const severity = severityFromMagnitude(props.mag);
    const urgency = urgencyFromMillis(timestampMs);
    return createUnifiedEvent({
      id: String(feature?.id || ''),
      type: 'earthquake',
      subtype: depthKm >= 70 ? 'deep' : 'shallow',
      severity,
      urgency,
      certainty: 'Observed',
      confidence: 0.92,
      startTime: timestampMs ? new Date(timestampMs).toISOString() : nowIso(),
      updatedAt: timestampMs ? new Date(timestampMs).toISOString() : nowIso(),
      geometry:
        Number.isFinite(lat) && Number.isFinite(lon)
          ? { type: 'point', coordinates: [lon, lat] }
          : null,
      region: {
        country: null,
        admin1: null,
        city: String(props.place || ''),
      },
      source: {
        name: 'USGS Earthquake Hazards Program',
        trustTier: provider.trustTier,
        sourceClass: provider.sourceClass,
        sourceAuthority: provider.sourceAuthority,
        referenceUrl: typeof props.url === 'string' ? props.url : 'https://earthquake.usgs.gov/',
      },
      recommendedActions: [
        'Drop, cover, and hold on.',
        'Stay away from damaged buildings and downed power lines.',
      ],
      privacyLevel: 'public',
    });
  });

  return {
    events,
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
      ok: true,
      stale: false,
      status: 'online',
      eventCount: events.length,
      cacheHit: Boolean(result.cached),
    },
  };
};

module.exports = {
  fetchGeophysicalEvents,
};
