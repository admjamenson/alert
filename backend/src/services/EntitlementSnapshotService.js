const crypto = require('crypto');

const firestoreTimeToMillis = value => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return null;
};

const stableBucket = seed => {
  const hash = crypto
    .createHash('sha256')
    .update(String(seed || ''))
    .digest();
  return hash.readUInt32BE(0) % 100;
};

const buildLimits = isPremium => ({
  monitoring: {
    maxRadiusKm: isPremium ? 80 : 35,
    maxItems: isPremium ? 180 : 90,
    refreshFloorSec: isPremium ? 20 : 60,
  },
  epidemic: {
    maxWindow: isPremium ? 'all' : '7d',
  },
  weather: {
    minRefreshSec: isPremium ? 60 : 120,
  },
});

const buildCostGates = isPremium => ({
  realtimeRiskFeed: true,
  extendedMonitoring: isPremium,
  epidemicAllWindow: isPremium,
  highFrequencyPolling: isPremium,
});

const buildReasonCodes = isPremium =>
  isPremium ? [] : ['plan_free_standard_limits'];

const fetchPremiumStatus = async ({ userId, db, config }) => {
  if (!db) {
    return Boolean(
      config?.premium?.forcedUsers?.has(userId) ||
        config?.premium?.defaultPremium,
    );
  }

  try {
    const entitlementDoc = await db.collection('entitlements').doc(userId).get();
    const data = entitlementDoc.exists ? entitlementDoc.data() || {} : {};
    const plan = String(data.plan || '').toLowerCase();
    const expiresAtRaw = firestoreTimeToMillis(data.expiresAt);
    const notExpired = !expiresAtRaw || expiresAtRaw > Date.now();
    const fromDoc = plan === 'premium' && notExpired;

    return Boolean(
      fromDoc ||
        config?.premium?.forcedUsers?.has(userId) ||
        config?.premium?.defaultPremium,
    );
  } catch {
    return Boolean(
      config?.premium?.forcedUsers?.has(userId) ||
        config?.premium?.defaultPremium,
    );
  }
};

const buildEntitlementSnapshot = async (
  { userId, deviceId, platform },
  { db, config },
) => {
  const safePlatform = String(platform || '').toLowerCase();
  const isPremium = await fetchPremiumStatus({ userId, db, config });
  const bucket = stableBucket(userId);
  const rollout = config?.premium?.rollout || {};

  return {
    userId,
    deviceId,
    plan: isPremium ? 'premium' : 'free',
    premium: isPremium,
    entitlements: {
      premium: isPremium,
    },
    featureFlags: {
      starlinkConnect:
        isPremium && bucket < Number(rollout.starlinkConnectPercent || 0),
      starlinkTunnelBeta:
        isPremium &&
        safePlatform === 'android' &&
        bucket < Number(rollout.starlinkTunnelPercent || 0),
      starlinkExclusive:
        isPremium &&
        safePlatform === 'android' &&
        bucket < Number(rollout.starlinkExclusivePercent || 0),
    },
    rollout: {
      starlinkConnectPercent: Number(rollout.starlinkConnectPercent || 0),
      starlinkTunnelPercent: Number(rollout.starlinkTunnelPercent || 0),
      starlinkExclusivePercent: Number(rollout.starlinkExclusivePercent || 0),
    },
    limits: buildLimits(isPremium),
    costGates: buildCostGates(isPremium),
    degradedMode: !isPremium,
    reasonCodes: buildReasonCodes(isPremium),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
};

module.exports = {
  buildEntitlementSnapshot,
  fetchPremiumStatus,
  firestoreTimeToMillis,
  stableBucket,
};
