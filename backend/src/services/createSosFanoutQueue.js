const { createJobQueue } = require('../scale/createJobQueue');
const {
  createRedisConnectionFromUrl,
  createSosFanoutHandler,
} = require('./SosFanoutDispatcher');

const readPositiveIntEnv = (env, name, fallback) => {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
};

const readBooleanEnv = (env, name, fallback) => {
  const value = String(env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
};

const readQueueRedisConfig = env => {
  if (env.ALERT_QUEUE_REDIS_URL) {
    return {
      url: String(env.ALERT_QUEUE_REDIS_URL).trim(),
      source: 'ALERT_QUEUE_REDIS_URL',
    };
  }
  if (env.ALERT_REDIS_URL) {
    return {
      url: String(env.ALERT_REDIS_URL).trim(),
      source: 'ALERT_REDIS_URL',
    };
  }
  return { url: '', source: null };
};

const readQueueRedisUrl = env => readQueueRedisConfig(env).url;

const createExternalSosFanoutQueue = ({
  env = process.env,
  sendMulticast,
  logger = console,
  createQueue = createJobQueue,
} = {}) => {
  if (env.ALERT_SOS_FANOUT_QUEUE_ENABLED === 'false') {
    logger.log?.('[sos/fanout] external queue disabled by ALERT_SOS_FANOUT_QUEUE_ENABLED=false');
    return { queue: null, enabled: false, driver: 'disabled', reason: 'disabled_by_env' };
  }

  const driver = String(env.ALERT_JOB_QUEUE_DRIVER || 'memory')
    .trim()
    .toLowerCase();

  if (driver !== 'bullmq') {
    logger.log?.('[sos/fanout] using inline fan-out; set ALERT_JOB_QUEUE_DRIVER=bullmq to enable BullMQ');
    return { queue: null, enabled: false, driver, reason: 'driver_not_bullmq' };
  }

  const redisConfig = readQueueRedisConfig(env);
  const redisUrl = redisConfig.url;
  if (!redisUrl) {
    const message =
      '[sos/fanout] BullMQ requested but ALERT_QUEUE_REDIS_URL/ALERT_REDIS_URL is not configured; using inline fan-out';
    if (env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true') {
      throw new Error('sos_fanout_redis_url_required');
    }
    logger.warn?.(message);
    return { queue: null, enabled: false, driver, reason: 'redis_url_missing' };
  }

  const workerEnabled = readBooleanEnv(env, 'ALERT_SOS_FANOUT_WORKER_ENABLED', true);
  const queueName = env.ALERT_SOS_FANOUT_QUEUE_NAME || 'alert-sos-fanout';
  const queue = createQueue({
    name: 'sos-fanout',
    queueName,
    driver: 'bullmq',
    connection: createRedisConnectionFromUrl(redisUrl, {
      connectTimeoutMs: env.ALERT_REDIS_CONNECT_TIMEOUT_MS,
    }),
    concurrency: readPositiveIntEnv(env, 'ALERT_SOS_FANOUT_CONCURRENCY', 8),
    maxAttempts: readPositiveIntEnv(env, 'ALERT_SOS_FANOUT_ATTEMPTS', 3),
    baseBackoffMs: readPositiveIntEnv(env, 'ALERT_SOS_FANOUT_BACKOFF_MS', 500),
    handler: workerEnabled
      ? createSosFanoutHandler({
          sendMulticast,
        })
      : undefined,
    logger,
  });

  logger.log?.(
    workerEnabled
      ? `[sos/fanout] BullMQ external queue enabled with in-process worker (${redisConfig.source})`
      : `[sos/fanout] BullMQ external queue enabled in enqueue-only mode (${redisConfig.source})`,
  );
  return {
    queue,
    enabled: true,
    driver: 'bullmq',
    reason: null,
    queueName,
    workerEnabled,
    redisUrlSource: redisConfig.source,
  };
};

module.exports = {
  createExternalSosFanoutQueue,
  readBooleanEnv,
  readPositiveIntEnv,
  readQueueRedisConfig,
  readQueueRedisUrl,
};
