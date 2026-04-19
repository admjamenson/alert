const test = require('node:test');
const assert = require('node:assert/strict');
const { createInMemoryJobQueue } = require('./InMemoryJobQueue');

const waitFor = async predicate => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('wait_timeout');
};

test('in-memory job queue dedupes and retries with dead-letter visibility', async () => {
  let attempts = 0;
  const queue = createInMemoryJobQueue({
    name: 'push-fanout',
    concurrency: 1,
    maxAttempts: 2,
    baseBackoffMs: 1,
    handler: async payload => {
      attempts += 1;
      if (payload.fail) {
        throw new Error('provider_down');
      }
    },
  });

  assert.deepEqual(queue.enqueue('job-1', { ok: true }), {
    accepted: true,
    deduped: false,
    id: 'job-1',
  });
  assert.deepEqual(queue.enqueue('job-1', { ok: true }), {
    accepted: false,
    deduped: true,
    id: 'job-1',
  });
  queue.enqueue('job-2', { fail: true });

  await waitFor(() => queue.snapshot().deadLettered === 1);

  const snapshot = queue.snapshot();
  assert.equal(snapshot.enqueued, 2);
  assert.equal(snapshot.deduped, 1);
  assert.equal(snapshot.completed, 1);
  assert.equal(snapshot.deadLettered, 1);
  assert.equal(queue.deadLetters()[0].id, 'job-2');
  assert.equal(attempts, 3);
  queue.close();
});

