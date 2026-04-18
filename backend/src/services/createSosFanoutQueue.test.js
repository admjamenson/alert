const test = require('node:test');
const assert = require('node:assert/strict');
const { createExternalSosFanoutQueue } = require('./createSosFanoutQueue');

const renderEnv = () => ({
  ALERT_REDIS_URL: 'redis://red-d7ht7nn7f7vs738qoko0:6379',
  ALERT_JOB_QUEUE_DRIVER: 'bullmq',
  ALERT_CACHE_DRIVER: 'redis',
  ALERT_REQUIRE_EXTERNAL_INFRA: 'true',
});

test('SOS queue bootstrap creates BullMQ queue with Render Redis connection', () => {
  let captured = null;
  const fakeQueue = { enqueue: async () => ({ accepted: true, id: 'job-1' }) };
  const result = createExternalSosFanoutQueue({
    env: renderEnv(),
    sendMulticast: async () => ({ successCount: 1, failureCount: 0 }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    createQueue: options => {
      captured = options;
      return fakeQueue;
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.driver, 'bullmq');
  assert.equal(result.queue, fakeQueue);
  assert.equal(captured.driver, 'bullmq');
  assert.equal(captured.queueName, 'alert-sos-fanout');
  assert.equal(captured.connection.host, 'red-d7ht7nn7f7vs738qoko0');
  assert.equal(captured.connection.port, 6379);
  assert.equal(captured.connection.maxRetriesPerRequest, null);
  assert.equal(typeof captured.handler, 'function');
});

test('SOS queue bootstrap fails fast when external infra is required without Redis URL', () => {
  assert.throws(
    () =>
      createExternalSosFanoutQueue({
        env: {
          ALERT_JOB_QUEUE_DRIVER: 'bullmq',
          ALERT_REQUIRE_EXTERNAL_INFRA: 'true',
        },
        sendMulticast: async () => ({}),
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      }),
    /sos_fanout_redis_url_required/,
  );
});

test('SOS queue bootstrap keeps inline mode when BullMQ is not configured', () => {
  const result = createExternalSosFanoutQueue({
    env: { ALERT_JOB_QUEUE_DRIVER: 'memory' },
    sendMulticast: async () => ({}),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.queue, null);
  assert.equal(result.reason, 'driver_not_bullmq');
});
