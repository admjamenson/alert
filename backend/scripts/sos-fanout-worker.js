'use strict';

const admin = require('firebase-admin');
const { createFirebaseState } = require('../src/bootstrap/firebaseAdmin');
const { buildSosPushMessage } = require('../src/services/SosFanoutDispatcher');
const { createExternalSosFanoutQueue } = require('../src/services/createSosFanoutQueue');

const firebaseState = createFirebaseState({ admin });
if (!firebaseState.available) {
  console.error('[worker/sos-fanout] Firebase Admin unavailable', {
    reason: firebaseState.reason,
  });
  process.exit(1);
}

const sendSosFanoutPush = payload =>
  admin.messaging().sendEachForMulticast(buildSosPushMessage(payload));

const workerEnv = {
  ...process.env,
  ALERT_JOB_QUEUE_DRIVER: process.env.ALERT_JOB_QUEUE_DRIVER || 'bullmq',
  ALERT_REQUIRE_EXTERNAL_INFRA: process.env.ALERT_REQUIRE_EXTERNAL_INFRA || 'true',
  ALERT_SOS_FANOUT_WORKER_ENABLED: 'true',
};

const bootstrap = createExternalSosFanoutQueue({
  env: workerEnv,
  sendMulticast: sendSosFanoutPush,
  logger: console,
});

if (!bootstrap.enabled || !bootstrap.queue) {
  console.error('[worker/sos-fanout] BullMQ worker was not enabled', {
    driver: bootstrap.driver,
    reason: bootstrap.reason,
  });
  process.exit(1);
}

console.log('[worker/sos-fanout] started', {
  queueName: process.env.ALERT_SOS_FANOUT_QUEUE_NAME || 'alert-sos-fanout',
  workerEnabled: bootstrap.workerEnabled,
  redisUrlSource: bootstrap.redisUrlSource,
});

const shutdown = async signal => {
  console.log('[worker/sos-fanout] shutting down', { signal });
  await bootstrap.queue.close().catch(error => {
    console.error('[worker/sos-fanout] close failed', {
      error: error?.message || String(error),
    });
  });
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
