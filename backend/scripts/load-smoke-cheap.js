/**
 * load-smoke-cheap.js
 *
 * Teste de carga leve e seguro para validação de escala com custo mínimo.
 *
 * REGRAS DE SEGURANÇA:
 * - Tempo máximo: 5 minutos
 * - Concorrência inicial baixa (5), aumento progressivo
 * - Parar se taxa de erro > 2%
 * - Parar se p95 > 1500ms
 * - Parar se houver timeout em massa
 * - Testar apenas endpoints leves (/healthz, /status, etc.)
 * - NÃO testar endpoints pagos ou que gerem custo
 *
 * USO:
 *   npm run load:cheap
 *   ALERT_LOAD_TARGET=http://localhost:5005 npm run load:cheap
 *   ALERT_LOAD_TARGET=https://api-staging.alert.app npm run load:cheap
 */

const {performance} = require('node:perf_hooks');

// Configurações com guardrails de segurança
const TARGET = process.env.ALERT_LOAD_TARGET || 'http://127.0.0.1:5005/healthz';
const MAX_DURATION_SEC = Math.min(
  300,
  Number(process.env.ALERT_LOAD_MAX_DURATION_SEC || 300),
); // 5 min max
const INITIAL_CONCURRENCY = Math.min(
  5,
  Number(process.env.ALERT_LOAD_INITIAL_CONCURRENCY || 5),
);
const MAX_CONCURRENCY = Math.min(
  50,
  Number(process.env.ALERT_LOAD_MAX_CONCURRENCY || 50),
);
const REQUESTS_PER_BATCH = Math.min(
  100,
  Number(process.env.ALERT_LOAD_REQUESTS_PER_BATCH || 100),
);
const TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.ALERT_LOAD_TIMEOUT_MS || 3000),
);
const ERROR_RATE_THRESHOLD = 0.02; // 2%
const P95_THRESHOLD_MS = 1500;
const MASS_TIMEOUT_THRESHOLD = 0.1; // 10% timeouts

// Endpoints seguros para teste (apenas leitura, sem custo)
const SAFE_ENDPOINTS = [
  '/healthz',
  '/',
  '/api/me/entitlements', // requer auth, mas é leve
];

// Selecionar endpoint baseado no target
const getEndpoint = () => {
  if (TARGET.includes('/healthz')) return '/healthz';
  if (TARGET.includes('?')) return TARGET.split('?')[0];
  return TARGET;
};

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return Math.round(sorted[index]);
};

const requestOnce = async url => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'User-Agent': 'Alert-LoadTest-Cheap/1.0',
      },
    });
    await res.arrayBuffer();

    return {
      ok: res.ok,
      status: res.status,
      durationMs: Math.max(0, performance.now() - startedAt),
      error: null,
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

const checkGuardrails = (results, batchNumber) => {
  const total = results.length;
  if (total === 0) return {shouldStop: false, reason: null};

  const ok = results.filter(r => r.ok).length;
  const failed = total - ok;
  const errorRate = failed / total;

  const latencies = results.map(r => r.durationMs);
  const p95 = percentile(latencies, 95);

  const timeouts = results.filter(r => r.error === 'AbortError').length;
  const timeoutRate = timeouts / total;

  const reasons = [];

  if (errorRate > ERROR_RATE_THRESHOLD) {
    reasons.push(
      `Error rate ${Math.round(errorRate * 100)}% exceeds threshold ${ERROR_RATE_THRESHOLD * 100}%`,
    );
  }

  if (p95 > P95_THRESHOLD_MS) {
    reasons.push(
      `P95 latency ${p95}ms exceeds threshold ${P95_THRESHOLD_MS}ms`,
    );
  }

  if (timeoutRate > MASS_TIMEOUT_THRESHOLD) {
    reasons.push(
      `Timeout rate ${Math.round(timeoutRate * 100)}% exceeds threshold ${Mass_TIMEOUT_THRESHOLD * 100}%`,
    );
  }

  return {
    shouldStop: reasons.length > 0,
    reason: reasons.join('; '),
    metrics: {errorRate, p95, timeoutRate},
  };
};

const main = async () => {
  console.log('🚀 Iniciando teste de carga barato (cheap load test)');
  console.log(`🎯 Target: ${TARGET}`);
  console.log(`⏱️  Duração máxima: ${MAX_DURATION_SEC}s`);
  console.log(`🔀 Concorrência: ${INITIAL_CONCURRENCY} -> ${MAX_CONCURRENCY}`);
  console.log(`📦 Requests por batch: ${REQUESTS_PER_BATCH}`);
  console.log(
    `⚠️  Thresholds: erro=${ERROR_RATE_THRESHOLD * 100}%, p95=${P95_THRESHOLD_MS}ms`,
  );
  console.log('');

  const globalStartedAt = performance.now();
  let currentConcurrency = INITIAL_CONCURRENCY;
  let totalRequests = 0;
  let batchNumber = 0;
  const allResults = [];
  let shouldStop = false;

  while (
    !shouldStop &&
    (performance.now() - globalStartedAt) / 1000 < MAX_DURATION_SEC
  ) {
    batchNumber++;
    console.log(
      `📦 Batch ${batchNumber}: ${currentConcurrency} workers, ${REQUESTS_PER_BATCH} requests`,
    );

    const batchStartedAt = performance.now();
    let next = 0;
    const batchResults = [];

    const worker = async () => {
      while (next < REQUESTS_PER_BATCH) {
        next += 1;
        const result = await requestOnce(TARGET);
        batchResults.push(result);
        totalRequests++;
      }
    };

    await Promise.all(
      Array.from(
        {length: Math.min(currentConcurrency, REQUESTS_PER_BATCH)},
        () => worker(),
      ),
    );

    allResults.push(...batchResults);

    const batchDuration = ((performance.now() - batchStartedAt) / 1000).toFixed(
      2,
    );
    const batchRps = (REQUESTS_PER_BATCH / (batchDuration || 0.001)).toFixed(1);

    // Verificar guardrails após cada batch
    const guardrailCheck = checkGuardrails(allResults, batchNumber);

    if (guardrailCheck.shouldStop) {
      shouldStop = true;
      console.log(`🛑 PARANDO: ${guardrailCheck.reason}`);
      break;
    }

    console.log(
      `✅ Batch ${batchNumber} concluído em ${batchDuration}s (${batchRps} RPS)`,
    );

    // Aumentar concorrência progressivamente (crescimento suave)
    if (currentConcurrency < MAX_CONCURRENCY) {
      currentConcurrency = Math.min(
        MAX_CONCURRENCY,
        Math.floor(currentConcurrency * 1.5),
      );
    }

    // Pequena pausa entre batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Relatório final
  const totalDurationSec = Math.max(
    0.001,
    (performance.now() - globalStartedAt) / 1000,
  );
  const latencies = allResults.map(r => r.durationMs);
  const ok = allResults.filter(r => r.ok).length;
  const failed = allResults.length - ok;
  const errorRate = allResults.length > 0 ? failed / allResults.length : 0;

  const statuses = allResults.reduce((acc, r) => {
    const key = String(r.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const result = {
    target: TARGET,
    status: shouldStop ? 'STOPPED_BY_GUARDRAIL' : 'COMPLETED',
    totalRequests,
    batches: batchNumber,
    durationSec: Math.round(totalDurationSec * 100) / 100,
    avgRps: Math.round((allResults.length / totalDurationSec) * 100) / 100,
    ok,
    failed,
    errorRate: Math.round(errorRate * 10000) / 10000,
    statuses,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: Math.round(Math.max(...latencies)),
      min: Math.round(Math.min(...latencies)),
    },
    guardrails: {
      errorRateThreshold: ERROR_RATE_THRESHOLD,
      p95ThresholdMs: P95_THRESHOLD_MS,
      massTimeoutThreshold: MASS_TIMEOUT_THRESHOLD,
      maxDurationSec: MAX_DURATION_SEC,
    },
    finalConcurrency: currentConcurrency,
    generatedAt: new Date().toISOString(),
  };

  console.log('');
  console.log('📊 RESULTADO FINAL:');
  console.log(JSON.stringify(result, null, 2));

  // Determinar PASS/FAIL
  const passed =
    !shouldStop &&
    errorRate < ERROR_RATE_THRESHOLD &&
    percentile(latencies, 95) < P95_THRESHOLD_MS;
  console.log('');
  console.log(
    passed ? '✅ TESTE PASSOU' : '❌ TESTE FALHOU ou PARADO PELO GUARDRAIL',
  );

  // Exit code apropriado
  process.exitCode = passed ? 0 : 1;
};

main().catch(error => {
  console.error('💥 Erro fatal no teste de carga:', error);
  process.exitCode = 1;
});
