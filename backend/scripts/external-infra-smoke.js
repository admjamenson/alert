'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { createCacheStore } = require('../src/platform/cache/createCacheStore');
const { createJobQueue } = require('../src/scale/createJobQueue');
const { createSosFanoutHandler } = require('../src/services/SosFanoutDispatcher');

const requireExternalInfra = process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true';
let redisUrl = process.env.ALERT_REDIS_URL || '';
const queueName = process.env.ALERT_QUEUE_NAME || 'alert-sos-fanout-smoke';

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

const parseRedisHost = () => {
  try {
    return redisUrl ? new URL(redisUrl).hostname : '';
  } catch (_error) {
    return '';
  }
};

const isRenderPrivateRedisHost = host =>
  /^red-[a-z0-9-]+$/i.test(String(host || '')) && !process.env.RENDER;

const classifyRedisConnectivityBlock = error => {
  const host = parseRedisHost();
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

const ensureRedisUrl = ({ dockerAvailable }) => {
  if (redisUrl) {
    addCheck('env:ALERT_REDIS_URL', 'pass', 'ALERT_REDIS_URL is configured');
    return;
  }

  addCheck('env:ALERT_REDIS_URL', 'blocked', 'ALERT_REDIS_URL is not configured');
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
    redisUrl = 'redis://127.0.0.1:6379';
    addCheck('docker:redis-autostart', 'pass', 'Redis was started with docker compose', {
      composePath,
      redisUrl,
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
  if (!redisUrl) {
    return;
  }

  if (!redisDependencyAvailable) {
    return;
  }

  const cache = createCacheStore({
    name: 'external-smoke',
    driver: 'redis',
    url: redisUrl,
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
    addCheck('redis:roundtrip', 'pass', 'Redis cache set/get roundtrip passed', cache.snapshot());

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
    const blocked = classifyRedisConnectivityBlock(error);
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
  if (!redisUrl) {
    addCheck('bullmq:redis-url', 'blocked', 'BullMQ smoke needs ALERT_REDIS_URL');
    return;
  }
  if (!bullMqDependencyAvailable) {
    return;
  }
  if (redisConnectivityBlocked) {
    addCheck(
      'bullmq:redis-connectivity',
      'blocked',
      'BullMQ smoke skipped because Redis is not reachable from this host',
      { reason: 'redis_roundtrip_blocked' },
    );
    return;
  }
  if (!redisRoundtripPassed) {
    addCheck(
      'bullmq:redis-connectivity',
      'blocked',
      'BullMQ smoke skipped because Redis roundtrip did not pass',
    );
    return;
  }

  const deliveredMessages = [];
  const sosFanoutHandler = createSosFanoutHandler({
    sendMulticast: async message => {
      if (message.data?.message === 'external-smoke-force-fail') {
        throw new Error('external_smoke_expected_failure');
      }
      deliveredMessages.push(message);
      return { successCount: message.tokens.length, failureCount: 0 };
    },
  });
  const queue = createJobQueue({
    name: 'sos-fanout',
    driver: 'bullmq',
    queueName,
    connection: {
      ...redisConnectionFromUrl(redisUrl),
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
    const delivered = deliveredMessages[0];
    addCheck(
      'flow:sos-fanout',
      delivered?.data?.type === 'sos' &&
        delivered?.android?.notification?.channelId === 'alert_sos_channel'
        ? 'pass'
        : 'fail',
      'SOS push fan-out flow used the BullMQ worker handler',
      {
        deliveredType: delivered?.data?.type,
        channelId: delivered?.android?.notification?.channelId,
        deliveredCount: deliveredMessages.length,
      },
    );
  } catch (error) {
    const blocked = classifyRedisConnectivityBlock(error);
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

const main = async () => {
  const dockerAvailable = probeTool('docker');
  probeTool('redis-server');
  ensureRedisUrl({ dockerAvailable });
  await smokeRedis();
  await smokeBullMq();

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
