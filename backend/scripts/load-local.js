const { performance } = require('node:perf_hooks');

const DEFAULT_TARGET = process.env.ALERT_LOAD_TARGET || 'http://127.0.0.1:5005/healthz';
const REQUESTS = Math.max(1, Number(process.env.ALERT_LOAD_REQUESTS || 200));
const CONCURRENCY = Math.max(1, Number(process.env.ALERT_LOAD_CONCURRENCY || 20));
const TIMEOUT_MS = Math.max(100, Number(process.env.ALERT_LOAD_TIMEOUT_MS || 2500));

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index]);
};

const requestOnce = async target => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, { signal: controller.signal });
    await res.arrayBuffer();
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Math.max(0, performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Math.max(0, performance.now() - startedAt),
      error: error?.name || 'request_error',
    };
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  let next = 0;
  const results = [];
  const startedAt = performance.now();

  const worker = async () => {
    while (next < REQUESTS) {
      next += 1;
      results.push(await requestOnce(DEFAULT_TARGET));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker()),
  );

  const durationSec = Math.max(0.001, (performance.now() - startedAt) / 1000);
  const latencies = results.map(row => row.durationMs);
  const ok = results.filter(row => row.ok).length;
  const failed = results.length - ok;
  const statuses = results.reduce((acc, row) => {
    const key = String(row.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        target: DEFAULT_TARGET,
        requests: REQUESTS,
        concurrency: CONCURRENCY,
        durationSec: Math.round(durationSec * 100) / 100,
        rps: Math.round((results.length / durationSec) * 100) / 100,
        ok,
        failed,
        statuses,
        latencyMs: {
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          p99: percentile(latencies, 99),
          max: Math.round(Math.max(...latencies)),
        },
      },
      null,
      2,
    ),
  );
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

