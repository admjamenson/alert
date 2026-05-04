const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluateEconomicGate, withEconomicGate} = require('../EconomicGate');
const {
  __dangerousResetEconomicsTrackerForTests,
  __dangerousSetTrackerStoreFactoryForTests,
} = require('../UserCostTracker');

const resetEnv = env => {
  delete env.ALERT_ECONOMICS_GATE_ENABLED;
  delete env.ALERT_FREE_REVENUE_USD_MONTHLY;
  delete env.ALERT_PREMIUM_REVENUE_USD_MONTHLY;
  delete env.ALERT_FREE_MAX_COST_RATIO;
  delete env.ALERT_PREMIUM_MAX_COST_RATIO;
};

test.beforeEach(() => {
  __dangerousResetEconomicsTrackerForTests();
  resetEnv(process.env);
});

test('gate allows below budget for free tier', async () => {
  process.env.ALERT_ECONOMICS_GATE_ENABLED = 'true';
  const decision = await evaluateEconomicGate({
    userKey: 'user-free',
    tier: 'free',
    operation: 'RISK_PROVIDER',
    estimatedCostUsd: 0.1,
    regionKey: 'global',
    criticality: 'standard',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.degraded, false);
  assert.equal(decision.reason, 'within_budget');
});

test('gate degrades when estimated cost exceeds budget', async () => {
  process.env.ALERT_ECONOMICS_GATE_ENABLED = 'true';
  const decision = await evaluateEconomicGate({
    userKey: 'user-free-2',
    tier: 'free',
    operation: 'RISK_PROVIDER',
    estimatedCostUsd: 1.0,
    regionKey: 'global',
    criticality: 'standard',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.degraded, true);
  assert.equal(decision.reason, 'budget_exceeded');
});

test('life_safety does not block completely when budget exceeded', async () => {
  process.env.ALERT_ECONOMICS_GATE_ENABLED = 'true';
  const result = await withEconomicGate(
    {
      userKey: 'user-life-safety',
      tier: 'free',
      operation: 'RISK_PROVIDER',
      estimatedCostUsd: 1.0,
      actualCostUsd: 1.0,
      fallbackCostUsd: 0.000001,
      regionKey: 'global',
      criticality: 'life_safety',
    },
    async () => {
      throw new Error('should not be called');
    },
    decision => ({
      preserved: true,
      economics: decision,
    }),
  );

  assert.equal(result.preserved, true);
  assert.equal(result.economics.degraded, true);
  assert.equal(result.economics.allowed, false);
  assert.equal(result.economics.reason, 'life_safety_budget_exceeded');
});
