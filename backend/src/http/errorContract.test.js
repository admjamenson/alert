const test = require('node:test');
const assert = require('node:assert/strict');
const { buildErrorPayload } = require('./errorContract');

test('buildErrorPayload emits stable fail-soft metadata', () => {
  const payload = buildErrorPayload({
    code: 'risk_feed_internal',
    retryable: true,
    data: {
      alerts: [],
      providers: [],
    },
    meta: {
      hubAvailable: false,
    },
  });

  assert.equal(payload.error, 'risk_feed_internal');
  assert.equal(payload.meta.failClosed, true);
  assert.equal(payload.meta.retryable, true);
  assert.equal(payload.meta.hubAvailable, false);
  assert.ok(payload.meta.generatedAt);
  assert.deepEqual(payload.alerts, []);
  assert.deepEqual(payload.providers, []);
});
