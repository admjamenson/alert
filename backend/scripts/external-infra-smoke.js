'use strict';

const { execFileSync } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const { createCacheStore } = require('../src/platform/cache/createCacheStore');
const { createJobQueue } = require('../src/scale/createJobQueue');
const {
  buildSosDeliveryProofTokens,
  DELIVERY_PROOF_HANDLER_ID,
  createSosFanoutHandler,
} = require('../src/services/SosFanoutDispatcher');
const { createExternalSosFanoutQueue } = require('../src/services/createSosFanoutQueue');

const requireExternalInfra = process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true';
let sharedRedisUrl = process.env.ALERT_REDIS_URL || '';
let queueRedisUrl = process.env.ALERT_QUEUE_REDIS_URL || sharedRedisUrl;
let cacheRedisUrl = process.env.ALERT_CACHE_REDIS_URL || sharedRedisUrl;
const queueName = process.env.ALERT_QUEUE_NAME || 'alert-sos-fanout-smoke';
const sosFanoutQueueName =
  process.env.ALERT_SOS_FANOUT_QUEUE_NAME || 'alert-sos-fanout';
const sosFanoutProofBaseUrl = String(
  process.env.ALERT_SOS_FANOUT_PROOF_BASE_URL || process.env.ALERT_LOAD_BASE_URL || '',
).trim();

const checks = [];
let redisRoundtripPassed = false;
let redisConnectivityBlocked = false;

const addCheck = (id, status, message, data = undefined) => {
  const row = { id, status, message };
  if (data !== undefined) row.data = data;
  checks.push(row);
};

const requireOptional = moduleName => {
  try {
    require.resolve(moduleName);
    addCheck(`dependency:${moduleName}`, 'pass', `${moduleName} dependency is available`);
    return true;
  } catch (error) {
    addCheck(`dependency:${moduleName}`, 'blocked', `${moduleName} dependency is not installed`, {
      code: error.code,
    });
    return false;
  }
};

const probeTool = command => {
  try {
    const version = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    addCheck(`tool:${command}`, 'pass', `${command} is available`, { version });
    return true;
  } catch (error) {
    addCheck(`tool:${command}`, 'blocked', `${command} is not available on this host`, {
      code: error.code,
    });
    return false;
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const requestJson = (method, rawUrl, body = null) =>
  new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const transport = target.protocol === 'http:' ? http : https;
    const payload = body ? JSON.stringify(body) : '';
    const request = transport.request(
      target,
      {
        method,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          raw += chunk;
        });
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (_error) {
            parsed = null;
          }
          resolve({
            statusCode: Number(response.statusCode || 0),
            body: parsed,
            rawBody: raw,
          });
        });
      },
    );
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });

const resolveRedisSource = specificKey => {
  if (process.env[specificKey]) return specificKey;
  if (process.env.ALERT_REDIS_URL) return 'ALERT_REDIS_URL';
  return null;
};

const parseRedisHost = value => {
  try {
    return value ? new URL(value).hostname : '';
  } catch (_error) {
    return '';
  }
};

const isRenderPrivateRedisHost = host =>
  /^red-[a-z0-9-]+$/i.test(String(host || '')) && !process.env.RENDER;

const classifyRedisConnectivityBlock = (error, url) => {
  const host = parseRedisHost(url);
  const message = String(error?.message || error || '');
  const code = String(error?.code || '');
  const looksLikeNetwork =
    /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|getaddrinfo|timeout/i.test(
      `${code} ${message}`,
    );
  if (host && isRenderPrivateRedisHost(host) && looksLikeNetwork) {
    return {
      reason: 'render_private_redis_not_reachable_from_this_host',
      host,
      code: error?.code,
      message,
    };
  }
  return null;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label}_timeout_after_${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const ensureRedisUrls = ({ dockerAvailable }) => {
  if (queueRedisUrl) {
    addCheck(
      'env:queue-redis-url',
      'pass',
      'Queue Redis URL is configured',
      { source: resolveRedisSource('ALERT_QUEUE_REDIS_URL') },
    );
  } else {
    addCheck(
      'env:queue-redis-url',
      'blocked',
      'Queue Redis needs ALERT_QUEUE_REDIS_URL or ALERT_REDIS_URL',
    );
  }

  if (cacheRedisUrl) {
    addCheck(
      'env:cache-redis-url',
      'pass',
      'Cache Redis URL is configured',
      { source: resolveRedisSource('ALERT_CACHE_REDIS_URL') },
    );
  } else {
    addCheck(
      'env:cache-redis-url',
      'blocked',
      'Cache Redis needs ALERT_CACHE_REDIS_URL or ALERT_REDIS_URL',
    );
  }

  if (queueRedisUrl && cacheRedisUrl) {
    return;
  }

  if (!dockerAvailable) {
    return;
  }

  if (process.env.ALERT_SCALE_AUTOSTART_DOCKER === 'false') {
    addCheck(
      'docker:redis-autostart',
      'blocked',
      'Docker is available but ALERT_SCALE_AUTOSTART_DOCKER=false prevented Redis startup',
    );
    return;
  }

  const composePath = path.resolve(__dirname, '..', '..', 'docker-compose.scale.yml');
  try {
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d', 'redis'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    sharedRedisUrl = 'redis://127.0.0.1:6379';
    queueRedisUrl = queueRedisUrl || sharedRedisUrl;
    cacheRedisUrl = cacheRedisUrl || sharedRedisUrl;
    addCheck('docker:redis-autostart', 'pass', 'Redis was started with docker compose', {
      composePath,
      queueRedisUrl,
      cacheRedisUrl,
    });
  } catch (error) {
    addCheck('docker:redis-autostart', 'fail', 'Docker Redis startup failed', {
      message: error.message,
      stderr: error.stderr ? String(error.stderr).slice(0, 800) : undefined,
    });
  }
};

const smokeRedis = async () => {
  const redisDependencyAvailable = requireOptional('redis');
  if (!cacheRedisUrl) {
    return;
  }

  if (!redisDependencyAvailable) {
    return;
  }

  const cache = createCacheStore({
    name: 'external-smoke',
    driver: 'redis',
    url: cacheRedisUrl,
    prefix: 'alert:smoke',
    connectTimeoutMs: Number(process.env.ALERT_REDIS_CONNECT_TIMEOUT_MS || 1500),
    reconnectStrategy: false,
  });
  try {
    await withTimeout(
      cache.setJson('cache-ready', { ok: true, at: new Date().toISOString() }, 60_000),
      3500,
      'redis_set',
    );
    const cached = await withTimeout(cache.getJson('cache-ready'), 3500, 'redis_get');
    if (cached?.ok !== true) {
      addCheck('redis:roundtrip', 'fail', 'Redis cache roundtrip returned unexpected payload', {
        cached,
      });
      return;
    }
    redisRoundtripPassed = true;
    addCheck(
      'redis:roundtrip',
      'pass',
      'Cache Redis set/get roundtrip passed',
      cache.snapshot(),
    );

    await cache.setJson('ttl-ready', { ok: true }, 250);
    const beforeTtlExpiry = await cache.getJson('ttl-ready');
    await sleep(400);
    const afterTtlExpiry = await cache.getJson('ttl-ready');
    addCheck(
      'redis:ttl',
      beforeTtlExpiry?.ok === true && afterTtlExpiry === null ? 'pass' : 'fail',
      'Redis TTL expiry was exercised',
      { beforeTtlExpiry, afterTtlExpiry },
    );

    await cache.setJson('delete-ready', { ok: true }, 60_000);
    await cache.delete('delete-ready');
    const afterDelete = await cache.getJson('delete-ready');
    addCheck(
      'redis:delete',
      afterDelete === null ? 'pass' : 'fail',
      'Redis delete behavior was exercised',
      { afterDelete },
    );
  } catch (error) {
    const blocked = classifyRedisConnectivityBlock(error, cacheRedisUrl);
    if (blocked) {
      redisConnectivityBlocked = true;
      addCheck(
        'redis:roundtrip',
        'blocked',
        'Redis URL appears to be Render private-network only from this host',
        blocked,
      );
    } else {
      addCheck('redis:roundtrip', 'fail', 'Redis cache roundtrip failed', {
        message: error.message,
        code: error.code,
      });
    }
  } finally {
    await cache.close().catch(() => {});
  }
};

const redisConnectionFromUrl = value => {
  const parsed = new URL(value);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
};

const waitForQueue = async (queue, predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await queue.snapshot();
    if (predicate(lastSnapshot)) return lastSnapshot;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return lastSnapshot;
};

const smokeBullMq = async () => {
  const bullMqDependencyAvailable = requireOptional('bullmq');
  if (!queueRedisUrl) {
    addCheck(
      'bullmq:redis-url',
      'blocked',
      'BullMQ smoke needs ALERT_QUEUE_REDIS_URL or ALERT_REDIS_URL',
    );
    return;
  }
  if (!bullMqDependencyAvailable) {
    return;
  }
  if (redisConnectivityBlocked && queueRedisUrl === cacheRedisUrl) {
    addCheck(
      'bullmq:redis-connectivity',
      'blocked',
      'BullMQ smoke skipped because Redis is not reachable from this host',
      { reason: 'redis_roundtrip_blocked' },
    );
    return;
  }
  if (!redisRoundtripPassed && queueRedisUrl === cacheRedisUrl) {
    addCheck(
      'bullmq:redis-connectivity',
      'blocked',
      'BullMQ smoke skipped because shared Redis roundtrip did not pass',
    );
    return;
  }

  const sosFanoutHandler = createSosFanoutHandler({
    sendMulticast: async message => {
      if (message.data?.message === 'external-smoke-force-fail') {
        throw new Error('external_smoke_expected_failure');
      }
      return { successCount: message.tokens.length, failureCount: 0 };
    },
  });
  const queue = createJobQueue({
    name: 'sos-fanout',
    driver: 'bullmq',
    queueName,
    connection: {
      ...redisConnectionFromUrl(queueRedisUrl),
      connectTimeout: Number(process.env.ALERT_REDIS_CONNECT_TIMEOUT_MS || 1500),
      maxRetriesPerRequest: null,
    },
    maxAttempts: 2,
    baseBackoffMs: 250,
    handler: sosFanoutHandler,
  });
  try {
    const id = `external-smoke-ok-${Date.now()}`;
    const failingId = `external-smoke-dead-letter-${Date.now()}`;
    const result = await withTimeout(queue.enqueue(id, {
      flow: 'sos-fanout',
      tier: 'smoke',
      fromId: 'smoke-user',
      fromName: 'Alert Smoke',
      message: 'external-smoke-ok',
      location: { latitude: -23.55, longitude: -46.63 },
      targets: ['smoke-guardian'],
      tokens: ['smoke-token-1'],
      timestamp: new Date().toISOString(),
    }), 5000, 'bullmq_enqueue_ok');
    const failingResult = await withTimeout(queue.enqueue(failingId, {
      flow: 'sos-fanout',
      tier: 'smoke',
      fromId: 'smoke-user',
      fromName: 'Alert Smoke',
      message: 'external-smoke-force-fail',
      location: { latitude: -23.55, longitude: -46.63 },
      targets: ['smoke-guardian'],
      tokens: ['smoke-token-1'],
      timestamp: new Date().toISOString(),
    }), 5000, 'bullmq_enqueue_fail');
    const snapshot = await withTimeout(waitForQueue(
      queue,
      row => Number(row.counts?.completed || 0) >= 1 && Number(row.counts?.failed || 0) >= 1,
    ), 8000, 'bullmq_wait_for_worker');
    const completed = Number(snapshot?.counts?.completed || 0);
    const failed = Number(snapshot?.counts?.failed || 0);
    addCheck(
      'bullmq:enqueue-retry-dead-letter',
      result.accepted && failingResult.accepted && completed >= 1 && failed >= 1 ? 'pass' : 'fail',
      'BullMQ enqueue, worker retry and failed-job retention smoke completed',
      {
        result,
        failingResult,
        snapshot,
      },
    );
    addCheck('bullmq:enqueue', result.accepted ? 'pass' : 'fail', 'BullMQ enqueue smoke completed', {
      result,
    });
  } catch (error) {
    const blocked = classifyRedisConnectivityBlock(error, queueRedisUrl);
    if (blocked) {
      addCheck(
        'bullmq:enqueue',
        'blocked',
        'BullMQ enqueue could not reach Render private Redis from this host',
        blocked,
      );
    } else {
      addCheck('bullmq:enqueue', 'fail', 'BullMQ enqueue smoke failed', {
        message: error.message,
        code: error.code,
      });
    }
  } finally {
    await queue.close().catch(() => {});
  }
};

const proveSosFanoutFlow = async () => {
  if (!queueRedisUrl) {
    addCheck(
      'flow:sos-fanout',
      'blocked',
      'SOS fan-out proof needs ALERT_QUEUE_REDIS_URL or ALERT_REDIS_URL',
    );
    return;
  }
  if (redisConnectivityBlocked && queueRedisUrl === cacheRedisUrl) {
    addCheck(
      'flow:sos-fanout',
      'blocked',
      'SOS fan-out proof skipped because Redis is not reachable from this host',
      { reason: 'redis_roundtrip_blocked' },
    );
    return;
  }
  if (!redisRoundtripPassed && queueRedisUrl === cacheRedisUrl) {
    addCheck(
      'flow:sos-fanout',
      'blocked',
      'SOS fan-out proof skipped because shared Redis roundtrip did not pass',
      { reason: 'redis_roundtrip_failed' },
    );
    return;
  }

  const probeId = `proof-${Date.now()}`;
  const proofTokens = buildSosDeliveryProofTokens(probeId, 2);
  const bootstrap = createExternalSosFanoutQueue({
    env: {
      ...process.env,
      ALERT_JOB_QUEUE_DRIVER: 'bullmq',
      ALERT_SOS_FANOUT_WORKER_ENABLED: 'false',
      ALERT_QUEUE_REDIS_URL: process.env.ALERT_QUEUE_REDIS_URL || queueRedisUrl,
      ALERT_REDIS_URL: process.env.ALERT_REDIS_URL || sharedRedisUrl,
      ALERT_SOS_FANOUT_QUEUE_NAME: sosFanoutQueueName,
    },
    sendMulticast: async () => ({ successCount: 0, failureCount: 0 }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  if (!bootstrap.enabled || !bootstrap.queue) {
    addCheck(
      'flow:sos-fanout',
      'fail',
      'SOS fan-out proof could not bootstrap an enqueue-only BullMQ client',
      {
        driver: bootstrap.driver,
        reason: bootstrap.reason,
        queueName: bootstrap.queueName || sosFanoutQueueName,
      },
    );
    return;
  }

  try {
    const jobId = `external-smoke-proof-${Date.now()}`;
    const enqueueResult = await withTimeout(
      bootstrap.queue.enqueue(jobId, {
        flow: 'sos-fanout',
        tier: 'smoke-proof',
        fromId: 'proof-sender',
        fromName: 'Alert Smoke',
        message: 'external-smoke-delivery-proof',
        location: { latitude: 0, longitude: 0 },
        targets: [`proof-target:${probeId}`],
        tokens: proofTokens,
        timestamp: new Date().toISOString(),
        proofOfDelivery: {
          probeId,
        },
      }),
      5000,
      'sos_fanout_proof_enqueue',
    );
    const settlement = await withTimeout(
      bootstrap.queue.waitForResult(jobId, {
        timeoutMs: 20_000,
        pollIntervalMs: 200,
      }),
      21_000,
      'sos_fanout_proof_wait',
    );

    const deliveredCount = Number(settlement?.result?.deliveredCount || 0);
    const isProofPass =
      enqueueResult.accepted === true &&
      settlement?.state === 'completed' &&
      settlement?.result?.deliveryMode === 'controlled_proof_sink' &&
      settlement?.result?.handlerId === DELIVERY_PROOF_HANDLER_ID &&
      deliveredCount > 0;

    addCheck(
      'flow:sos-fanout',
      isProofPass ? 'pass' : 'fail',
      'SOS fan-out delivery proof was processed by the configured handler',
      {
        queueName: bootstrap.queueName || sosFanoutQueueName,
        jobId,
        enqueueAccepted: enqueueResult.accepted,
        state: settlement?.state || 'missing',
        handlerId: settlement?.result?.handlerId || null,
        deliveryMode: settlement?.result?.deliveryMode || null,
        deliveredCount,
        failedReason: settlement?.failedReason || null,
      },
    );
  } catch (error) {
    addCheck(
      'flow:sos-fanout',
      'fail',
      'SOS fan-out delivery proof failed',
      {
        message: error.message,
        code: error.code,
        queueName: bootstrap.queueName || sosFanoutQueueName,
      },
    );
  } finally {
    await bootstrap.queue.close().catch(() => {});
  }
};

const canRunDirectSosProof = () => {
  if (!queueRedisUrl) return false;
  if (redisConnectivityBlocked && queueRedisUrl === cacheRedisUrl) return false;
  if (!redisRoundtripPassed && queueRedisUrl === cacheRedisUrl) return false;
  return true;
};

const proveSosFanoutFlowViaHttp = async () => {
  if (!sosFanoutProofBaseUrl) {
    addCheck(
      'flow:sos-fanout',
      'blocked',
      'SOS fan-out proof needs ALERT_LOAD_BASE_URL or ALERT_SOS_FANOUT_PROOF_BASE_URL',
    );
    return;
  }

  try {
    const response = await withTimeout(
      requestJson(
        'POST',
        `${sosFanoutProofBaseUrl.replace(/\/+$/, '')}/v1/ops/sos-fanout-proof`,
      ),
      25_000,
      'sos_fanout_http_proof_timeout',
    );
    const deliveredCount = Number(response.body?.deliveredCount || 0);
    const isProofPass =
      response.statusCode === 200 &&
      response.body?.ok === true &&
      response.body?.flow === 'sos-fanout' &&
      response.body?.deliveryMode === 'controlled_proof_sink' &&
      response.body?.handlerId === DELIVERY_PROOF_HANDLER_ID &&
      deliveredCount > 0;

    addCheck(
      'flow:sos-fanout',
      isProofPass ? 'pass' : 'fail',
      'SOS fan-out delivery proof was processed by the live handler over HTTP',
      {
        baseUrl: sosFanoutProofBaseUrl,
        statusCode: response.statusCode,
        queueDriver: response.body?.queueDriver || null,
        jobId: response.body?.jobId || null,
        state: response.body?.state || null,
        handlerId: response.body?.handlerId || null,
        deliveryMode: response.body?.deliveryMode || null,
        deliveredCount,
        failedReason: response.body?.failedReason || response.body?.error || null,
      },
    );
  } catch (error) {
    addCheck(
      'flow:sos-fanout',
      'fail',
      'SOS fan-out HTTP delivery proof failed',
      {
        baseUrl: sosFanoutProofBaseUrl,
        message: error.message,
        code: error.code,
      },
    );
  }
};

const main = async () => {
  const dockerAvailable = probeTool('docker');
  probeTool('redis-server');
  ensureRedisUrls({ dockerAvailable });
  await smokeRedis();
  await smokeBullMq();
  if (canRunDirectSosProof()) {
    await proveSosFanoutFlow();
  } else {
    await proveSosFanoutFlowViaHttp();
  }

  const failed = checks.filter(check => check.status === 'fail');
  const blocked = checks.filter(check => check.status === 'blocked');
  const result = {
    ok: failed.length === 0 && (!requireExternalInfra || blocked.length === 0),
    generatedAt: new Date().toISOString(),
    requireExternalInfra,
    summary: {
      pass: checks.filter(check => check.status === 'pass').length,
      fail: failed.length,
      blocked: blocked.length,
    },
    checks,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
};

main().catch(error => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
