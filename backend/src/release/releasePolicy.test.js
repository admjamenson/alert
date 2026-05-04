'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildReleasePolicy } = require('./releasePolicy');

const baseEnv = {
  APP_ENV: 'staging',
  ALERT_RELEASE_VERSION: '2026.04.20-canary',
  ALERT_PREVIOUS_RELEASE_VERSION: '2026.04.19-stable',
  ALERT_CANARY_ENABLED: 'true',
};

const healthyMetrics = {
  appCrashFreeRate: 0.999,
  sosSuccessRate: 1,
  sosP95Ms: 420,
  criticalApiErrorRate: 0,
  criticalApiP95Ms: 180,
  providerErrorRate: 0,
  entitlementErrorRate: 0,
  freeCostPerUserUsd: 0.02,
  premiumCostPerUserUsd: 1.2,
};

test('canary advances only on a valid stage with complete healthy SLOs', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '5',
    },
    observedMetrics: healthyMetrics,
    identity: { userId: 'user-a' },
  });

  assert.equal(policy.canary.currentPercent, 5);
  assert.equal(policy.canary.validStage, true);
  assert.equal(policy.canary.canAdvance, true);
  assert.equal(policy.canary.nextPercent, 10);
  assert.equal(policy.rollback.recommended, false);
});

test('kill switch keeps SOS core and disables non-critical features', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '10',
      ALERT_GLOBAL_KILL_SWITCH: 'true',
      ALERT_FEATURE_DEFAULT_PERCENT: '100',
    },
    observedMetrics: healthyMetrics,
    identity: { userId: 'user-b' },
  });

  assert.equal(policy.killSwitch.active, true);
  assert.equal(policy.featureFlags.sos, true);
  assert.equal(policy.featureFlags.essentialLocation, true);
  assert.equal(policy.featureFlags.maps, false);
  assert.equal(policy.featureFlags.weather, false);
  assert.equal(policy.rollback.recommended, true);
  assert.equal(policy.incident.severity, 'SEV 1');
});

test('SLO violation halts rollout and recommends rollback', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '25',
    },
    observedMetrics: {
      ...healthyMetrics,
      sosSuccessRate: 0.8,
    },
    identity: { userId: 'user-c' },
  });

  assert.equal(policy.canary.canAdvance, false);
  assert.equal(policy.rollback.recommended, true);
  assert.ok(policy.rollback.reasons.includes('sos_success_rate_regression'));
  assert.equal(policy.incident.severity, 'SEV 1');
});

test('missing release metrics hold canary without pretending rollback proof', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '1',
    },
    observedMetrics: {},
    identity: { userId: 'user-d' },
  });

  assert.equal(policy.rollback.recommended, false);
  assert.equal(policy.canary.canAdvance, false);
  assert.equal(policy.slo.inputStatus, 'absent');
  assert.ok(policy.canary.holdReasons.includes('missing_required_release_metrics'));
  assert.ok(policy.slo.missingMetrics.includes('appCrashFreeRate'));
});

test('null release metrics remain missing instead of becoming fake zero regressions', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '1',
      ALERT_RELEASE_METRICS_JSON: JSON.stringify({
        appCrashFreeRate: null,
        sosSuccessRate: null,
        sosP95Ms: null,
        criticalApiErrorRate: null,
        criticalApiP95Ms: null,
        providerErrorRate: null,
        entitlementErrorRate: null,
      }),
    },
    observedMetrics: {},
    identity: { userId: 'user-null-metrics' },
  });

  assert.equal(policy.rollback.recommended, false);
  assert.equal(policy.canary.canAdvance, false);
  assert.equal(policy.slo.observed.appCrashFreeRate, undefined);
  assert.equal(policy.slo.inputStatus, 'absent');
  assert.ok(policy.canary.holdReasons.includes('missing_required_release_metrics'));
  assert.ok(policy.slo.missingMetrics.includes('appCrashFreeRate'));
  assert.equal(policy.slo.violations.length, 0);
});

test('partial release metrics are classified as partial and still hold rollout', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '1',
      ALERT_RELEASE_METRICS_JSON: JSON.stringify({
        appCrashFreeRate: 0.999,
        sosSuccessRate: 0.998,
      }),
    },
    observedMetrics: {},
    identity: { userId: 'user-partial-metrics' },
  });

  assert.equal(policy.rollback.recommended, false);
  assert.equal(policy.canary.canAdvance, false);
  assert.equal(policy.slo.inputStatus, 'partial');
  assert.deepEqual(policy.slo.presentMetrics, [
    'appCrashFreeRate',
    'sosSuccessRate',
  ]);
  assert.ok(policy.slo.missingMetrics.includes('providerErrorRate'));
  assert.equal(policy.slo.violations.length, 0);
});

test('cost overrun triggers containment actions', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '10',
    },
    observedMetrics: {
      ...healthyMetrics,
      freeCostPerUserUsd: 0.5,
    },
    identity: { userId: 'user-e' },
  });

  assert.equal(policy.rollback.recommended, true);
  assert.ok(policy.rollback.reasons.includes('freemium_unit_cost_regression'));
  assert.ok(policy.cost.actions.includes('cache_harder'));
});

test('strict operational pricebook blocks release promotion when required costs are missing', () => {
  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '10',
      ALERT_ECONOMICS_STRICT_PRICEBOOK: 'true',
      ALERT_ECONOMICS_PRICE_BOOK_JSON: JSON.stringify({
        costs: {
          providerMissCostUsd: { value: 0.12, origin: 'real' },
        },
      }),
    },
    observedMetrics: healthyMetrics,
    identity: { userId: 'user-f' },
  });

  assert.equal(policy.canary.canAdvance, false);
  assert.equal(policy.rollback.recommended, true);
  assert.ok(policy.rollback.reasons.includes('operational_pricebook_incomplete'));
  assert.equal(policy.cost.priceBook.strict.enabled, true);
  assert.equal(policy.cost.priceBook.strict.ok, false);
  assert.ok(
    policy.cost.actions.includes('block_release_promotion_until_pricebook_complete'),
  );
});

test('strict operational pricebook allows canary when the cost inputs are complete', () => {
  const requiredKeys = [
    'queueRedisMonthlyUsd',
    'cacheRedisMonthlyUsd',
    'workerComputeMonthlyUsd',
    'feedServingCostUsd',
    'providerMissCostUsd',
    'weatherMissCostUsd',
    'mapSessionCostUsd',
    'routingCostUsd',
    'sosRelayCostUsd',
    'pushFanoutCostUsd',
    'queueJobCostUsd',
    'cacheOperationCostUsd',
    'telemetryCostUsd',
    'storageCostUsd',
    'webServingCostUsd',
    'backgroundWorkerExecutionCostUsd',
    'paymentProcessorPercent',
    'paymentProcessorFixedFeeUsd',
    'appStoreFeePercent',
    'playStoreFeePercent',
  ];
  const costs = Object.fromEntries(
    requiredKeys.map((key, index) => [
      key,
      {
        value: index === 0 ? 0 : 0.001,
        origin: index % 2 === 0 ? 'real' : 'estimated_reliable',
      },
    ]),
  );

  const policy = buildReleasePolicy({
    env: {
      ...baseEnv,
      ALERT_CANARY_PERCENT: '10',
      ALERT_ECONOMICS_STRICT_PRICEBOOK: 'true',
      ALERT_ECONOMICS_PRICE_BOOK_JSON: JSON.stringify({ costs }),
    },
    observedMetrics: healthyMetrics,
    identity: { userId: 'user-g' },
  });

  assert.equal(policy.canary.canAdvance, true);
  assert.equal(policy.rollback.recommended, false);
  assert.equal(policy.cost.priceBook.strict.enabled, true);
  assert.equal(policy.cost.priceBook.strict.ok, true);
});
