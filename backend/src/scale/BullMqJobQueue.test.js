const test = require('node:test');
const assert = require('node:assert/strict');
const { createBullMqJobQueue } = require('./BullMqJobQueue');
const { createJobQueue } = require('./createJobQueue');

test('BullMQ adapter dedupes by jobId and exposes external queue metrics', async () => {
  const jobs = new Map();
  const calls = [];
  const fakeQueue = {
    async getJob(id) {
      return jobs.get(id) || null;
    },
    async add(name, payload, options) {
      calls.push(['add', name, payload, options]);
      jobs.set(options.jobId, { id: options.jobId, payload });
    },
    async getJobCounts(...states) {
      calls.push(['counts', states]);
      return { waiting: jobs.size, active: 0, completed: 0, failed: 0, delayed: 0 };
    },
    async close() {
      calls.push(['close']);
    },
  };

  const queue = createBullMqJobQueue({
    name: 'push-fanout',
    queueName: 'alert-push-fanout',
    queue: fakeQueue,
  });

  assert.deepEqual(await queue.enqueue('sos-1', { userId: 'u1' }), {
    accepted: true,
    deduped: false,
    id: 'sos-1',
  });
  assert.deepEqual(await queue.enqueue('sos-1', { userId: 'u1' }), {
    accepted: false,
    deduped: true,
    id: 'sos-1',
  });

  const snapshot = await queue.snapshot();
  assert.equal(snapshot.external, true);
  assert.equal(snapshot.driver, 'bullmq');
  assert.equal(snapshot.enqueued, 1);
  assert.equal(snapshot.deduped, 1);
  await queue.close();
  assert.deepEqual(calls[0], [
    'add',
    'push-fanout',
    { userId: 'u1' },
    { jobId: 'sos-1' },
  ]);
});

test('job queue factory selects BullMQ when ALERT_JOB_QUEUE_DRIVER=bullmq', async t => {
  const originalDriver = process.env.ALERT_JOB_QUEUE_DRIVER;
  process.env.ALERT_JOB_QUEUE_DRIVER = 'bullmq';
  t.after(() => {
    if (originalDriver === undefined) {
      delete process.env.ALERT_JOB_QUEUE_DRIVER;
    } else {
      process.env.ALERT_JOB_QUEUE_DRIVER = originalDriver;
    }
  });

  const jobs = new Map();
  const fakeQueue = {
    async getJob(id) {
      return jobs.get(id) || null;
    },
    async add(name, payload, options) {
      jobs.set(options.jobId, { name, payload });
    },
    async getJobCounts() {
      return { waiting: jobs.size, active: 0, completed: 0, failed: 0, delayed: 0 };
    },
    async close() {},
  };

  const queue = createJobQueue({
    name: 'sos-fanout',
    queueName: 'alert-sos-fanout',
    queue: fakeQueue,
  });

  const result = await queue.enqueue('sos-render-1', { flow: 'sos-fanout' });
  assert.equal(result.accepted, true);
  assert.equal((await queue.snapshot()).driver, 'bullmq');
});
