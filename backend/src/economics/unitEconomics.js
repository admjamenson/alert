const DEFAULT_FREEMIUM_COST_RATIO_CAP = 0.2;
const DEFAULT_PREMIUM_COST_RATIO_CAP = 0.3;

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampRatio = value => Math.max(0, Math.min(1, numberOr(value, 0)));

const ratioCapForTier = tier =>
  tier === 'premium'
    ? DEFAULT_PREMIUM_COST_RATIO_CAP
    : DEFAULT_FREEMIUM_COST_RATIO_CAP;

const evaluateUnitEconomics = ({
  tier = 'free',
  monthlyNetRevenueUsd = 0,
  monthlyVariableCostUsd = 0,
}) => {
  const normalizedTier = tier === 'premium' ? 'premium' : 'free';
  const revenue = Math.max(0, numberOr(monthlyNetRevenueUsd, 0));
  const variableCost = Math.max(0, numberOr(monthlyVariableCostUsd, 0));
  const capRatio = ratioCapForTier(normalizedTier);
  const maxVariableCostUsd = revenue * capRatio;
  const remainingBudgetUsd = maxVariableCostUsd - variableCost;
  return {
    tier: normalizedTier,
    monthlyNetRevenueUsd: revenue,
    monthlyVariableCostUsd: variableCost,
    capRatio,
    maxVariableCostUsd,
    remainingBudgetUsd,
    overBudgetUsd: Math.max(0, -remainingBudgetUsd),
    costRatio: revenue > 0 ? variableCost / revenue : null,
    withinGuardrail: revenue > 0 && variableCost <= maxVariableCostUsd,
  };
};

const estimateMonthlyVariableCost = ({
  feedRefreshesPerDay = 0,
  providerMissRate = 0.08,
  feedServingCostUsd = 0.000002,
  providerMissCostUsd = 0.0012,
  weatherRefreshesPerDay = 0,
  weatherProviderMissRate = providerMissRate,
  weatherProviderMissCostUsd = 0.0009,
  mapSessionsPerMonth = 0,
  mapSessionCostUsd = 0.00003,
  sosPerMonth = 0,
  sosRelayCostUsd = 0.0002,
  pushPerMonth = 0,
  pushCostUsd = 0.00001,
  queueJobsPerMonth = 0,
  queueJobCostUsd = 0.000002,
  cacheOperationsPerMonth = 0,
  cacheOperationCostUsd = 0.0000002,
  telemetryEventsPerMonth = 50,
  telemetryCostUsd = 0.000001,
  storageMbMonth = 0,
  storageGbMonthCostUsd = 0.026,
  backendRequestsPerMonth = 0,
  backendRequestCostUsd = 0.000004,
  paymentTransactionsPerMonth = 0,
  paymentGrossRevenueUsd = 0,
  paymentProcessorPercent = 0.029,
  paymentProcessorFixedUsd = 0.3,
  appStoreFeePercent = 0.15,
}) => {
  const monthlyFeedRefreshes = Math.max(0, numberOr(feedRefreshesPerDay, 0)) * 30;
  const monthlyWeatherRefreshes =
    Math.max(0, numberOr(weatherRefreshesPerDay, 0)) * 30;
  const feedServing = monthlyFeedRefreshes * Math.max(0, feedServingCostUsd);
  const providerMisses =
    monthlyFeedRefreshes *
    clampRatio(providerMissRate) *
    Math.max(0, providerMissCostUsd);
  const weatherProviderMisses =
    monthlyWeatherRefreshes *
    clampRatio(weatherProviderMissRate) *
    Math.max(0, weatherProviderMissCostUsd);
  const maps = Math.max(0, numberOr(mapSessionsPerMonth, 0)) * Math.max(0, mapSessionCostUsd);
  const sosRelay = Math.max(0, numberOr(sosPerMonth, 0)) * Math.max(0, sosRelayCostUsd);
  const push = Math.max(0, numberOr(pushPerMonth, 0)) * Math.max(0, pushCostUsd);
  const queueJobs =
    Math.max(0, numberOr(queueJobsPerMonth, 0)) * Math.max(0, queueJobCostUsd);
  const cache =
    Math.max(0, numberOr(cacheOperationsPerMonth, 0)) *
    Math.max(0, cacheOperationCostUsd);
  const telemetry =
    Math.max(0, numberOr(telemetryEventsPerMonth, 0)) * Math.max(0, telemetryCostUsd);
  const storage =
    (Math.max(0, numberOr(storageMbMonth, 0)) / 1024) *
    Math.max(0, storageGbMonthCostUsd);
  const backendServing =
    Math.max(0, numberOr(backendRequestsPerMonth, 0)) *
    Math.max(0, backendRequestCostUsd);
  const paymentFees =
    Math.max(0, numberOr(paymentGrossRevenueUsd, 0)) *
      (clampRatio(paymentProcessorPercent) + clampRatio(appStoreFeePercent)) +
    Math.max(0, numberOr(paymentTransactionsPerMonth, 0)) *
      Math.max(0, paymentProcessorFixedUsd);

  return {
    totalUsd:
      feedServing +
      providerMisses +
      weatherProviderMisses +
      maps +
      sosRelay +
      push +
      queueJobs +
      cache +
      telemetry +
      storage +
      backendServing +
      paymentFees,
    components: {
      feedServing,
      providerMisses,
      weatherProviderMisses,
      maps,
      sosRelay,
      push,
      queueJobs,
      cache,
      telemetry,
      storage,
      backendServing,
      paymentFees,
    },
    assumptions: {
      providerMissRate,
      feedServingCostUsd,
      providerMissCostUsd,
      weatherProviderMissRate,
      weatherProviderMissCostUsd,
      mapSessionCostUsd,
      sosRelayCostUsd,
      pushCostUsd,
      queueJobCostUsd,
      cacheOperationCostUsd,
      telemetryCostUsd,
      storageGbMonthCostUsd,
      backendRequestCostUsd,
      paymentProcessorPercent,
      paymentProcessorFixedUsd,
      appStoreFeePercent,
    },
  };
};

const assertWithinUnitEconomics = params => {
  const result = evaluateUnitEconomics(params);
  if (!result.withinGuardrail) {
    const error = new Error('unit_economics_guardrail_violation');
    error.details = result;
    throw error;
  }
  return result;
};

const recommendedActionsFor = largestComponentName => {
  const common = ['block_or_gate_feature', 'measure_real_cost_before_rollout'];
  if (
    largestComponentName === 'providerMisses' ||
    largestComponentName === 'weatherProviderMisses'
  ) {
    return [
      'cache_harder',
      'materialize_hot_path',
      'reduce_refresh_frequency',
      'enforce_provider_budget',
      ...common,
    ];
  }
  if (largestComponentName === 'maps') {
    return [
      'cache_harder',
      'use_cheaper_map_path',
      'reduce_map_session_frequency',
      ...common,
    ];
  }
  if (largestComponentName === 'paymentFees') {
    return [
      'verify_net_revenue_inputs',
      'prefer_lower_fee_route_where_policy_allows',
      ...common,
    ];
  }
  if (largestComponentName === 'backendServing' || largestComponentName === 'cache') {
    return ['materialize_hot_path', 'edge_cache', 'reduce_frequency', ...common];
  }
  return ['degrade_noncritical_path', 'reduce_frequency', ...common];
};

const decisionForGuardrail = ({ guardrail, largestComponent }) => {
  if (guardrail.withinGuardrail) return 'allow';
  if (!guardrail.monthlyNetRevenueUsd || guardrail.maxVariableCostUsd <= 0) {
    return 'requires_cheaper_path';
  }
  const overrunMultiple =
    guardrail.monthlyVariableCostUsd / guardrail.maxVariableCostUsd;
  if (overrunMultiple >= 3) return 'requires_cheaper_path';
  if (largestComponent?.name === 'paymentFees') return 'requires_cheaper_path';
  return 'block_or_degrade';
};

const evaluateFlowBudget = ({
  tier = 'free',
  monthlyNetRevenueUsd = 0,
  usage = {},
} = {}) => {
  const cost = estimateMonthlyVariableCost(usage);
  const guardrail = evaluateUnitEconomics({
    tier,
    monthlyNetRevenueUsd,
    monthlyVariableCostUsd: cost.totalUsd,
  });
  const largestComponent = Object.entries(cost.components).sort(
    (a, b) => b[1] - a[1],
  )[0] || ['none', 0];
  const largest = {
    name: largestComponent[0],
    monthlyCostUsd: largestComponent[1],
  };
  const decision = decisionForGuardrail({
    guardrail,
    largestComponent: largest,
  });

  return {
    cost,
    guardrail,
    largestComponent: largest,
    recommendedActions:
      decision === 'allow' ? [] : recommendedActionsFor(largest.name),
    decision,
  };
};

module.exports = {
  assertWithinUnitEconomics,
  evaluateUnitEconomics,
  evaluateFlowBudget,
  estimateMonthlyVariableCost,
};
