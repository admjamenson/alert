const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateMonthlyCostPerUnit,
  assertWithinUnitEconomics,
  evaluatePerUserCostPolicy,
  evaluateUnitEconomics,
  evaluateFlowBudget,
  estimateMonthlyVariableCost,
} = require('./unitEconomics');

test('unit economics enforces freemium and premium guardrails', () => {
  const freeOk = evaluateUnitEconomics({
    tier: 'free',
    monthlyNetRevenueUsd: 0.6,
    monthlyVariableCostUsd: 0.1,
  });
  const freeBad = evaluateUnitEconomics({
    tier: 'free',
    monthlyNetRevenueUsd: 0.6,
    monthlyVariableCostUsd: 0.13,
  });
  const premiumOk = evaluateUnitEconomics({
    tier: 'premium',
    monthlyNetRevenueUsd: 5,
    monthlyVariableCostUsd: 1.5,
  });

  assert.equal(freeOk.withinGuardrail, true);
  assert.equal(freeBad.withinGuardrail, false);
  assert.equal(premiumOk.withinGuardrail, true);
  assert.equal(freeOk.capRatio, 0.2);
  assert.equal(premiumOk.capRatio, 0.3);
});

test('monthly variable cost exposes flow-level cost components', () => {
  const estimate = estimateMonthlyVariableCost({
    costAllocationUsers: 1000,
    queueRedisMonthlyUsd: 30,
    cacheRedisMonthlyUsd: 20,
    workerComputeMonthlyUsd: 15,
    feedRefreshesPerDay: 6,
    providerMissRate: 0.05,
    weatherRefreshesPerDay: 3,
    mapSessionsPerMonth: 12,
    routingRequestsPerMonth: 4,
    sosPerMonth: 0.05,
    pushPerMonth: 0.4,
    queueJobsPerMonth: 2,
    cacheOperationsPerMonth: 40,
    backendRequestsPerMonth: 45,
    backgroundWorkerExecutionsPerMonth: 2,
    paymentTransactionsPerMonth: 1,
    paymentGrossRevenueUsd: 5,
    storageMbMonth: 4,
  });

  assert.ok(estimate.totalUsd > 0);
  assert.ok(estimate.components.queueRedis > 0);
  assert.ok(estimate.components.cacheRedis > 0);
  assert.ok(estimate.components.workerCompute > 0);
  assert.ok(estimate.components.feedServing > 0);
  assert.ok(estimate.components.providerMisses > 0);
  assert.ok(estimate.components.weatherProviderMisses > 0);
  assert.ok(estimate.components.maps > 0);
  assert.ok(estimate.components.routing > 0);
  assert.ok(estimate.components.sosRelay > 0);
  assert.ok(estimate.components.pushFanout > 0);
  assert.ok(estimate.components.queueJobs > 0);
  assert.ok(estimate.components.cache > 0);
  assert.ok(estimate.components.webServing > 0);
  assert.ok(estimate.components.backgroundWorkerExecution > 0);
  assert.ok(estimate.components.paymentFees > 0);
  assert.ok(estimate.components.storage > 0);
});

test('flow budget returns allow/block decisions and throwing guardrails', () => {
  const allowed = evaluateFlowBudget({
    tier: 'free',
    monthlyNetRevenueUsd: 0.6,
    usage: {
      feedRefreshesPerDay: 5,
      providerMissRate: 0.04,
      weatherRefreshesPerDay: 2,
      mapSessionsPerMonth: 5,
    },
  });
  const blocked = evaluateFlowBudget({
    tier: 'free',
    monthlyNetRevenueUsd: 0.6,
    usage: {
      feedRefreshesPerDay: 16,
      providerMissRate: 0.35,
      weatherRefreshesPerDay: 12,
      weatherProviderMissRate: 0.35,
      mapSessionsPerMonth: 40,
      backendRequestsPerMonth: 900,
    },
  });

  assert.equal(allowed.decision, 'allow');
  assert.equal(blocked.decision, 'block_or_degrade');
  assert.throws(
    () =>
      assertWithinUnitEconomics({
        tier: 'premium',
        monthlyNetRevenueUsd: 5,
        monthlyVariableCostUsd: 2,
      }),
    /unit_economics_guardrail_violation/,
  );
});

test('flow budget marks economically suicidal paths as requiring a cheaper path', () => {
  const result = evaluateFlowBudget({
    tier: 'free',
    monthlyNetRevenueUsd: 0.6,
    usage: {
      feedRefreshesPerDay: 120,
      providerMissRate: 1,
      weatherRefreshesPerDay: 80,
      weatherProviderMissRate: 1,
      mapSessionsPerMonth: 1000,
      backendRequestsPerMonth: 9000,
    },
  });

  assert.equal(result.decision, 'requires_cheaper_path');
  assert.ok(result.recommendedActions.length > 0);
  assert.ok(result.guardrail.overBudgetUsd > 0);
});

test('monthly cost allocation can be converted into a per-unit operational cost', () => {
  const unitCost = allocateMonthlyCostPerUnit({
    totalMonthlyUsd: 7,
    units: 4,
  });

  assert.equal(unitCost, 1.75);
});

test('per-user cost policy emits explicit allow and block decisions for 20% and 30% caps', () => {
  const premiumAllowed = evaluatePerUserCostPolicy({
    tier: 'premium',
    revenueAmount: 10,
    totalCostAmount: 2.5,
  });
  const freeBlocked = evaluatePerUserCostPolicy({
    tier: 'free',
    revenueAmount: 1,
    totalCostAmount: 0.25,
  });
  const freeRequiresCheaperPath = evaluatePerUserCostPolicy({
    tier: 'free',
    revenueAmount: 1,
    totalCostAmount: 0.7,
  });

  assert.equal(premiumAllowed.targetCostCapPercent, 0.3);
  assert.equal(premiumAllowed.decision, 'allow');
  assert.equal(premiumAllowed.requiresCheaperPath, false);
  assert.equal(premiumAllowed.blockOrDegrade, false);
  assert.equal(freeBlocked.targetCostCapPercent, 0.2);
  assert.equal(freeBlocked.decision, 'block_or_degrade');
  assert.equal(freeBlocked.requiresCheaperPath, false);
  assert.equal(freeBlocked.blockOrDegrade, true);
  assert.equal(freeRequiresCheaperPath.decision, 'requires_cheaper_path');
  assert.equal(freeRequiresCheaperPath.requiresCheaperPath, true);
});
