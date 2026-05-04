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

const TARGET = __ENV.ALERT_LOAD_TARGET || 'http://127.0.0.1:5005';
const SAFE_MODE = __ENV.ALERT_LOAD_TEST_SAFE_MODE === 'true';
const SELECTED_PHASE = __ENV.ALERT_K6_PHASE || 'all';

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
  500: {rps: 500, duration: '10m', vus: 50, exec: 'runScenario1'},
  1000: {rps: 1000, duration: '10m', vus: 100, exec: 'runScenario2'},
  2500: {rps: 2500, duration: '20m', vus: 250, exec: 'runScenario3'},
  5000: {rps: 5000, duration: '30m', vus: 500, exec: 'runScenario4'},
};

function buildOptions() {
  const scenarios = {};

  if (SELECTED_PHASE === 'all') {
    scenarios.rps_500 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 50,
      timeUnit: '1s',
      startRate: 500,
      stages: [{target: 500, duration: '10m'}],
      exec: 'runScenario1',
    };
    scenarios.rps_1000 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 100,
      timeUnit: '1s',
      startRate: 1000,
      stages: [{target: 1000, duration: '10m'}],
      startTime: '10m',
      exec: 'runScenario2',
    };
    scenarios.rps_2500 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 250,
      timeUnit: '1s',
      startRate: 2500,
      stages: [{target: 2500, duration: '20m'}],
      startTime: '20m',
      exec: 'runScenario3',
    };
    scenarios.rps_5000 = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 500,
      timeUnit: '1s',
      startRate: 5000,
      stages: [{target: 5000, duration: '30m'}],
      startTime: '40m',
      exec: 'runScenario4',
    };
  } else if (PHASE_CONFIGS[SELECTED_PHASE]) {
    const config = PHASE_CONFIGS[SELECTED_PHASE];
    scenarios[`rps_${SELECTED_PHASE}`] = {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: config.vus,
      timeUnit: '1s',
      startRate: config.rps,
      stages: [{target: config.rps, duration: config.duration}],
      exec: config.exec,
    };
  } else {
    throw new Error(
      `Invalid phase: ${SELECTED_PHASE}. Use 500, 1000, 2500, 5000, or all.`,
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
      ? 'Fases executadas sem violacao dos guardrails configurados'
      : 'Uma ou mais fases violaram os guardrails configurados';
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
  const selectedPhaseConfig = readPhaseSummary();

  const p95 = httpReqDuration?.['p(95)'] ?? null;
  const p99 = httpReqDuration?.['p(99)'] ?? null;
  const errorR = httpReqFailed?.rate ?? null;
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
    scenarioRows.push('| 1 | 500 | 10 min | Executado |');
    scenarioRows.push('| 2 | 1000 | 10 min | Executado |');
    scenarioRows.push('| 3 | 2500 | 20 min | Executado |');
    scenarioRows.push('| 4 | 5000 | 30 min | Executado |');
  } else if (selectedPhaseConfig) {
    scenarioRows.push(
      `| ${SELECTED_PHASE} | ${SELECTED_PHASE} | ${selectedPhaseConfig.duration} | Executado |`,
    );
  }
  const scenarioTable = scenarioRows.join('\n');
  const phaseVerdict = buildPhaseVerdict({allPassed});
  const thirtyMStatus = buildThirtyMStatus({allPassed});

  const report = `# Alert k6 Load Test - Final 30M Proof

## Resumo Executivo

- **Data**: ${timestamp}
- **Target**: ${TARGET}
- **Safe Mode**: ${SAFE_MODE ? 'ATIVO' : 'DESATIVADO'}
- **Fase Executada**: ${phaseDescription}
- **Total Requests**: ${totalRequests.toLocaleString()}
- **RPS Medio**: ${avgRps.toFixed(1)}

## Cenarios Executados

${scenarioTable}

## Metricas de Performance

| Metrica | Valor | Threshold | Status |
|---------|-------|-----------|--------|
| p95 Latency | ${p95Display} | < 800ms | ${p95Status} |
| p99 Latency | ${p99Display} | < 1500ms | ${p99Status} |
| Error Rate | ${errorR != null ? (errorR * 100).toFixed(2) + '%' : 'N/A'} | < 1% | ${errorStatus} |
| RPS Medio | ${avgRps.toFixed(1)} | ${minimumExpectedRps != null ? `>= ${minimumExpectedRps.toFixed(1)}` : 'N/A'} | ${rpsStatus} |

## Guardrails

| Guardrail | Threshold | Resultado | Status |
|-----------|-----------|-----------|--------|
| p95 Latency | < 800ms | ${p95Display} | ${p95Status} |
| p99 Latency | < 1500ms | ${p99Display} | ${p99Status} |
| Error Rate | < 1% | ${errorR != null ? (errorR * 100).toFixed(2) + '%' : 'N/A'} | ${errorStatus} |
| RPS real | ${minimumExpectedRps != null ? `>= ${minimumExpectedRps.toFixed(1)}` : 'N/A'} | ${avgRps.toFixed(1)} | ${rpsStatus} |

## Custo Estimado

### Por 1M Requests

- **Render Hosting**: ~$7-25/mes
- **Custo total estimado 1M requests**: validar com a fase aprovada

## Conclusao

${allPassed ? 'LOAD TEST PASSED: Todos os guardrails da fase executada foram respeitados.' : 'LOAD TEST FAILED: Um ou mais guardrails foram violados.'}

## Veredito da Fase

- **Resultado**: ${phaseVerdict}
- **Status 30M**: ${thirtyMStatus}

## Classificacao Final

[ ] SUPORTA 30M
[ ] SUPORTA COM RISCOS
${SELECTED_PHASE === '500' && allPassed ? '[x] NAO PROVADO' : '[x] NAO SUPORTA'}

---

*Relatorio gerado automaticamente pelo k6*
`;

  return {
    stdout: report,
    'docs/scale-readiness/k6-30m-proof-report.md': report,
  };
}
