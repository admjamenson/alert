const { EventHubService } = require('../eventHub/EventHubService');
const { bboxFromPoint, nowIso } = require('../eventHub/utils');

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
  const parsed = Number(process.env.ALERT_RISK_FEED_TIMEOUT_MS || 2200);
  return Number.isFinite(parsed) ? Math.max(500, Math.round(parsed)) : 2200;
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
  const payload = await withTimeout(
    EventHubService.getEvents(
      {
        bbox: [
          bbox.minLon.toFixed(4),
          bbox.minLat.toFixed(4),
          bbox.maxLon.toFixed(4),
          bbox.maxLat.toFixed(4),
        ].join(','),
        limit: clampLimit(limit),
        sosPublicOptIn,
      },
      { db },
    ),
    readRiskFeedTimeoutMs(),
  );

  if (payload?.timedOut) {
    return {
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
      },
    };
  }

  const alerts = Array.isArray(payload?.events)
    ? payload.events.map(toAlertNotification).filter(alert => alert.id)
    : [];
  const notify = shouldPreAlert(alerts, riskScore);

  return {
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
      hubAvailable: true,
    },
  };
};

module.exports = {
  getRiskFeed,
  readRiskFeedTimeoutMs,
};
