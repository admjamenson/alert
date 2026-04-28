const loadBullMq = () => {
  try {
    return require('bullmq');
  } catch (error) {
    const wrapped = new Error('bullmq_dependency_missing');
    wrapped.cause = error;
    throw wrapped;
  }
};

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const createBullMqJobQueue = ({
  name = 'default',
  queueName = name,
  connection,
  concurrency = 5,
  maxAttempts = 3,
  baseBackoffMs = 250,
  handler,
  queue,
  QueueCtor,
  WorkerCtor,
  logger = console,
} = {}) => {
  const bullmq = !queue && (!QueueCtor || (handler && !WorkerCtor)) ? loadBullMq() : null;
  const Queue = QueueCtor || bullmq?.Queue;
  const Worker = WorkerCtor || bullmq?.Worker;
  const queueClient =
    queue ||
    new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: Math.max(1, maxAttempts),
        backoff: {
          type: 'exponential',
          delay: Math.max(1, baseBackoffMs),
        },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  const metrics = {
    name,
    queueName,
    driver: 'bullmq',
    enqueued: 0,
    deduped: 0,
    errors: 0,
    workerErrors: 0,
  };

  const attachErrorListener = (target, label) => {
    if (!target || typeof target.on !== 'function') return;
    target.on('error', error => {
      metrics.errors += 1;
      if (label === 'worker') metrics.workerErrors += 1;
      if (logger && typeof logger.error === 'function') {
        logger.error(`[queue/${queueName}] BullMQ ${label} error`, {
          error: error?.message || String(error),
        });
      }
    });
  };

  const worker =
    typeof handler === 'function' && Worker
      ? new Worker(
          queueName,
          async job =>
            handler(job.data, {
              id: job.id,
              attempt: Number(job.attemptsMade || 0),
              enqueuedAt: job.timestamp
                ? new Date(job.timestamp).toISOString()
                : undefined,
            }),
          { connection, concurrency: Math.max(1, concurrency) },
        )
      : null;

  attachErrorListener(queueClient, 'queue');
  attachErrorListener(worker, 'worker');

  const enqueue = async (id, payload = {}) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new Error('job_id_required');
    }

    try {
      if (typeof queueClient.getJob === 'function') {
        const existing = await queueClient.getJob(normalizedId);
        if (existing) {
          metrics.deduped += 1;
          return { accepted: false, deduped: true, id: normalizedId };
        }
      }

      await queueClient.add(name, payload, { jobId: normalizedId });
      metrics.enqueued += 1;
      return { accepted: true, deduped: false, id: normalizedId };
    } catch (error) {
      metrics.errors += 1;
      throw error;
    }
  };

  const snapshot = async () => {
    const counts =
      typeof queueClient.getJobCounts === 'function'
        ? await queueClient.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          )
        : {};
    return {
      ...metrics,
      external: true,
      counts,
    };
  };

  const waitForResult = async (
    id,
    {
      timeoutMs = 5000,
      pollIntervalMs = 100,
    } = {},
  ) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new Error('job_id_required');
    }

    const deadlineMs = Date.now() + Math.max(250, Number(timeoutMs || 5000));
    const boundedPollIntervalMs = Math.max(25, Number(pollIntervalMs || 100));

    while (Date.now() < deadlineMs) {
      if (typeof queueClient.getJob !== 'function') {
        return null;
      }

      const job = await queueClient.getJob(normalizedId);
      if (job) {
        const state =
          typeof job.getState === 'function'
            ? await job.getState()
            : String(job.state || '');
        if (state === 'completed' || state === 'failed') {
          return {
            id: String(job.id || normalizedId),
            state,
            result: job.returnvalue ?? null,
            failedReason: job.failedReason || null,
            attemptsMade: Number(job.attemptsMade || 0),
            finishedOn: Number.isFinite(Number(job.finishedOn))
              ? new Date(Number(job.finishedOn)).toISOString()
              : null,
          };
        }
      }

      await sleep(boundedPollIntervalMs);
    }

    return null;
  };

  const close = async () => {
    if (worker && typeof worker.close === 'function') {
      await worker.close();
    }
    if (typeof queueClient.close === 'function') {
      await queueClient.close();
    }
  };

  return {
    enqueue,
    snapshot,
    waitForResult,
    close,
  };
};

module.exports = {
  createBullMqJobQueue,
};
