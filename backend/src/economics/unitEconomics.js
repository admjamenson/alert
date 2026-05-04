const DEFAULT_FREEMIUM_COST_RATIO_CAP = 0.2;
const DEFAULT_PREMIUM_COST_RATIO_CAP = 0.3;

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampRatio = value => Math.max(0, Math.min(1, numberOr(value, 0)));
const nonNegative = value => Math.max(0, numberOr(value, 0));

const firstFinite = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const ratioCapForTier = tier =>
  tier === 'premium'
    ? DEFAULT_PREMIUM_COST_RATIO_CAP
    : DEFAULT_FREEMIUM_COST_RATIO_CAP;

const evaluatePerUserCostPolicy = ({
  tier = 'free',
  revenueAmount = null,
  totalCostAmount = null,
  targetCostCapPercent,
} = {}) => {
  const normalizedTier = tier === 'premium' ? 'premium' : 'free';
  const revenue = Number(revenueAmount);
  const totalCost = Number(totalCostAmount);
  const capRatio = Number.isFinite(Number(targetCostCapPercent))
    ? clampRatio(targetCostCapPercent)
    : ratioCapForTier(normalizedTier);

  if (!Number.isFinite(revenue) || revenue <= 0) {
    return {
      tier: normalizedTier,
      targetCostCapPercent: capRatio,
      actualCostRatio: null,
      maxCostAmount: null,
      remainingBudgetAmount: null,
      overBudgetAmount: null,
      withinGuardrail: false,
      decision: 'insufficient_data',
      requiresCheaperPath: false,
      blockOrDegrade: false,
    };
  }

  if (!Number.isFinite(totalCost) || totalCost < 0) {
    return {
      tier: normalizedTier,
      targetCostCapPercent: capRatio,
      actualCostRatio: null,
      maxCostAmount: revenue * capRatio,
      remainingBudgetAmount: null,
      overBudgetAmount: null,
      withinGuardrail: false,
      decision: 'insufficient_data',
      requiresCheaperPath: false,
      blockOrDegrade: false,
    };
  }

  const actualCostRatio = totalCost / revenue;
  const maxCostAmount = revenue * capRatio;
  const remainingBudgetAmount = maxCostAmount - totalCost;
  const overBudgetAmount = Math.max(0, -remainingBudgetAmount);
  const withinGuardrail = totalCost <= maxCostAmount;
  const requiresCheaperPath =
    !withinGuardrail &&
    (maxCostAmount <= 0 || actualCostRatio >= capRatio * 3);
  const blockOrDegrade = !withinGuardrail && !requiresCheaperPath;

  return {
    tier: normalizedTier,
    targetCostCapPercent: capRatio,
    actualCostRatio,
    maxCostAmount,
    remainingBudgetAmount,
    overBudgetAmount,
    withinGuardrail,
    decision: withinGuardrail
      ? 'allow'
      : requiresCheaperPath
        ? 'requires_cheaper_path'
        : 'block_or_degrade',
    requiresCheaperPath,
    blockOrDegrade,
  };
};

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
  costAllocationUsers = 1,
  queueRedisMonthlyUsd = 0,
  cacheRedisMonthlyUsd = 0,
  workerComputeMonthlyUsd = 0,
  feedRefreshesPerDay = 0,
  providerMissRate = 0.08,
  feedServingCostUsd = 0.000002,
  providerMissCostUsd = 0.0012,
  weatherRefreshesPerDay = 0,
  weatherProviderMissRate = providerMissRate,
  weatherMissCostUsd,
  weatherProviderMissCostUsd = 0.0009,
  mapSessionsPerMonth = 0,
  mapSessionCostUsd = 0.00003,
  routingRequestsPerMonth = 0,
  routeRequestsPerMonth,
  routingCostUsd = 0.00004,
  sosPerMonth = 0,
  sosRelayCostUsd = 0.0002,
  pushPerMonth = 0,
  pushFanoutCostUsd,
  pushCostUsd = 0.00001,
  queueJobsPerMonth = 0,
  queueJobCostUsd = 0.000002,
  cacheOperationsPerMonth = 0,
  cacheOperationCostUsd = 0.0000002,
  telemetryEventsPerMonth = 50,
  telemetryCostUsd = 0.000001,
  storageMbMonth = 0,
  storageGbMonth,
  storageCostUsd,
  storageGbMonthCostUsd = 0.026,
  backendRequestsPerMonth = 0,
  webRequestsPerMonth,
  webServingCostUsd,
  backendRequestCostUsd = 0.000004,
  backgroundWorkerExecutionsPerMonth,
  backgroundWorkerExecutionCostUsd = 0.000003,
  paymentTransactionsPerMonth = 0,
  paymentGrossRevenueUsd = 0,
  paymentProcessorPercent = 0.029,
  paymentProcessorFixedFeeUsd,
  paymentProcessorFixedUsd = 0.3,
  appStoreFeePercent = 0.15,
  playStoreFeePercent = 0.15,
  storeFeePercent,
}) => {
  const allocationUsers = Math.max(1, nonNegative(costAllocationUsers));
  const queueRedis = nonNegative(queueRedisMonthlyUsd) / allocationUsers;
  const cacheRedis = nonNegative(cacheRedisMonthlyUsd) / allocationUsers;
  const workerCompute = nonNegative(workerComputeMonthlyUsd) / allocationUsers;
  const monthlyFeedRefreshes = Math.max(0, numberOr(feedRefreshesPerDay, 0)) * 30;
  const monthlyWeatherRefreshes =
    Math.max(0, numberOr(weatherRefreshesPerDay, 0)) * 30;
  const weatherMissUnitCost = nonNegative(
    firstFinite(weatherMissCostUsd, weatherProviderMissCostUsd, 0.0009),
  );
  const pushFanoutUnitCost = nonNegative(
    firstFinite(pushFanoutCostUsd, pushCostUsd, 0.00001),
  );
  const storageUnitCost = nonNegative(
    firstFinite(storageCostUsd, storageGbMonthCostUsd, 0.026),
  );
  const webServingUnitCost = nonNegative(
    firstFinite(webServingCostUsd, backendRequestCostUsd, 0.000004),
  );
  const paymentFixedFee = nonNegative(
    firstFinite(paymentProcessorFixedFeeUsd, paymentProcessorFixedUsd, 0.3),
  );
  const effectiveStoreFeePercent = clampRatio(
    firstFinite(storeFeePercent, Math.max(nonNegative(appStoreFeePercent), nonNegative(playStoreFeePercent))),
  );
  const monthlyRoutingRequests = nonNegative(
    firstFinite(routingRequestsPerMonth, routeRequestsPerMonth, 0),
  );
  const monthlyStorageGb = nonNegative(
    firstFinite(storageGbMonth, storageMbMonth / 1024, 0),
  );
  const monthlyWebRequests = nonNegative(
    firstFinite(webRequestsPerMonth, backendRequestsPerMonth, 0),
  );
  const workerExecutions = nonNegative(
    firstFinite(backgroundWorkerExecutionsPerMonth, queueJobsPerMonth, 0),
  );
  const feedServing = monthlyFeedRefreshes * nonNegative(feedServingCostUsd);
  const providerMisses =
    monthlyFeedRefreshes *
    clampRatio(providerMissRate) *
    nonNegative(providerMissCostUsd);
  const weatherProviderMisses =
    monthlyWeatherRefreshes *
    clampRatio(weatherProviderMissRate) *
    weatherMissUnitCost;
  const maps = nonNegative(mapSessionsPerMonth) * nonNegative(mapSessionCostUsd);
  const routing = monthlyRoutingRequests * nonNegative(routingCostUsd);
  const sosRelay = nonNegative(sosPerMonth) * nonNegative(sosRelayCostUsd);
  const pushFanout = nonNegative(pushPerMonth) * pushFanoutUnitCost;
  const queueJobs =
    nonNegative(queueJobsPerMonth) * nonNegative(queueJobCostUsd);
  const cache =
    nonNegative(cacheOperationsPerMonth) *
    nonNegative(cacheOperationCostUsd);
  const telemetry =
    nonNegative(telemetryEventsPerMonth) * nonNegative(telemetryCostUsd);
  const storage = monthlyStorageGb * storageUnitCost;
  const webServing = monthlyWebRequests * webServingUnitCost;
  const backgroundWorkerExecution =
    workerExecutions * nonNegative(backgroundWorkerExecutionCostUsd);
  const paymentFees =
    nonNegative(paymentGrossRevenueUsd) *
      (clampRatio(paymentProcessorPercent) + effectiveStoreFeePercent) +
    nonNegative(paymentTransactionsPerMonth) * paymentFixedFee;

  return {
    totalUsd:
      queueRedis +
      cacheRedis +
      workerCompute +
      feedServing +
      providerMisses +
      weatherProviderMisses +
      maps +
      routing +
      sosRelay +
      pushFanout +
      queueJobs +
      cache +
      telemetry +
      storage +
      webServing +
      backgroundWorkerExecution +
      paymentFees,
    components: {
      queueRedis,
      cacheRedis,
      workerCompute,
      feedServing,
      providerMisses,
      weatherProviderMisses,
      maps,
      routing,
      sosRelay,
      pushFanout,
      queueJobs,
      cache,
      telemetry,
      storage,
      webServing,
      backgroundWorkerExecution,
      paymentFees,
    },
    assumptions: {
      costAllocationUsers: allocationUsers,
      queueRedisMonthlyUsd,
      cacheRedisMonthlyUsd,
      workerComputeMonthlyUsd,
      providerMissRate,
      feedServingCostUsd,
      providerMissCostUsd,
      weatherProviderMissRate,
      weatherMissCostUsd: weatherMissUnitCost,
      mapSessionCostUsd,
      routingCostUsd,
      sosRelayCostUsd,
      pushFanoutCostUsd: pushFanoutUnitCost,
      queueJobCostUsd,
      cacheOperationCostUsd,
      telemetryCostUsd,
      storageCostUsd: storageUnitCost,
      webServingCostUsd: webServingUnitCost,
      backgroundWorkerExecutionCostUsd,
      paymentProcessorPercent,
      paymentProcessorFixedFeeUsd: paymentFixedFee,
      appStoreFeePercent,
      playStoreFeePercent,
      effectiveStoreFeePercent,
    },
  };
};

const allocateMonthlyCostPerUnit = ({
  totalMonthlyUsd = null,
  units = 0,
} = {}) => {
  const total = Number(totalMonthlyUsd);
  const normalizedUnits = Math.max(0, Number(units));

  if (!Number.isFinite(total) || total < 0) return null;
  if (!Number.isFinite(normalizedUnits) || normalizedUnits <= 0) return null;

  return total / normalizedUnits;
};

const allocateMonthlyInfrastructureCostPerUser = ({
  totalMonthlyInfrastructureUsd = null,
  activeUsers = 0,
} = {}) => {
  return allocateMonthlyCostPerUnit({
    totalMonthlyUsd: totalMonthlyInfrastructureUsd,
    units: activeUsers,
  });
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
  if (largestComponentName === 'routing') {
    return ['cache_harder', 'materialize', 'cheaper_provider', 'reduce_frequency', ...common];
  }
  if (
    largestComponentName === 'queueJobs' ||
    largestComponentName === 'queueRedis' ||
    largestComponentName === 'workerCompute' ||
    largestComponentName === 'backgroundWorkerExecution'
  ) {
    return ['queue_only_for_critical_path', 'reduce_noncritical_jobs', 'batch_jobs', ...common];
  }
  if (largestComponentName === 'paymentFees') {
    return [
      'verify_net_revenue_inputs',
      'prefer_lower_fee_route_where_policy_allows',
      ...common,
    ];
  }
  if (largestComponentName === 'webServing' || largestComponentName === 'cache' || largestComponentName === 'cacheRedis') {
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
  allocateMonthlyCostPerUnit,
  allocateMonthlyInfrastructureCostPerUser,
  assertWithinUnitEconomics,
  evaluatePerUserCostPolicy,
  evaluateUnitEconomics,
  evaluateFlowBudget,
  estimateMonthlyVariableCost,
};
