#!/usr/bin/env node
'use strict';

/**
 * k6-30m-proof.js
 *
 * Progressive load test phases for Alert staging.
 * This report must not claim 30M support until the required proof
 * phases have actually passed.
 */

import http from 'k6/http';
import {check, sleep} from 'k6';
import {Counter, Rate, Trend} from 'k6/metrics';

const p95Latency = new Trend('p95_latency');
const p99Latency = new Trend('p99_latency');
const errorRate = new Rate('error_rate');
const rpsMetric = new Counter('rps');

// Per-endpoint metrics
const endpointP95 = {};
const endpointP99 = {};
const endpointCount = {};
const endpointError = {};
const endpointDuration = {};
const ENDPOINT_NAMES = [
  'ops_summary',
  'weather_feed',
  'risk_feed',
  'entitlements',
  'healthz',
];
ENDPOINT_NAMES.forEach(name => {
  endpointP95[name] = new Trend(`p95_${name}`);
  endpointP99[name] = new Trend(`p99_${name}`);
  endpointCount[name] = new Counter(`count_${name}`);
  endpointError[name] = new Rate(`error_${name}`);
  endpointDuration[name] = new Trend(`duration_${name}`);
});
const httpReqBlocked = new Trend('http_req_blocked');
const httpReqWaiting = new Trend('http_req_waiting');

const TARGET = __ENV.ALERT_LOAD_TARGET || 'http://127.0.0.1:5005';
const SAFE_MODE = __ENV.ALERT_LOAD_TEST_SAFE_MODE === 'true';
const SELECTED_PHASE = __ENV.ALERT_K6_PHASE || 'all';
const REQUIRE_EXTERNAL = __ENV.ALERT_LOAD_REQUIRE_EXTERNAL === 'true';
const REQUIRE_HTTPS = __ENV.ALERT_LOAD_REQUIRE_HTTPS === 'true';

// Validation: Abort if external required but target is localhost
if (REQUIRE_EXTERNAL && TARGET.includes('127.0.0.1')) {
  console.error(
    'ABORT: ALERT_LOAD_REQUIRE_EXTERNAL=true but target is localhost',
  );
  process.exit(1);
}

if (REQUIRE_HTTPS && !TARGET.startsWith('https://')) {
  console.error('ABORT: ALERT_LOAD_REQUIRE_HTTPS=true but target is not HTTPS');
  process.exit(1);
}

const TEST_LAT = -23.5505;
const TEST_LON = -46.6333;

const HEADERS = {
  'User-Agent': 'Alert-k6-Load-Test/1.0',
  'Content-Type': 'application/json',
};

const ENDPOINTS = [
  {path: '/v1/ops/summary', weight: 65, method: 'GET'},
  {
    path: `/api/v1/weather/feed?lat=${TEST_LAT}&lon=${TEST_LON}`,
    weight: 20,
    method: 'GET',
  },
  {
    path: `/api/v1/risk/feed?lat=${TEST_LAT}&lon=${TEST_LON}&limit=10`,
    weight: 10,
    method: 'GET',
  },
  {
    path: '/api/me/entitlements',
    weight: 4,
    method: 'GET',
    headers: {
      'x-alert-user-id': 'load-test-user',
      'x-alert-device-id': 'load-test-device',
    },
  },
  {path: '/healthz', weight: 1, method: 'GET'},
];

const PHASE_CONFIGS = {
  50: {
    rps: 50,
    duration: '5m',
    preAllocatedVUs: 30,
    maxVUs: 60,
    exec: 'runCheapScenario',
  },
  100: {
    rps: 100,
    duration: '10m',
    preAllocatedVUs: 60,
    maxVUs: 120,
    exec: 'runCheapScenario',
  },
  150: {
    rps: 150,
    duration: '10m',
    preAllocatedVUs: 90,
    maxVUs: 180,
    exec: 'runCheapScenario',
  },
  200: {
    rps: 200,
    duration: '10m',
    preAllocatedVUs: 120,
    maxVUs: 240,
    exec: 'runCheapScenario',
  },
  500: {
    rps: 500,
    duration: '10m',
    preAllocatedVUs: 300,
    maxVUs: 600,
    exec: 'runScenario1',
  },
  1000: {
    rps: 1000,
    duration: '10m',
    preAllocatedVUs: 100,
    maxVUs: 200,
    exec: 'runScenario2',
  },
  2500: {
    rps: 2500,
    duration: '20m',
    preAllocatedVUs: 250,
    maxVUs: 500,
    exec: 'runScenario3',
  },
  5000: {
    rps: 5000,
    duration: '30m',
    preAllocatedVUs: 500,
    maxVUs: 1000,
    exec: 'runScenario4',
  },
};

function buildOptions() {
  const scenarios = {};

  if (SELECTED_PHASE === 'all') {
    // For Standard plan proof, run 50→100→150→200 RPS phases
    scenarios.rps_50 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 30,
      maxVUs: 60,
      timeUnit: '1s',
      startRate: 50,
      stages: [{target: 50, duration: '5m'}],
      exec: 'runCheapScenario',
    };
    scenarios.rps_100 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 60,
      maxVUs: 120,
      timeUnit: '1s',
      startRate: 100,
      stages: [{target: 100, duration: '10m'}],
      startTime: '5m',
      exec: 'runCheapScenario',
    };
    scenarios.rps_150 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 90,
      maxVUs: 180,
      timeUnit: '1s',
      startRate: 150,
      stages: [{target: 150, duration: '10m'}],
      startTime: '15m',
      exec: 'runCheapScenario',
    };
    scenarios.rps_200 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 120,
      maxVUs: 240,
      timeUnit: '1s',
      startRate: 200,
      stages: [{target: 200, duration: '10m'}],
      startTime: '25m',
      exec: 'runCheapScenario',
    };
  } else if (PHASE_CONFIGS[SELECTED_PHASE]) {
    const config = PHASE_CONFIGS[SELECTED_PHASE];
    scenarios[`rps_${SELECTED_PHASE}`] = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: config.preAllocatedVUs,
      maxVUs: config.maxVUs,
      timeUnit: '1s',
      startRate: config.rps,
      stages: [{target: config.rps, duration: config.duration}],
      exec: config.exec,
    };
  } else {
    throw new Error(
      `Invalid phase: ${SELECTED_PHASE}. Use 50, 100, 150, 200, 500, 1000, 2500, 5000, or all.`,
    );
  }

  return {
    scenarios,
    thresholds: {
      http_req_duration: ['p(95)<800', 'p(99)<1500'],
      http_req_failed: ['rate<0.01'],
      error_rate: ['rate<0.01'],
    },
  };
}

export const options = buildOptions();

function selectEndpoint() {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const endpoint of ENDPOINTS) {
    cumulative += endpoint.weight;
    if (rand < cumulative) {
      return endpoint;
    }
  }
  return ENDPOINTS[0];
}

function makeRequest(endpoint) {
  const url = `${TARGET}${endpoint.path}`;
  const params = {
    headers: {
      ...HEADERS,
      ...(endpoint.headers || {}),
    },
    timeout: '10s',
  };

  const response = http.request(endpoint.method, url, null, params);
  rpsMetric.add(1);

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    duration: response.timings.duration,
  };
}

function resolveEndpointName(endpoint) {
  const path = endpoint.path;
  if (path.includes('/v1/ops/summary')) return 'ops_summary';
  if (path.includes('/weather/feed')) return 'weather_feed';
  if (path.includes('/risk/feed')) return 'risk_feed';
  if (path.includes('/entitlements')) return 'entitlements';
  if (path.includes('/healthz')) return 'healthz';
  return 'other';
}

function runLoadTest(scenarioName, targetRps) {
  console.log(`${scenarioName} - target ${targetRps} RPS`);

  const endpoint = selectEndpoint();
  const result = makeRequest(endpoint);

  const success = check(result, {
    'status is 2xx': r => r.ok,
    'response time < 800ms': r => r.duration < 800,
  });

  errorRate.add(!success ? 1 : 0);
  p95Latency.add(result.duration);
  p99Latency.add(result.duration);

  // Per-endpoint metrics
  const epName = resolveEndpointName(endpoint);
  if (endpointP95[epName]) {
    endpointP95[epName].add(result.duration);
    endpointP99[epName].add(result.duration);
    endpointCount[epName].add(1);
    endpointError[epName].add(!success ? 1 : 0);
    endpointDuration[epName].add(result.duration);
  }

  sleep(0.01);
}

export function runScenario1() {
  runLoadTest('500 RPS', 500);
}

export function runScenario2() {
  runLoadTest('1000 RPS', 1000);
}

export function runScenario3() {
  runLoadTest('2500 RPS', 2500);
}

export function runScenario4() {
  runLoadTest('5000 RPS', 5000);
}

export function runCheapScenario() {
  const selectedConfig = PHASE_CONFIGS[SELECTED_PHASE];
  if (!selectedConfig) {
    throw new Error(`No scenario defined for phase ${SELECTED_PHASE}`);
  }
  runLoadTest(`${selectedConfig.rps} RPS`, selectedConfig.rps);
}

const formatLatency = value => {
  if (value == null || value === 0) return 'N/A';
  return `${Math.round(value)}ms`;
};

const readPhaseSummary = () =>
  SELECTED_PHASE !== 'all' ? PHASE_CONFIGS[SELECTED_PHASE] || null : null;

const buildPhaseVerdict = ({allPassed}) => {
  if (SELECTED_PHASE === '500') {
    return allPassed
      ? '500 RPS PROVADO - autorizado testar 1000 RPS'
      : '30M NAO SUPORTA AINDA - 500 RPS falhou';
  }

  if (SELECTED_PHASE === 'all') {
    return allPassed
      ? 'Fases Standard (50→200 RPS) executadas sem violacao dos guardrails'
      : 'Uma ou mais fases Standard violaram os guardrails';
  }

  const phaseNum = Number(SELECTED_PHASE);
  if ([50, 100, 150, 200].includes(phaseNum)) {
    return allPassed
      ? `${SELECTED_PHASE} RPS PROVADO - Standard plan capaz`
      : `${SELECTED_PHASE} RPS FALHOU - otimizacao necessaria`;
  }

  return allPassed
    ? `${SELECTED_PHASE} RPS PROVADO`
    : `${SELECTED_PHASE} RPS FALHOU`;
};

const buildThirtyMStatus = ({allPassed}) =>
  SELECTED_PHASE === '500' && allPassed
    ? 'AINDA NAO PROVADO PARA 30M - seguir para 1000 RPS'
    : '30M NAO SUPORTA AINDA';

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  const totalRequests = data?.metrics?.rps ? data.metrics.rps.values.count : 0;
  const avgRps = data?.metrics?.rps ? data.metrics.rps.values.rate : 0;
  const httpReqDuration = data?.metrics?.http_req_duration?.values;
  const httpReqFailed = data?.metrics?.http_req_failed?.values;
  const droppedIterations =
    data?.metrics?.dropped_iterations?.values?.count ?? 0;
  const selectedPhaseConfig = readPhaseSummary();

  const p95 = httpReqDuration?.['p(95)'] ?? null;
  const p99 = httpReqDuration?.['p(99)'] ?? null;
  const errorR = httpReqFailed?.rate ?? null;
  const httpBlockedVal = data?.metrics?.http_req_blocked?.values;
  const httpWaitingVal = data?.metrics?.http_req_waiting?.values;
  const httpBlockedAvg = httpBlockedVal?.avg ?? null;
  const httpWaitingAvg = httpWaitingVal?.avg ?? null;
  const httpBlockedP95 = httpBlockedVal?.['p(95)'] ?? null;
  const httpWaitingP95 = httpWaitingVal?.['p(95)'] ?? null;

  // Per-endpoint breakdown
  const endpointRows = [];
  let slowestEndpoint = {name: 'N/A', p95: 0};
  for (const name of ENDPOINT_NAMES) {
    const epP95 = data?.metrics?.[`p95_${name}`]?.values?.['p(95)'];
    const epP99 = data?.metrics?.[`p99_${name}`]?.values?.['p(99)'];
    const epCount = data?.metrics?.[`count_${name}`]?.values?.count ?? 0;
    const epError = data?.metrics?.[`error_${name}`]?.values?.rate ?? null;
    const epP95Display = formatLatency(epP95);
    const epP99Display = formatLatency(epP99);
    const epErrorDisplay =
      epError != null ? (epError * 100).toFixed(2) + '%' : 'N/A';
    const epLabel = name.replace(/_/g, ' ');
    endpointRows.push(
      `| ${epLabel} | ${epCount} | ${epP95Display} | ${epP99Display} | ${epErrorDisplay} |`,
    );
    if (epP95 != null && epP95 > slowestEndpoint.p95) {
      slowestEndpoint = {name: epLabel, p95: epP95};
    }
  }
  const endpointTable = endpointRows.join('\n');
  const slowestEndpointDisplay =
    slowestEndpoint.name !== 'N/A'
      ? `${slowestEndpoint.name} (${formatLatency(slowestEndpoint.p95)})`
      : 'N/A';
  const targetRps = selectedPhaseConfig?.rps || null;
  const minimumExpectedRps = targetRps ? targetRps * 0.9 : null;
  const rpsPassed = minimumExpectedRps == null || avgRps >= minimumExpectedRps;

  const p95Display = formatLatency(p95);
  const p99Display = formatLatency(p99);
  const p95Status = p95 != null ? (p95 < 800 ? 'PASS' : 'FAIL') : 'N/A';
  const p99Status = p99 != null ? (p99 < 1500 ? 'PASS' : 'FAIL') : 'N/A';
  const errorStatus =
    errorR != null ? (errorR < 0.01 ? 'PASS' : 'FAIL') : 'N/A';
  const rpsStatus =
    minimumExpectedRps == null ? 'N/A' : rpsPassed ? 'PASS' : 'FAIL';

  const allPassed =
    p95 != null &&
    p99 != null &&
    errorR != null &&
    rpsPassed &&
    p95 < 800 &&
    p99 < 1500 &&
    errorR < 0.01;

  let phaseDescription = 'Todas as fases (500 -> 1000 -> 2500 -> 5000 RPS)';
  if (selectedPhaseConfig) {
    phaseDescription = `Fase ${SELECTED_PHASE} RPS (${selectedPhaseConfig.duration})`;
  }

  const scenarioRows = [];
  if (SELECTED_PHASE === 'all') {
    scenarioRows.push('| 1 | 50 | 30 | 60 | 5 min | Executado |');
    scenarioRows.push('| 2 | 100 | 60 | 120 | 10 min | Executado |');
    scenarioRows.push('| 3 | 150 | 90 | 180 | 10 min | Executado |');
    scenarioRows.push('| 4 | 200 | 120 | 240 | 10 min | Executado |');
  } else if (PHASE_CONFIGS[SELECTED_PHASE]) {
    const cfg = PHASE_CONFIGS[SELECTED_PHASE];
    scenarioRows.push(
      `| ${SELECTED_PHASE} | ${SELECTED_PHASE} | ${cfg.preAllocatedVUs} | ${cfg.maxVUs} | ${cfg.duration} | Executado |`,
    );
  }
  const scenarioTable = scenarioRows.join('\n');
  const phaseVerdict = buildPhaseVerdict({allPassed});
  const thirtyMStatus = buildThirtyMStatus({allPassed});

  const observations = [];
  if (SELECTED_PHASE === 'all' || SELECTED_PHASE === '50') {
    observations.push(
      '- Fase anterior de 50 RPS foi inconclusiva porque o k6 estava limitado por VUs insuficientes. Agora preAllocatedVUs=30 / maxVUs=60 para garantir throughput real. Fase de 50 RPS com VUs adequados precisa ser reexecutada para validacao.',
    );
  }

  const report = `# Alert k6 Load Test - Render Standard Plan Proof

## Resumo Executivo

- **Data**: ${timestamp}
- **Target**: ${TARGET}
- **Safe Mode**: ${SAFE_MODE ? 'ATIVO' : 'DESATIVADO'}
- **Fase Executada**: ${phaseDescription}
- **Total Requests**: ${totalRequests.toLocaleString()}
- **RPS Medio**: ${avgRps.toFixed(1)}
- **Dropped Iterations**: ${droppedIterations.toLocaleString()}

## Cenarios Executados

| # | RPS | preAllocatedVUs | maxVUs | Duracao | Status |
|---|-----|-----------------|--------|---------|--------|
${scenarioTable}

## Metricas de Performance

| Metrica | Valor | Threshold | Status |
|---------|-------|-----------|--------|
| p95 Latency | ${p95Display} | < 800ms | ${p95Status} |
| p99 Latency | ${p99Display} | < 1500ms | ${p99Status} |
| Error Rate | ${errorR != null ? (errorR * 100).toFixed(2) + '%' : 'N/A'} | < 1% | ${errorStatus} |
| RPS Medio | ${avgRps.toFixed(1)} | ${minimumExpectedRps != null ? `>= ${minimumExpectedRps.toFixed(1)}` : 'N/A'} | ${rpsStatus} |
| Dropped Iterations | ${droppedIterations.toLocaleString()} | 0 (ideal) | ${droppedIterations > 0 ? 'ATENCAO' : 'OK'} |

## Guardrails

| Guardrail | Threshold | Resultado | Status |
|-----------|-----------|-----------|--------|
| p95 Latency | < 800ms | ${p95Display} | ${p95Status} |
| p99 Latency | < 1500ms | ${p99Display} | ${p99Status} |
| Error Rate | < 1% | ${errorR != null ? (errorR * 100).toFixed(2) + '%' : 'N/A'} | ${errorStatus} |
| RPS real | ${minimumExpectedRps != null ? `>= ${minimumExpectedRps.toFixed(1)}` : 'N/A'} | ${avgRps.toFixed(1)} | ${rpsStatus} |

## Performance por Endpoint

| Endpoint | Requests | p95 | p99 | Error Rate |
|----------|----------|-----|-----|------------|
${endpointTable}

**Endpoint mais lento:** ${slowestEndpointDisplay}

## Metricas de Rede

| Metrica | Media | p95 |
|---------|-------|-----|
| http_req_blocked | ${httpBlockedAvg != null ? (httpBlockedAvg * 1000).toFixed(2) + 'ms' : 'N/A'} | ${httpBlockedP95 != null ? (httpBlockedP95 * 1000).toFixed(2) + 'ms' : 'N/A'} |
| http_req_waiting (TTFB) | ${httpWaitingAvg != null ? httpWaitingAvg.toFixed(1) + 'ms' : 'N/A'} | ${httpWaitingP95 != null ? httpWaitingP95.toFixed(1) + 'ms' : 'N/A'} |

## Observacoes

${observations.length > 0 ? observations.join('\n') : '- Nenhuma observacao adicional.'}

## Custo Estimado

### Por 1M Requests (Standard Plan)

- **Render Hosting**: ~$7-25/mes
- **Custo total estimado 1M requests**: validar com a fase aprovada

## Conclusao

${allPassed ? 'LOAD TEST PASSED: Todos os guardrails da fase Standard foram respeitados.' : 'LOAD TEST FAILED: Um ou mais guardrails foram violados.'}

## Veredito da Fase

- **Resultado**: ${phaseVerdict}
- **Status 30M**: ${thirtyMStatus}

## Classificacao Final

[ ] SUPORTA 30M
[ ] SUPORTA COM RISCOS
${SELECTED_PHASE === '200' && allPassed ? '[x] STANDARD PLAN PROVADO' : '[x] NAO SUPORTA'}

---

*Relatorio gerado automaticamente pelo k6*
`;

  return {
    stdout: report,
    'docs/scale-readiness/k6-30m-proof-report.md': report,
  };
}
