const DEFAULT_MAX_ATTEMPTS = 3;

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const createInMemoryJobQueue = ({
  name = 'default',
  concurrency = 2,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseBackoffMs = 50,
  handler,
} = {}) => {
  if (typeof handler !== 'function') {
    throw new Error('job_queue_handler_required');
  }

  const pending = [];
  const knownIds = new Set();
  const completedIds = new Set();
  const deadLetters = [];
  const metrics = {
    name,
    enqueued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    deduped: 0,
    deadLettered: 0,
    active: 0,
  };

  let active = 0;
  let closed = false;

  const snapshot = () => ({
    ...metrics,
    pending: pending.length,
    knownIds: knownIds.size,
    completedIds: completedIds.size,
    deadLetters: deadLetters.length,
  });

  const pump = () => {
    if (closed) return;
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift();
      active += 1;
      metrics.active = active;
      metrics.started += 1;
      void (async () => {
        try {
          await handler(job.payload, job);
          metrics.completed += 1;
          completedIds.add(job.id);
        } catch (error) {
          metrics.failed += 1;
          job.attempt += 1;
          job.lastError = String(error?.message || error || 'job_failed');
          if (job.attempt < maxAttempts) {
            const backoff = Math.max(0, baseBackoffMs) * Math.pow(2, job.attempt - 1);
            await sleep(backoff);
            pending.push(job);
          } else {
            metrics.deadLettered += 1;
            deadLetters.push({
              id: job.id,
              payload: job.payload,
              attempts: job.attempt,
              lastError: job.lastError,
            });
          }
        } finally {
          active -= 1;
          metrics.active = active;
          setImmediate(pump);
        }
      })();
    }
  };

  const enqueue = (id, payload = {}) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new Error('job_id_required');
    }
    if (knownIds.has(normalizedId) || completedIds.has(normalizedId)) {
      metrics.deduped += 1;
      return { accepted: false, deduped: true, id: normalizedId };
    }
    const job = {
      id: normalizedId,
      payload,
      attempt: 0,
      enqueuedAt: new Date().toISOString(),
    };
    knownIds.add(normalizedId);
    pending.push(job);
    metrics.enqueued += 1;
    setImmediate(pump);
    return { accepted: true, deduped: false, id: normalizedId };
  };

  return {
    enqueue,
    snapshot,
    deadLetters: () => deadLetters.slice(),
    close: () => {
      closed = true;
    },
  };
};

module.exports = {
  createInMemoryJobQueue,
};

