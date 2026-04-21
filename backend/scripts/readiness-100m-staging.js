'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const hasExternalInfraEnv = () =>
  Boolean(
    process.env.ALERT_REDIS_URL ||
      (process.env.ALERT_QUEUE_REDIS_URL && process.env.ALERT_CACHE_REDIS_URL),
  );

const readPositiveInteger = (value, fallback, minValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.round(parsed));
};

const runNodeScript = (scriptName, extraEnv = {}) => {
  const scriptPath = path.resolve(__dirname, scriptName);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  let parsedStdout = null;
  try {
    parsedStdout = result.stdout ? JSON.parse(result.stdout.trim()) : null;
  } catch (_error) {
    parsedStdout = null;
  }

  return {
    script: scriptName,
    ok: result.status === 0,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdout: parsedStdout,
    stderr: result.stderr ? String(result.stderr).trim() : '',
  };
};

const main = () => {
  const baseUrl = String(process.env.ALERT_LOAD_BASE_URL || '').trim();
  if (!baseUrl) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: 'missing_env_alert_load_base_url',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const loadEnv = {
    ALERT_LOAD_BASE_URL: baseUrl,
    ALERT_LOAD_REQUESTS: String(
      readPositiveInteger(process.env.ALERT_LOAD_REQUESTS, 120, 1),
    ),
    ALERT_LOAD_CONCURRENCY: String(
      readPositiveInteger(process.env.ALERT_LOAD_CONCURRENCY, 12, 1),
    ),
    ALERT_LOAD_TIMEOUT_MS: String(
      readPositiveInteger(process.env.ALERT_LOAD_TIMEOUT_MS, 5000, 500),
    ),
    ALERT_LOAD_REGIONAL_SCENARIO:
      String(process.env.ALERT_LOAD_REGIONAL_SCENARIO || 'multi_region_burst'),
  };

  const steps = [];

  if (hasExternalInfraEnv()) {
    steps.push(runNodeScript('external-infra-smoke.js'));
  } else {
    steps.push({
      script: 'external-infra-smoke.js',
      ok: false,
      blocked: true,
      exitCode: null,
      durationMs: 0,
      stdout: {
        ok: false,
        blocked: true,
        reason: 'missing_external_infra_env',
        missing: [
          'ALERT_REDIS_URL or ALERT_QUEUE_REDIS_URL+ALERT_CACHE_REDIS_URL',
        ],
      },
      stderr: '',
    });
  }

  steps.push(runNodeScript('load-regional.js', loadEnv));

  const failed = steps.filter(step => !step.ok && !step.blocked);
  const blocked = steps.filter(step => step.blocked);
  const result = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl,
      scope: /^https?:\/\/(127\.0\.0\.1|localhost|::1)/i.test(baseUrl)
        ? 'local'
        : 'remote',
    },
    summary: {
      pass: steps.filter(step => step.ok).length,
      fail: failed.length,
      blocked: blocked.length,
    },
    steps,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
};

main();
