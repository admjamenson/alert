const { EventHubService } = require('../eventHub/EventHubService');
const { bboxFromPoint, nowIso } = require('../eventHub/utils');

const DEFAULT_RISK_FEED_TYPES = [
  'sos',
  'earthquake',
  'flood',
  'cyclone',
  'hurricane',
  'storm',
  'wildfire',
  'volcano',
  'tsunami',
  'drought',
  'high_tide',
  'rogue_waves',
  'sandstorm',
  'dust_devils',
  'downdraft',
  'heat',
  'heatwave',
  'snowstorm',
  'lightning',
  'hail',
  'gale',
  'wind',
  'wind_gust_10',
  'wind_gust_50',
  'energy_outage',
  'water_outage',
];

const RISK_FEED_CACHE = new Map();
const RISK_FEED_INFLIGHT = new Map();
const MAX_RISK_FEED_CACHE_ENTRIES = Math.max(
  50,
  Number(process.env.ALERT_RISK_FEED_CACHE_MAX_ENTRIES || 250),
);

const parseFiniteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampRadiusKm = value => {
  const parsed = parseFiniteNumber(value);
  if (!parsed) return 35;
  return Math.max(5, Math.min(80, Math.round(parsed)));
};

const clampLimit = value => {
  const parsed = parseFiniteNumber(value);
  if (!parsed) return 120;
  return Math.max(10, Math.min(180, Math.round(parsed)));
};

const readRiskFeedTimeoutMs = () => {
  const parsed = Number(process.env.ALERT_RISK_FEED_TIMEOUT_MS || 1800);
  return Number.isFinite(parsed) ? Math.max(500, Math.round(parsed)) : 1800;
};

const readRiskFeedCacheTtlMs = () => {
  const parsed = Number(process.env.ALERT_RISK_FEED_CACHE_TTL_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.round(parsed)) : 60_000;
};

const readRiskFeedStaleTtlMs = () => {
  const parsed = Number(process.env.ALERT_RISK_FEED_STALE_TTL_MS || 5 * 60_000);
  return Number.isFinite(parsed) ? Math.max(readRiskFeedCacheTtlMs(), Math.round(parsed)) : 5 * 60_000;
};

const readRiskFeedTypes = () => {
  const raw = String(process.env.ALERT_RISK_FEED_TYPES || '').trim();
  const items = (raw ? raw.split(',') : DEFAULT_RISK_FEED_TYPES)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(items));
};

const cloneRiskFeedPayload = payload => JSON.parse(JSON.stringify(payload));

const riskFeedCacheKeyFor = ({
  latitude,
  longitude,
  radiusKm,
  limit,
  sosPublicOptIn,
  riskFeedTypes,
}) =>
  JSON.stringify({
    latitude: Number(latitude).toFixed(3),
    longitude: Number(longitude).toFixed(3),
    radiusKm: clampRadiusKm(radiusKm),
    limit: clampLimit(limit),
    sosPublicOptIn: Boolean(sosPublicOptIn),
    riskFeedTypes,
  });

const pruneRiskFeedCache = () => {
  while (RISK_FEED_CACHE.size > MAX_RISK_FEED_CACHE_ENTRIES) {
    const oldestKey = RISK_FEED_CACHE.keys().next().value;
    if (!oldestKey) break;
    RISK_FEED_CACHE.delete(oldestKey);
  }
};

const readRiskFeedCacheEntry = key => {
  const row = RISK_FEED_CACHE.get(key);
  if (!row) return null;
  const now = Date.now();
  if (row.staleExpiresAt <= now) {
    RISK_FEED_CACHE.delete(key);
    return null;
  }
  return {
    payload: cloneRiskFeedPayload(row.payload),
    fresh: row.expiresAt > now,
  };
};

const writeRiskFeedCacheEntry = (key, payload) => {
  RISK_FEED_CACHE.delete(key);
  RISK_FEED_CACHE.set(key, {
    payload: cloneRiskFeedPayload(payload),
    expiresAt: Date.now() + readRiskFeedCacheTtlMs(),
    staleExpiresAt: Date.now() + readRiskFeedStaleTtlMs(),
  });
  pruneRiskFeedCache();
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(
      () =>
        resolve({
          timedOut: true,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const riskLevelFromSeverity = severity => {
  const normalized = String(severity || '').toLowerCase();
  if (normalized.includes('extreme') || normalized.includes('critical')) {
    return 'Extreme';
  }
  if (normalized.includes('severe') || normalized.includes('high')) {
    return 'Severe';
  }
  if (normalized.includes('moderate') || normalized.includes('medium')) {
    return 'Moderate';
  }
  return 'Minor';
};

const toAlertNotification = event => {
  const lat = Number(event?.geometry?.coordinates?.[1]);
  const lon = Number(event?.geometry?.coordinates?.[0]);
  const title = String(event?.type || 'alert')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  return {
    id: String(event?.id || ''),
    type: event?.type === 'sos' ? 'sos' : 'hazard',
    title,
    summary:
      Array.isArray(event?.recommendedActions) &&
      typeof event.recommendedActions[0] === 'string'
        ? event.recommendedActions[0]
        : 'Relevant risk signal in your area.',
    timestamp: String(event?.updatedAt || event?.startTime || nowIso()),
    sourceName: String(event?.source?.name || 'Alert'),
    sourceUrl:
      typeof event?.source?.referenceUrl === 'string'
        ? event.source.referenceUrl
        : undefined,
    severity: riskLevelFromSeverity(event?.severity),
    data: {
      kind: 'event_hub',
      eventType: String(event?.type || '').trim().toLowerCase(),
      severity: String(event?.severity || ''),
      urgency: String(event?.urgency || ''),
      certainty: String(event?.certainty || ''),
      confidence: Number(event?.confidence || 0),
      trustTier: String(event?.source?.trustTier || 'C'),
      location:
        Number.isFinite(lat) && Number.isFinite(lon)
          ? {
              latitude: lat,
              longitude: lon,
            }
          : undefined,
    },
  };
};

const shouldPreAlert = (alerts, riskScore) => {
  if (!Array.isArray(alerts) || alerts.length === 0) return false;
  if (Number.isFinite(Number(riskScore)) && Number(riskScore) >= 0.46) {
    return true;
  }
  return alerts.some(alert =>
    ['Severe', 'Extreme', 'Major'].includes(String(alert?.severity || '')),
  );
};

const buildRiskFeedTimeoutPayload = ({ riskFeedTypes }) => ({
  alerts: [],
  providers: [],
  preAlert: {
    shouldNotify: false,
    reasonCodes: ['risk_feed_timeout'],
  },
  meta: {
    generatedAt: nowIso(),
    failClosed: true,
    cacheHit: false,
    hubAvailable: false,
    degraded: true,
    reason: 'risk_feed_timeout',
    timeoutMs: readRiskFeedTimeoutMs(),
    types: riskFeedTypes,
  },
});

const getRiskFeed = async (
  { latitude, longitude, radiusKm, limit, riskScore, sosPublicOptIn },
  { db } = {},
) => {
  const lat = parseFiniteNumber(latitude);
  const lon = parseFiniteNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      alerts: [],
      providers: [],
      preAlert: {
        shouldNotify: false,
        reasonCodes: ['location_invalid'],
      },
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
        cacheHit: false,
        hubAvailable: false,
      },
    };
  }

  const bbox = bboxFromPoint(lat, lon, clampRadiusKm(radiusKm));
  const riskFeedTypes = readRiskFeedTypes();
  const cacheKey = riskFeedCacheKeyFor({
    latitude: lat,
    longitude: lon,
    radiusKm,
    limit,
    sosPublicOptIn,
    riskFeedTypes,
  });
  const cached = readRiskFeedCacheEntry(cacheKey);
  if (cached?.fresh) {
    return {
      ...cached.payload,
      preAlert: {
        shouldNotify: shouldPreAlert(cached.payload.alerts, riskScore),
        reasonCodes: shouldPreAlert(cached.payload.alerts, riskScore)
          ? ['elevated_risk_signal']
          : [],
      },
      meta: {
        ...cached.payload.meta,
        generatedAt: nowIso(),
        cacheHit: true,
        cacheLayer: 'risk_feed',
        stale: false,
        coalesced: false,
      },
    };
  }

  const existing = RISK_FEED_INFLIGHT.get(cacheKey);
  if (existing) {
    const payload = await existing;
    return {
      ...payload,
      meta: {
        ...payload.meta,
        generatedAt: nowIso(),
        coalesced: true,
      },
    };
  }

  const request = (async () => {
    const payload = await withTimeout(
      EventHubService.getEvents(
        {
          bbox: [
            bbox.minLon.toFixed(4),
            bbox.minLat.toFixed(4),
            bbox.maxLon.toFixed(4),
            bbox.maxLat.toFixed(4),
          ].join(','),
          types: riskFeedTypes.join(','),
          limit: clampLimit(limit),
          sosPublicOptIn,
        },
        { db },
      ),
      readRiskFeedTimeoutMs(),
    );

    if (payload?.timedOut) {
      if (cached?.payload) {
        return {
          ...cached.payload,
          preAlert: {
            shouldNotify: shouldPreAlert(cached.payload.alerts, riskScore),
            reasonCodes: ['risk_feed_timeout_stale'],
          },
          meta: {
            ...cached.payload.meta,
            generatedAt: nowIso(),
            cacheHit: true,
            cacheLayer: 'risk_feed',
            stale: true,
            hubAvailable: false,
            degraded: true,
            reason: 'risk_feed_timeout_stale',
            timeoutMs: readRiskFeedTimeoutMs(),
            types: riskFeedTypes,
          },
        };
      }
      return buildRiskFeedTimeoutPayload({ riskFeedTypes });
    }

    const alerts = Array.isArray(payload?.events)
      ? payload.events.map(toAlertNotification).filter(alert => alert.id)
      : [];
    const notify = shouldPreAlert(alerts, riskScore);

    const result = {
      alerts,
      providers: Array.isArray(payload?.providers) ? payload.providers : [],
      preAlert: {
        shouldNotify: notify,
        reasonCodes: notify ? ['elevated_risk_signal'] : [],
      },
      meta: {
        generatedAt: payload?.meta?.generatedAt || nowIso(),
        failClosed: Boolean(payload?.meta?.failClosed ?? true),
        cacheHit: Boolean(payload?.meta?.cacheHit),
        cacheLayer: payload?.meta?.cacheHit ? payload?.meta?.cacheDriver || 'event_hub' : 'none',
        hubAvailable: true,
        stale: false,
        coalesced: false,
        types: riskFeedTypes,
      },
    };
    writeRiskFeedCacheEntry(cacheKey, result);
    return result;
  })();

  RISK_FEED_INFLIGHT.set(cacheKey, request);
  try {
    return await request;
  } finally {
    RISK_FEED_INFLIGHT.delete(cacheKey);
  }
};

module.exports = {
  getRiskFeed,
  readRiskFeedCacheTtlMs,
  readRiskFeedStaleTtlMs,
  readRiskFeedTimeoutMs,
  readRiskFeedTypes,
};
