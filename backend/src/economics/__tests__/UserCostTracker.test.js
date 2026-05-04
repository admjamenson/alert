const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addUserMonthlyCost,
  getUserMonthlyCost,
  getEconomicsMetrics,
  getEconomicsTrackerHealth,
  __dangerousResetEconomicsTrackerForTests,
  __dangerousSetTrackerStoreFactoryForTests,
  sanitizeUserKey,
} = require('../UserCostTracker');

const resetEnv = env => {
  delete env.APP_ENV;
  delete env.ALERT_REDIS_URL;
  delete env.ALERT_CACHE_REDIS_URL;
};

test.beforeEach(() => {
  __dangerousResetEconomicsTrackerForTests();
  resetEnv(process.env);
});

test('user tracker does not expose raw PII via stored buckets', async () => {
  const userKey = 'user@example.com';
  await addUserMonthlyCost(userKey, 0.25, {
    operation: 'TEST_OP',
    tier: 'free',
  });
  const bucket = await getUserMonthlyCost(userKey);
  assert.equal(bucket.subjectKey, sanitizeUserKey(userKey));
  const serialized = JSON.stringify(bucket);
  assert.equal(serialized.includes(userKey), false);
  assert.equal(bucket.totalCostUsd, 0.25);
});

test('memory fallback works when Redis store factory fails', async () => {
  process.env.APP_ENV = 'production';
  process.env.ALERT_REDIS_URL = 'redis://localhost:6379';

  __dangerousSetTrackerStoreFactoryForTests(() => {
    throw new Error('redis unavailable');
  });

  await addUserMonthlyCost('fallback-user', 0.15, {
    operation: 'TEST_OP',
    tier: 'free',
  });

  const bucket = await getUserMonthlyCost('fallback-user');
  assert.equal(bucket.totalCostUsd, 0.15);
  const health = getEconomicsTrackerHealth();
  assert.equal(health.memoryFallback, true);
  assert.equal(health.redisAvailable, false);
});

test('economics metrics increment after tracked cost operations', async () => {
  await addUserMonthlyCost('metrics-user', 0.05, {
    operation: 'TEST_OP',
    tier: 'free',
  });
  const metrics = await getEconomicsMetrics();
  assert.equal(metrics.totalTrackedCostUsd, 0.05);
  assert.equal(metrics.trackedUsers, 1);
});
