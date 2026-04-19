const { createInMemoryJobQueue } = require('./InMemoryJobQueue');
const { createBullMqJobQueue } = require('./BullMqJobQueue');

const createJobQueue = (options = {}) => {
  const driver = String(
    options.driver || process.env.ALERT_JOB_QUEUE_DRIVER || 'memory',
  )
    .trim()
    .toLowerCase();

  if (driver === 'bullmq') {
    return createBullMqJobQueue(options);
  }

  if (driver !== 'memory') {
    throw new Error(`unsupported_job_queue_driver:${driver}`);
  }

  return createInMemoryJobQueue(options);
};

module.exports = {
  createJobQueue,
};
