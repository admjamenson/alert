/**
 * Safe Mode Configuration and Hard Bypass Helpers
 *
 * When ALERT_LOAD_TEST_SAFE_MODE=true, these helpers provide immediate
 * responses without calling external services, Firestore, or heavy operations.
 */

const nowIso = () => new Date().toISOString();
const TEN_MINUTES_MS = 10 * 60 * 1000;

const parseFiniteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampLimit = value => {
  const parsed = parseFiniteNumber(value);
  if (!parsed) return 10;
  return Math.max(1, Math.min(120, Math.round(parsed)));
};

const readIdentityValue = candidates => {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const resolveSafeIdentity = req => {
  const query = req?.query || {};
  const body = req?.body || {};
  const headers = req?.headers || {};

  const userId =
    readIdentityValue([
      query.userId,
      body.userId,
      headers['x-alert-user-id'],
    ]) || 'safe-mode-user';
  const deviceId =
    readIdentityValue([
      query.deviceId,
      body.deviceId,
      headers['x-alert-device-id'],
      headers['x-device-id'],
    ]) || 'safe-mode-device';

  return {
    userId,
    deviceId,
  };
};

let hardBypassRiskFeedCount = 0;
let hardBypassEntitlementsCount = 0;
let hardBypassLastAt = null;

const isLoadTestSafeMode = () => process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true';

const isRemoteOverrideDisabled = () =>
  process.env.ALERT_DISABLE_REMOTE_RELEASE_OVERRIDE === 'true' ||
  isLoadTestSafeMode();

const recordSafeModeRiskBypassMetric = () => {
  hardBypassRiskFeedCount++;
  hardBypassLastAt = nowIso();
};

const recordSafeModeEntitlementBypassMetric = () => {
  hardBypassEntitlementsCount++;
  hardBypassLastAt = nowIso();
};

const buildSafeModeRiskFeedPayload = req => {
  const generatedAt = nowIso();
  const latitude = parseFiniteNumber(req?.query?.lat) ?? 0;
  const longitude = parseFiniteNumber(req?.query?.lon) ?? 0;
  const limit = clampLimit(req?.query?.limit);
  const riskScore = parseFiniteNumber(req?.query?.riskScore) ?? 0;

  return {
    ok: true,
    safeMode: true,
    source: 'safe_mode_hard_bypass',
    generatedAt,
    riskScore,
    location: {
      latitude,
      longitude,
    },
    alerts: [],
    providers: [],
    preAlert: {
      shouldNotify: false,
      reasonCodes: [],
    },
    cache: {
      bypassed: true,
      driver: 'none',
    },
    providerDispatch: {
      skipped: true,
    },
    limits: {
      maxRadiusKm: 35,
      maxItems: limit,
    },
    meta: {
      generatedAt,
      failClosed: true,
      cacheHit: false,
      cacheLayer: 'safe_mode_hard_bypass',
      hubAvailable: false,
      degraded: false,
      safeMode: true,
      hardBypass: true,
      reason: 'safe_mode_hard_bypass',
      providerCalls: 0,
      firestoreCalls: 0,
      requestedLimit: limit,
    },
  };
};

const buildSafeModeEntitlementsPayload = req => {
  const generatedAt = nowIso();
  const {userId, deviceId} = resolveSafeIdentity(req);

  return {
    ok: true,
    safeMode: true,
    source: 'safe_mode_hard_bypass',
    generatedAt,
    userId,
    deviceId,
    tier: 'free',
    plan: 'free',
    premium: false,
    entitlements: {
      premium: false,
    },
    trial: false,
    subscription: null,
    rollout: {
      starlinkConnectPercent: 0,
      starlinkTunnelPercent: 0,
      starlinkExclusivePercent: 0,
    },
    featureFlags: {},
    limits: {
      monitoring: {
        maxRadiusKm: 35,
        maxItems: 90,
        refreshFloorSec: 60,
      },
      epidemic: {
        maxWindow: '7d',
      },
      weather: {
        minRefreshSec: 120,
      },
    },
    costGates: {
      realtimeRiskFeed: true,
      extendedMonitoring: false,
      epidemicAllWindow: false,
      highFrequencyPolling: false,
    },
    degradedMode: true,
    reasonCodes: ['safe_mode_hard_bypass'],
    expiresAt: new Date(Date.now() + TEN_MINUTES_MS).toISOString(),
    release: null,
    billing: {
      skipped: true,
      source: 'safe_mode_hard_bypass',
    },
    meta: {
      generatedAt,
      safeMode: true,
      hardBypass: true,
      reason: 'safe_mode_hard_bypass',
      firestoreLookups: 0,
      billingLookups: 0,
    },
  };
};

const getSafeModeMetrics = () => ({
  isActive: isLoadTestSafeMode(),
  hardBypassRiskFeedCount,
  hardBypassEntitlementsCount,
  hardBypassLastAt,
  remoteOverrideDisabled: isRemoteOverrideDisabled(),
});

const resetSafeModeCounters = () => {
  hardBypassRiskFeedCount = 0;
  hardBypassEntitlementsCount = 0;
  hardBypassLastAt = null;
};

module.exports = {
  isLoadTestSafeMode,
  isRemoteOverrideDisabled,
  buildSafeModeRiskFeedPayload,
  buildSafeModeEntitlementsPayload,
  recordSafeModeRiskBypassMetric,
  recordSafeModeEntitlementBypassMetric,
  getSafeModeMetrics,
  resetSafeModeCounters,
  get hardBypassRiskFeedCount() {
    return hardBypassRiskFeedCount;
  },
  get hardBypassEntitlementsCount() {
    return hardBypassEntitlementsCount;
  },
};
