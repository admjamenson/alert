const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRequestMetricTracker,
  markRequestMetric,
  percentileFromSamples,
  summarizeRequestMetric,
} = require('./requestMetricTracker');

test('percentileFromSamples returns p95 from sorted numeric samples', () => {
  assert.equal(percentileFromSamples([100, 200, 300, 400, 500], 95), 500);
  assert.equal(percentileFromSamples([100, 200, 300, 400], 95), 400);
  assert.equal(percentileFromSamples([], 95), null);
});

test('request metric tracker summarizes rate, avg latency and success p95', () => {
  const tracker = createRequestMetricTracker({ maxSamples: 4 });

  markRequestMetric(tracker, true, 120);
  markRequestMetric(tracker, false, 250);
  markRequestMetric(tracker, true, 180);
  markRequestMetric(tracker, true, 360);
  markRequestMetric(tracker, true, 420);

  const summary = summarizeRequestMetric(tracker);
  assert.equal(summary.total, 5);
  assert.equal(summary.success, 4);
  assert.equal(summary.failed, 1);
  assert.equal(summary.successRate, 0.8);
  assert.equal(summary.errorRate, 0.2);
  assert.equal(summary.avgLatencyMs, 266);
  assert.equal(summary.p95LatencyMs, 420);
  assert.equal(summary.latencySampleCount, 4);
  assert.equal(summary.successLatencySampleCount, 4);
  assert.ok(summary.windowStartedAt);
  assert.ok(summary.lastUpdatedAt);
});
