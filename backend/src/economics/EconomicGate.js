'use strict';

const {
  getTierBudgetUsd,
  normalizeTier,
  readEconomicsPolicy,
} = require('./EconomicsPolicy');
const {allowDecision, degradeDecision, denyDecision, sanitizeUsd} = require('./EconomicDecision');
const {
  getUserMonthlyCost,
  addUserMonthlyCost,
  addRegionMonthlyCost,
  recordEconomicsDecision,
} = require('./UserCostTracker');
const {normalizeOperation} = require('./CostCatalog');

const isEconomicsGateEnabled = (env = process.env) =>
  String(env.ALERT_ECONOMICS_GATE_ENABLED || 'false')
    .trim()
    .toLowerCase() === 'true';

const fallbackModeForOperation = operation => {
  switch (normalizeOperation(operation)) {
    case 'RISK_PROVIDER':
      return 'stale_or_safe_payload';
    case 'WEATHER_PROVIDER':
      return 'safe_weather_payload';
    case 'GEOCODING_PROVIDER':
      return 'empty_geocode_payload';
    case 'MAP_ROUTE_PROVIDER':
      return 'estimated_route';
    case 'BILLING_LOOKUP':
      return 'cached_or_free_fallback';
    case 'FIRESTORE_READ':
      return 'cached_snapshot';
    case 'SOS_REAL_FANOUT':
      return 'essential_only';
    default:
      return 'safe_response';
  }
};

const normalizeCriticality = criticality => {
  const normalized = String(criticality || 'standard')
    .trim()
    .toLowerCase();
  if (normalized === 'life_safety') return 'life_safety';
  if (normalized === 'read_critical') return 'read_critical';
  return 'standard';
};

const recordDecisionMetrics = decision => {
  if (decision?.bypassed) {
    recordEconomicsDecision({
      decision: 'bypassed',
      estimatedCostUsd: decision.estimatedCostUsd,
    });
    return;
  }
  if (decision?.degraded) {
    recordEconomicsDecision({
      decision: 'degraded',
      estimatedCostUsd: decision.estimatedCostUsd,
    });
    return;
  }
  if (decision?.allowed) {
    recordEconomicsDecision({
      decision: 'allowed',
      estimatedCostUsd: decision.estimatedCostUsd,
    });
    return;
  }
  recordEconomicsDecision({
    decision: 'blocked',
    estimatedCostUsd: decision?.estimatedCostUsd,
  });
};

const decorateDecision = (decision, extras = {}) => {
  const economicsPolicy = readEconomicsPolicy();
  return {
    ...decision,
    ...extras,
    policy: economicsPolicy,
  };
};

const evaluateEconomicGate = async ({
  userKey,
  tier,
  operation,
  estimatedCostUsd,
  regionKey = 'global',
  criticality = 'standard',
}) => {
  const normalizedTier = normalizeTier(tier);
  const normalizedOperation = normalizeOperation(operation);
  const normalizedCriticality = normalizeCriticality(criticality);
  const safeEstimatedCostUsd = sanitizeUsd(estimatedCostUsd);
  const budgetUsd = getTierBudgetUsd(normalizedTier);

  if (!isEconomicsGateEnabled(process.env)) {
    const decision = decorateDecision(
      allowDecision('economics_gate_disabled', safeEstimatedCostUsd),
      {
        bypassed: true,
        tier: normalizedTier,
        operation: normalizedOperation,
        criticality: normalizedCriticality,
        budgetUsd,
        currentCostUsd: null,
        projectedCostUsd: null,
        regionKey,
      },
    );
    recordDecisionMetrics(decision);
    return decision;
  }

  try {
    const currentBucket = await getUserMonthlyCost(userKey);
    const currentCostUsd = Number(currentBucket?.totalCostUsd || 0);
    const projectedCostUsd = currentCostUsd + safeEstimatedCostUsd;

    let decision;
    if (projectedCostUsd <= budgetUsd) {
      decision = allowDecision('within_budget', safeEstimatedCostUsd);
    } else if (normalizedCriticality === 'life_safety') {
      decision = degradeDecision(
        'life_safety_budget_exceeded',
        safeEstimatedCostUsd,
        'essential_only',
      );
    } else {
      decision = degradeDecision(
        'budget_exceeded',
        safeEstimatedCostUsd,
        fallbackModeForOperation(normalizedOperation),
      );
    }

    const decorated = decorateDecision(decision, {
      bypassed: false,
      tier: normalizedTier,
      operation: normalizedOperation,
      criticality: normalizedCriticality,
      budgetUsd,
      currentCostUsd,
      projectedCostUsd,
      regionKey,
    });
    recordDecisionMetrics(decorated);
    return decorated;
  } catch (error) {
    let decision;
    if (normalizedCriticality === 'read_critical') {
      decision = allowDecision(
        'tracker_failed_allow_read_critical',
        safeEstimatedCostUsd,
      );
    } else if (normalizedCriticality === 'life_safety') {
      decision = degradeDecision(
        'tracker_failed_life_safety',
        safeEstimatedCostUsd,
        'essential_only',
      );
    } else {
      decision = degradeDecision(
        'tracker_failed_non_critical',
        safeEstimatedCostUsd,
        fallbackModeForOperation(normalizedOperation),
      );
    }

    const decorated = decorateDecision(decision, {
      bypassed: false,
      trackerFailed: true,
      trackerErrorType: String(error?.code || error?.message || 'unknown'),
      tier: normalizedTier,
      operation: normalizedOperation,
      criticality: normalizedCriticality,
      budgetUsd,
      currentCostUsd: null,
      projectedCostUsd: null,
      regionKey,
    });
    recordDecisionMetrics(decorated);
    return decorated;
  }
};

const registerEconomicCost = async ({
  userKey,
  tier,
  operation,
  actualCostUsd,
  regionKey = 'global',
  criticality = 'standard',
}) => {
  if (!isEconomicsGateEnabled(process.env)) {
    return null;
  }

  const safeActualCostUsd = sanitizeUsd(actualCostUsd);
  if (safeActualCostUsd <= 0) {
    return null;
  }

  const normalizedTier = normalizeTier(tier);
  const normalizedOperation = normalizeOperation(operation);
  const normalizedCriticality = normalizeCriticality(criticality);

  try {
    await addUserMonthlyCost(userKey, safeActualCostUsd, {
      operation: normalizedOperation,
      tier: normalizedTier,
      criticality: normalizedCriticality,
    });
    await addRegionMonthlyCost(regionKey, safeActualCostUsd, {
      operation: normalizedOperation,
      tier: normalizedTier,
      criticality: normalizedCriticality,
    });
    return {
      ok: true,
      actualCostUsd: safeActualCostUsd,
    };
  } catch (error) {
    return {
      ok: false,
      actualCostUsd: safeActualCostUsd,
      errorType: String(error?.code || error?.message || 'unknown'),
    };
  }
};

const withEconomicGate = async (options, fn, fallbackFn) => {
  const decision = await evaluateEconomicGate(options);

  if (decision.allowed && !decision.degraded) {
    const result = await fn(decision);
    await registerEconomicCost({
      userKey: options.userKey,
      tier: options.tier,
      operation: options.operation,
      actualCostUsd:
        options.actualCostUsd !== undefined
          ? options.actualCostUsd
          : options.estimatedCostUsd,
      regionKey: options.regionKey,
      criticality: options.criticality,
    });
    return result;
  }

  if (typeof fallbackFn === 'function') {
    const fallbackResult = await fallbackFn(decision);
    await registerEconomicCost({
      userKey: options.userKey,
      tier: options.tier,
      operation: options.operation,
      actualCostUsd: options.fallbackCostUsd,
      regionKey: options.regionKey,
      criticality: options.criticality,
    });
    return fallbackResult;
  }

  return denyDecision(
    decision.reason || 'economics_denied_without_fallback',
    decision.estimatedCostUsd,
  );
};

module.exports = {
  evaluateEconomicGate,
  registerEconomicCost,
  withEconomicGate,
  isEconomicsGateEnabled,
  fallbackModeForOperation,
};
