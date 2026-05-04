/**
 * Safe Mode Configuration and Hard Bypass Helpers
 *
 * When ALERT_LOAD_TEST_SAFE_MODE=true, these helpers provide immediate
 * responses without calling external services, Firestore, or heavy operations.
 */

const nowIso = () => new Date().toISOString();

// Contadores de hard bypass (em memória)
let hardBypassRiskFeedCount = 0;
let hardBypassEntitlementsCount = 0;
let hardBypassLastAt = null;

/**
 * Verifica se o safe mode de load test está ativo
 */
const isLoadTestSafeMode = () => {
  return process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true';
};

/**
 * Verifica se o remote override está desabilitado
 */
const isRemoteOverrideDisabled = () => {
  return (
    process.env.ALERT_DISABLE_REMOTE_RELEASE_OVERRIDE === 'true' ||
    process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true'
  );
};

/**
 * Incrementa contador de hard bypass para risk feed
 */
const incrementRiskFeedBypass = () => {
  hardBypassRiskFeedCount++;
  hardBypassLastAt = new Date().toISOString();
};

/**
 * Incrementa contador de hard bypass para entitlements
 */
const incrementEntitlementsBypass = () => {
  hardBypassEntitlementsCount++;
  hardBypassLastAt = new Date().toISOString();
};

/**
 * Constrói payload seguro para /api/v1/risk/feed em safe mode
 * - Sem await
 * - Sem provider
 * - Sem Firestore
 * - Sem EventHubService
 * - Latência < 1ms
 */
const buildSafeModeRiskFeedPayload = req => {
  incrementRiskFeedBypass();

  const lat = req.query?.lat ? Number(req.query.lat) : 0;
  const lon = req.query?.lon ? Number(req.query.lon) : 0;
  const limit = req.query?.limit ? Math.min(Number(req.query.limit), 120) : 10;

  return {
    ok: true,
    safeMode: true,
    source: 'safe_mode_hard_bypass',
    generatedAt: nowIso(),
    location: {
      latitude: lat,
      longitude: lon,
    },
    alerts: [],
    providers: [],
    riskScore: 0,
    meta: {
      safeMode: true,
      hardBypass: true,
      providerCalls: 0,
      firestoreCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
    },
    cache: {
      bypassed: true,
      source: 'safe_mode',
    },
    limits: {
      maxRadiusKm: 35,
      maxItems: limit,
    },
  };
};

/**
 * Constrói payload seguro para /api/me/entitlements em safe mode
 * - Sem await
 * - Sem Firestore
 * - Sem Stripe
 * - Sem Apple billing
 * - Latência < 1ms
 */
const buildSafeModeEntitlementsPayload = req => {
  incrementEntitlementsBypass();

  return {
    ok: true,
    safeMode: true,
    source: 'safe_mode_hard_bypass',
    generatedAt: nowIso(),
    tier: 'free',
    plan: 'free',
    premium: false,
    trial: false,
    subscription: null,
    billing: {
      skipped: true,
      source: 'safe_mode',
    },
    limits: {
      monitoring: {
        maxRadiusKm: 35,
        maxItems: 120,
      },
      epidemic: {
        maxWindow: '7d',
      },
      weather: {
        maxRequestsPerDay: 1000,
      },
    },
    featureFlags: {},
    release: null,
    meta: {
      safeMode: true,
      hardBypass: true,
      firestoreLookups: 0,
      billingLookups: 0,
    },
  };
};

/**
 * Retorna status atual do safe mode para métricas
 */
const getSafeModeMetrics = () => ({
  isActive: isLoadTestSafeMode(),
  hardBypassRiskFeedCount,
  hardBypassEntitlementsCount,
  hardBypassLastAt,
  remoteOverrideDisabled: isRemoteOverrideDisabled(),
});

/**
 * Reset counters (útil para testes)
 */
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
  getSafeModeMetrics,
  resetSafeModeCounters,
  // Export counters for testing
  get hardBypassRiskFeedCount() {
    return hardBypassRiskFeedCount;
  },
  get hardBypassEntitlementsCount() {
    return hardBypassEntitlementsCount;
  },
};
