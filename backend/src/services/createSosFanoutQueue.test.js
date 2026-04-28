const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createExternalSosFanoutQueue,
  readQueueRedisUrl,
} = require('./createSosFanoutQueue');

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
  assert.equal(result.queueName, 'alert-sos-fanout');
  assert.equal(captured.driver, 'bullmq');
  assert.equal(captured.queueName, 'alert-sos-fanout');
  assert.equal(captured.connection.host, 'red-d7ht7nn7f7vs738qoko0');
  assert.equal(captured.connection.port, 6379);
  assert.equal(captured.connection.maxRetriesPerRequest, null);
  assert.equal(typeof captured.handler, 'function');
  assert.equal(result.workerEnabled, true);
  assert.equal(result.redisUrlSource, 'ALERT_REDIS_URL');
});

test('SOS queue bootstrap can run web service in enqueue-only mode', () => {
  let captured = null;
  const result = createExternalSosFanoutQueue({
    env: {
      ...renderEnv(),
      ALERT_SOS_FANOUT_WORKER_ENABLED: 'false',
    },
    sendMulticast: async () => ({ successCount: 1, failureCount: 0 }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    createQueue: options => {
      captured = options;
      return { enqueue: async () => ({ accepted: true, id: 'job-1' }) };
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.queueName, 'alert-sos-fanout');
  assert.equal(result.workerEnabled, false);
  assert.equal(captured.handler, undefined);
});

test('SOS queue bootstrap prefers ALERT_QUEUE_REDIS_URL over shared Redis URL', () => {
  assert.equal(
    readQueueRedisUrl({
      ALERT_REDIS_URL: 'redis://shared:6379',
      ALERT_QUEUE_REDIS_URL: 'redis://queue:6379',
    }),
    'redis://queue:6379',
  );
});

test('SOS queue bootstrap exposes dedicated queue Redis source for operations', () => {
  const result = createExternalSosFanoutQueue({
    env: {
      ...renderEnv(),
      ALERT_QUEUE_REDIS_URL: 'redis://queue:6379',
    },
    sendMulticast: async () => ({ successCount: 1, failureCount: 0 }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    createQueue: () => ({ enqueue: async () => ({ accepted: true, id: 'job-1' }) }),
  });

  assert.equal(result.redisUrlSource, 'ALERT_QUEUE_REDIS_URL');
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
