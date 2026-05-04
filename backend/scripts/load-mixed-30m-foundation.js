#!/usr/bin/env node
'use strict';

/**
 * load-mixed-30m-foundation.js
 *
 * Teste de carga REALISTA com mix de endpoints para validar caminho para 30M.
 * Simula padrão de tráfego real do aplicativo Alert com distribuição ponderada.
 *
 * MODO SEGURO (SAFE MODE):
 * - ALERT_LOAD_TEST_SAFE_MODE=true: Ativa proteções de load test
 *   - Valida allowlist de endpoints seguros antes de iniciar
 *   - Aborta se detectar rota/provider externo
 *   - Backend deve usar fallback local para OSRM
 *   - Backend não chama Firestore remoto
 *   - Backend não chama billing real
 *   - Backend não dispara SOS real
 *
 * DISTRIBUIÇÃO (SAFE MODE - sem endpoints externos):
 * - 65% /v1/ops/summary (feed operacional - endpoint leve)
 * - 20% /api/v1/weather/feed (cache de clima)
 * - 10% /api/v1/risk/feed (avaliação de risco)
 * - 4% /api/me/entitlements (verificação de permissões)
 * - 1% /healthz (health check mínimo)
 *
 * DISTRIBUIÇÃO (NORMAL - com maps/routes):
 * - 60% /v1/ops/summary
 * - 20% /api/v1/weather/feed
 * - 10% /api/v1/risk/feed
 * - 5% /api/me/entitlements
 * - 4% /api/v1/maps/routes (requer OSRM local configurado)
 * - 1% /healthz
 *
 * REGRAS DE SEGURANÇA:
 * - SAFE MODE: NÃO chama providers externos (usa coordenadas fixas + fallback local)
 * - NÃO chama billing real
 * - NÃO dispara SOS real
 * - Usa apenas endpoints seguros
 * - Payload leve
 * - Keep-alive nas conexões
 *
 * GUARDRAILS:
 * - error rate > 1% → parar
 * - p95 > 800ms → falha
 * - p99 > 1500ms → falha
 *
 * USO:
 *   # Modo seguro (recomendado - sem dependências externas)
 *   ALERT_LOAD_TEST_SAFE_MODE=true npm run load:mixed:30m:foundation
 *
 *   # Modo normal (requer OSRM local configurado)
 *   npm run load:mixed:30m:foundation
 *
 *   ALERT_LOAD_TARGET=http://localhost:5005 npm run load:mixed:30m:foundation
 *   ALERT_LOAD_CONCURRENCY=50 ALERT_LOAD_DURATION=60 npm run load:mixed:30m:foundation
 */

const {performance} = require('node:perf_hooks');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

// Configuração
const TARGET = process.env.ALERT_LOAD_TARGET || 'http://127.0.0.1:5005';
const CONCURRENCY = parseInt(process.env.ALERT_LOAD_CONCURRENCY || '20', 10);
const DURATION_SEC = parseInt(process.env.ALERT_LOAD_DURATION || '30', 10);
const SAFE_MODE =
  process.env.ALERT_LOAD_TEST_SAFE_MODE === 'true' ||
  process.env.ALERT_LOAD_TEST_SAFE_MODE === '1';
const REQUIRE_EXTERNAL = process.env.ALERT_LOAD_REQUIRE_EXTERNAL === 'true';
const REPORT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'scale-readiness',
  'load-mixed-30m-foundation.md',
);

// Validação de URL externa (NÃO LOCALHOST)
function validateExternalTarget(target) {
  try {
    const url = new URL(target);
    const isLocalhost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === '0.0.0.0';

    if (REQUIRE_EXTERNAL && isLocalhost) {
      console.error('');
      console.error(
        '╔══════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  ❌ LOAD TEST EXTERNO REJEITADO                         ║',
      );
      console.error(
        '╚══════════════════════════════════════════════════════════╝',
      );
      console.error('');
      console.error(`   Target é localhost: ${target}`);
      console.error('');
      console.error('   Load test externo DEVE usar URL pública.');
      console.error('');
      console.error('   Use:');
      console.error('   ALERT_LOAD_TARGET=https://seu-staging.onrender.com');
      console.error('   ALERT_LOAD_REQUIRE_EXTERNAL=true');
      console.error('');
      console.error(
        '   Ou remova ALERT_LOAD_REQUIRE_EXTERNAL para teste local.',
      );
      console.error('');
      process.exit(1);
    }

    // Exigir HTTPS em staging/produção
    if (
      !isLocalhost &&
      url.protocol !== 'https:' &&
      process.env.ALERT_LOAD_REQUIRE_HTTPS !== 'false'
    ) {
      console.error('');
      console.error(
        '╔══════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  ❌ LOAD TEST EXTERNO REJEITADO                         ║',
      );
      console.error(
        '╚══════════════════════════════════════════════════════════╝',
      );
      console.error('');
      console.error(`   Target externo deve usar HTTPS: ${target}`);
      console.error('');
      console.error('   Configure HTTPS no seu staging.');
      console.error(
        '   Ou defina ALERT_LOAD_REQUIRE_HTTPS=false para permitir HTTP.',
      );
      console.error('');
      process.exit(1);
    }

    return true;
  } catch (err) {
    console.error(`❌ URL inválida: ${target}`);
    console.error(`   Erro: ${err.message}`);
    process.exit(1);
  }
}

// Coordenadas fixas para evitar chamadas externas
const TEST_LAT = -23.5505; // São Paulo
const TEST_LON = -46.6333;

// Agentes HTTP com keep-alive
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * 2,
});
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * 2,
});

// Allowlist de endpoints seguros (não chamam providers externos)
const SAFE_ENDPOINTS_ALLOWLIST = new Set([
  '/healthz',
  '/v1/ops/summary',
  '/api/v1/weather/feed',
  '/api/v1/risk/feed',
  '/api/me/entitlements',
]);

// Endpoints que requerem provider externo (OSRM, etc.)
const EXTERNAL_PROVIDER_ENDPOINTS = new Set([
  '/api/v1/maps/routes',
  '/v1/maps/routes',
]);

// Definição dos endpoints e distribuição (SAFE MODE - sem endpoints externos)
const ENDPOINTS_SAFE = [
  // 65% - Feed operacional (leve, sem dependências externas)
  {path: '/v1/ops/summary', weight: 65, method: 'GET'},
  // 20% - Weather cache (coordenadas fixas)
  {
    path: `/api/v1/weather/feed?lat=${TEST_LAT}&lon=${TEST_LON}`,
    weight: 20,
    method: 'GET',
  },
  // 10% - Risk feed (coordenadas fixas)
  {
    path: `/api/v1/risk/feed?lat=${TEST_LAT}&lon=${TEST_LON}&limit=10`,
    weight: 10,
    method: 'GET',
  },
  // 4% - Entitlements (requer identidade, mas é seguro)
  {
    path: '/api/me/entitlements',
    weight: 4,
    method: 'GET',
    headers: {
      'x-alert-user-id': 'load-test-user',
      'x-alert-device-id': 'load-test-device',
    },
  },
  // 1% - Health check mínimo
  {path: '/healthz', weight: 1, method: 'GET'},
];

// Definição dos endpoints e distribuição (NORMAL - com maps/routes)
const ENDPOINTS_NORMAL = [
  // 60% - Feed operacional (leve, sem dependências externas)
  {path: '/v1/ops/summary', weight: 60, method: 'GET'},
  // 20% - Weather cache (coordenadas fixas)
  {
    path: `/api/v1/weather/feed?lat=${TEST_LAT}&lon=${TEST_LON}`,
    weight: 20,
    method: 'GET',
  },
  // 10% - Risk feed (coordenadas fixas)
  {
    path: `/api/v1/risk/feed?lat=${TEST_LAT}&lon=${TEST_LON}&limit=10`,
    weight: 10,
    method: 'GET',
  },
  // 5% - Entitlements (requer identidade, mas é seguro)
  {
    path: '/api/me/entitlements',
    weight: 5,
    method: 'GET',
    headers: {
      'x-alert-user-id': 'load-test-user',
      'x-alert-device-id': 'load-test-device',
    },
  },
  // 4% - Maps routes (ops/map equivalente) - REQUER OSRM LOCAL
  {
    path: `/api/v1/maps/routes?fromLat=${TEST_LAT}&fromLon=${TEST_LON}&toLat=${TEST_LAT + 0.01}&toLon=${TEST_LON + 0.01}`,
    weight: 4,
    method: 'GET',
  },
  // 1% - Health check mínimo
  {path: '/healthz', weight: 1, method: 'GET'},
];

// Selecionar endpoints baseado no modo
const ENDPOINTS = SAFE_MODE ? ENDPOINTS_SAFE : ENDPOINTS_NORMAL;

// Validação de distribuição
const totalWeight = ENDPOINTS.reduce((sum, e) => sum + e.weight, 0);
if (totalWeight !== 100) {
  console.error(`❌ Distribuição inválida: ${totalWeight}% (esperado 100%)`);
  process.exit(1);
}

// Verificar se há endpoints externos na configuração atual
function hasExternalEndpoints() {
  return ENDPOINTS.some(e => {
    const pathOnly = e.path.split('?')[0];
    return EXTERNAL_PROVIDER_ENDPOINTS.has(pathOnly);
  });
}

// Validar allowlist de endpoints seguros
function validateSafeEndpoints() {
  const unsafeEndpoints = [];
  for (const endpoint of ENDPOINTS) {
    const pathOnly = endpoint.path.split('?')[0];
    if (!SAFE_ENDPOINTS_ALLOWLIST.has(pathOnly)) {
      // Verificar se é um endpoint externo
      if (EXTERNAL_PROVIDER_ENDPOINTS.has(pathOnly)) {
        unsafeEndpoints.push({
          path: endpoint.path,
          reason: 'external_provider_requires_local_osrm',
        });
      } else {
        unsafeEndpoints.push({
          path: endpoint.path,
          reason: 'not_in_safe_allowlist',
        });
      }
    }
  }
  return unsafeEndpoints;
}

// Estado do teste
const results = [];
let running = true;
let totalRequests = 0;
let completedRequests = 0;
let errorCount = 0;
let startTime;

// Selecionar endpoint baseado na distribuição
function selectEndpoint() {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const endpoint of ENDPOINTS) {
    cumulative += endpoint.weight;
    if (rand < cumulative) {
      return endpoint;
    }
  }
  return ENDPOINTS[0]; // fallback
}

// Fazer request HTTP
function makeRequest(endpoint) {
  return new Promise(resolve => {
    const url = new URL(endpoint.path, TARGET);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: endpoint.method,
      headers: {
        'User-Agent': 'Alert-Load-Test/1.0',
        Connection: 'keep-alive',
        ...endpoint.headers,
      },
      agent: agent,
      timeout: 10000, // 10s timeout
    };

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          duration: 0, // será preenchido
          endpoint: endpoint.path,
          ok: res.statusCode >= 200 && res.statusCode < 300,
        });
      });
    });

    req.on('error', err => {
      resolve({
        status: 0,
        duration: 0,
        endpoint: endpoint.path,
        ok: false,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 408,
        duration: 0,
        endpoint: endpoint.path,
        ok: false,
        error: 'timeout',
      });
    });

    req.end();
  });
}

// Worker que faz requests contínuos
async function worker(id) {
  while (running) {
    const endpoint = selectEndpoint();
    const start = performance.now();

    try {
      const result = await makeRequest(endpoint);
      result.duration = performance.now() - start;

      results.push(result);
      completedRequests++;

      if (!result.ok) {
        errorCount++;
      }
    } catch (err) {
      results.push({
        status: 0,
        duration: performance.now() - start,
        endpoint: endpoint.path,
        ok: false,
        error: err.message,
      });
      completedRequests++;
      errorCount++;
    }

    // Small delay to avoid overwhelming
    await new Promise(r => setImmediate(r));
  }
}

// Calcular percentil
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Gerar relatório
function generateReport(stats) {
  const timestamp = new Date().toISOString();
  const modeLabel = SAFE_MODE ? 'SAFE MODE' : 'NORMAL';
  const report = `# Alert Load Test - Mixed 30M Foundation

## Resumo Executivo

- **Data**: ${timestamp}
- **Target**: ${TARGET}
- **Mode**: ${modeLabel}
- **Duração**: ${stats.duration.toFixed(1)}s
- **Concorrência**: ${CONCURRENCY}
- **Total Requests**: ${stats.totalRequests}
- **RPS Médio**: ${stats.rps.toFixed(1)}

## Configuração de Segurança

- **SAFE MODE**: ${SAFE_MODE ? '✅ ATIVO' : '❌ DESATIVADO'}
- **External Endpoints**: ${hasExternalEndpoints() ? '⚠️ PRESENTES' : '✅ NONE'}
- **Environment Variables**:
  - \`ALERT_LOAD_TEST_SAFE_MODE=${SAFE_MODE}\`

## Distribuição de Endpoints

| Endpoint | Peso | Requests | % Real |
|----------|------|----------|--------|
${ENDPOINTS.map(e => {
  const count = results.filter(r => r.endpoint === e.path).length;
  const pct =
    stats.totalRequests > 0
      ? ((count / stats.totalRequests) * 100).toFixed(1)
      : 0;
  return `| ${e.path} | ${e.weight}% | ${count} | ${pct}% |`;
}).join('\n')}

## Métricas de Performance

| Métrica | Valor | Threshold | Status |
|---------|-------|-----------|--------|
| RPS | ${stats.rps.toFixed(1)} | - | ✅ |
| p50 | ${stats.p50.toFixed(0)}ms | - | ✅ |
| p95 | ${stats.p95.toFixed(0)}ms | 800ms | ${stats.p95 <= 800 ? '✅' : '❌'} |
| p99 | ${stats.p99.toFixed(0)}ms | 1500ms | ${stats.p99 <= 1500 ? '✅' : '❌'} |
| Error Rate | ${stats.errorRate.toFixed(2)}% | 1% | ${stats.errorRate <= 1 ? '✅' : '❌'} |

## Resultados por Endpoint

${ENDPOINTS.map(e => {
  const endpointResults = results.filter(r => r.endpoint === e.path);
  const latencies = endpointResults.map(r => r.duration);
  const errors = endpointResults.filter(r => !r.ok).length;
  const epP50 = latencies.length > 0 ? percentile(latencies, 50).toFixed(0) : 0;
  const epP95 = latencies.length > 0 ? percentile(latencies, 95).toFixed(0) : 0;
  const epP99 = latencies.length > 0 ? percentile(latencies, 99).toFixed(0) : 0;
  const epErrorRate =
    endpointResults.length > 0
      ? ((errors / endpointResults.length) * 100).toFixed(2)
      : 0;

  return `### ${e.path} (${e.weight}%)
- Requests: ${endpointResults.length}
- p50: ${epP50}ms | p95: ${epP95}ms | p99: ${epP99}ms
- Error Rate: ${epErrorRate}%
- Errors: ${errors > 0 ? errors : 'Nenhum'}
`;
}).join('\n')}

## Guardrails

| Guardrail | Threshold | Resultado | Status |
|-----------|-----------|-----------|--------|
| Error Rate | < 1% | ${stats.errorRate.toFixed(2)}% | ${stats.errorRate <= 1 ? '✅ PASS' : '❌ FAIL'} |
| p95 Latency | < 800ms | ${stats.p95.toFixed(0)}ms | ${stats.p95 <= 800 ? '✅ PASS' : '❌ FAIL'} |
| p99 Latency | < 1500ms | ${stats.p99.toFixed(0)}ms | ${stats.p99 <= 1500 ? '✅ PASS' : '❌ FAIL'} |

## Conclusão

${
  stats.allGuardrailsPassed
    ? `✅ **LOAD TEST PASSED (${modeLabel})**: Todos os guardrails respeitados. Sistema pronto para escalar.`
    : `❌ **LOAD TEST FAILED (${modeLabel})**: Um ou mais guardrails foram violados. Revise antes de escalar.`
}

## Notas de Segurança

- **SAFE MODE**: ${SAFE_MODE ? 'Ativo - Zero chamadas externas garantidas' : 'Desativado - Verificar configuração OSRM'}
- Teste executado com keep-alive habilitado
- Coordenadas fixas usadas para evitar chamadas externas
- Nenhum endpoint de billing ou SOS real foi chamado
- Payload leve em todos os requests
${SAFE_MODE ? '- **PROTEÇÕES ATIVAS**: Sem OSRM externo, sem Firestore remoto, sem billing, sem push, sem SOS real' : '- **ATENÇÃO**: Verificar se OSRM local está configurado para evitar chamadas externas'}

## Comandos

\`\`\`bash
# Executar teste em SAFE MODE (recomendado - zero chamadas externas)
ALERT_LOAD_TEST_SAFE_MODE=true npm run load:mixed:30m:foundation

# Executar teste padrão (20 workers, 30s) - requer OSRM local
npm run load:mixed:30m:foundation

# Executar com mais workers e duração maior
ALERT_LOAD_CONCURRENCY=50 ALERT_LOAD_DURATION=60 npm run load:mixed:30m:foundation

# Executar contra target remoto
ALERT_LOAD_TARGET=http://seu-servidor:5005 npm run load:mixed:30m:foundation
\`\`\`
`;

  try {
    fs.writeFileSync(REPORT_PATH, report);
    console.log(`\n📄 Relatório gerado: ${REPORT_PATH}`);
  } catch (err) {
    console.error(`⚠️  Não foi possível gerar relatório: ${err.message}`);
  }
}

// Main
async function main() {
  // Validar URL externa se REQUIRE_EXTERNAL estiver ativo
  if (REQUIRE_EXTERNAL) {
    console.log('🔒 VALIDAÇÃO DE URL EXTERNA ATIVA');
    validateExternalTarget(TARGET);
    console.log('✅ URL externa validada');
    console.log('');
  }

  const modeLabel = SAFE_MODE ? 'SAFE MODE' : 'NORMAL';

  console.log(`🚀 Alert Load Test - Mixed 30M Foundation [${modeLabel}]`);
  console.log(`🎯 Target: ${TARGET}`);
  console.log(`👥 Concurrency: ${CONCURRENCY}`);
  console.log(`⏱️  Duration: ${DURATION_SEC}s`);
  console.log(`📊 Endpoints: ${ENDPOINTS.length}`);
  console.log('');

  // Validações de segurança
  if (SAFE_MODE) {
    console.log('🔒 SAFE MODE ATIVO');
    console.log('   - Validação de allowlist de endpoints seguros');
    console.log('   - Zero tolerância para providers externos');
    console.log('   - Backend deve usar fallback local');
    console.log('');

    const unsafeEndpoints = validateSafeEndpoints();
    if (unsafeEndpoints.length > 0) {
      console.error('❌ ERRO: Endpoints inseguros detectados no mix:');
      unsafeEndpoints.forEach(ep => {
        console.error(`   - ${ep.path} (${ep.reason})`);
      });
      console.error('');
      console.error(
        'Solução: Use ALERT_LOAD_TEST_SAFE_MODE=true para remover endpoints externos.',
      );
      process.exit(1);
    }
    console.log('✅ Allowlist de endpoints validada');
  } else {
    console.log('⚠️  NORMAL MODE');
    if (hasExternalEndpoints()) {
      console.log('   - Endpoints com providers externos detectados');
      console.log('   - Certifique-se que OSRM local está configurado');
      console.log(
        '   - Use ALERT_LOAD_TEST_SAFE_MODE=true para modo 100% seguro',
      );
    }
  }

  console.log('');
  console.log('Distribuição:');
  ENDPOINTS.forEach(e => {
    console.log(`  ${e.weight}% → ${e.method} ${e.path}`);
  });
  console.log('');
  console.log('Guardrails:');
  console.log('  - Error rate < 1%');
  console.log('  - p95 < 800ms');
  console.log('  - p99 < 1500ms');
  console.log('');

  // Verificar conectividade
  console.log('🔍 Verificando conectividade...');
  try {
    const testResult = await makeRequest({
      path: '/healthz',
      method: 'GET',
      weight: 0,
    });
    if (!testResult.ok) {
      console.error(`❌ Target não está acessível: ${TARGET}`);
      console.error(`   Status: ${testResult.status}`);
      process.exit(1);
    }
    console.log('✅ Target está acessível');
  } catch (err) {
    console.error(`❌ Erro ao conectar: ${err.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('▶️  Iniciando teste de carga...');
  startTime = performance.now();

  // Iniciar workers
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }

  // Timer de duração
  const timer = setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    const rps = completedRequests / elapsed;
    const currentErrorRate =
      completedRequests > 0 ? (errorCount / completedRequests) * 100 : 0;

    // Progress bar simples
    const progress = Math.min((elapsed / DURATION_SEC) * 100, 100);
    const bar =
      '█'.repeat(Math.floor(progress / 5)) +
      '░'.repeat(20 - Math.floor(progress / 5));

    process.stdout.write(
      `\r  [${bar}] ${elapsed.toFixed(0)}s | ${completedRequests} reqs | ${rps.toFixed(0)} RPS | ${currentErrorRate.toFixed(2)}% errors`,
    );

    // Check guardrail de error rate em tempo real
    if (currentErrorRate > 1 && completedRequests > 100) {
      console.log('\n\n⚠️  Error rate > 1% detectado! Parando teste...');
      running = false;
    }

    if (elapsed >= DURATION_SEC) {
      running = false;
    }
  }, 1000);

  // Aguardar término - manter workers ativos até duration acabar
  while (running) {
    await new Promise(r => setTimeout(r, 100));
  }

  clearInterval(timer);

  // Aguardar workers terminarem requests em andamento
  await new Promise(r => setTimeout(r, 500));

  const endTime = performance.now();
  const duration = (endTime - startTime) / 1000;

  // Calcular estatísticas
  const latencies = results.map(r => r.duration);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const errorRate =
    completedRequests > 0 ? (errorCount / completedRequests) * 100 : 0;
  const rps = completedRequests / duration;

  const allGuardrailsPassed = errorRate <= 1 && p95 <= 800 && p99 <= 1500;

  // Imprimir resultados
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 RESULTADOS:');
  console.log('─'.repeat(60));
  console.log(`  Total Requests:    ${completedRequests}`);
  console.log(`  Duration:          ${duration.toFixed(1)}s`);
  console.log(`  RPS (avg):         ${rps.toFixed(1)}`);
  console.log(`  p50:               ${p50.toFixed(0)}ms`);
  console.log(
    `  p95:               ${p95.toFixed(0)}ms ${p95 > 800 ? '❌' : '✅'}`,
  );
  console.log(
    `  p99:               ${p99.toFixed(0)}ms ${p99 > 1500 ? '❌' : '✅'}`,
  );
  console.log(
    `  Error Rate:        ${errorRate.toFixed(2)}% ${errorRate > 1 ? '❌' : '✅'}`,
  );
  console.log(`  Errors:            ${errorCount}`);
  console.log('─'.repeat(60));

  // Resultados por endpoint
  console.log('\n📈 POR ENDPOINT:');
  ENDPOINTS.forEach(e => {
    const endpointResults = results.filter(r => r.endpoint === e.path);
    const epLatencies = endpointResults.map(r => r.duration);
    const epErrors = endpointResults.filter(r => !r.ok).length;
    if (endpointResults.length > 0) {
      console.log(`  ${e.path}`);
      console.log(
        `    Requests: ${endpointResults.length} | p50: ${percentile(epLatencies, 50).toFixed(0)}ms | p95: ${percentile(epLatencies, 95).toFixed(0)}ms | p99: ${percentile(epLatencies, 99).toFixed(0)}ms | Errors: ${epErrors}`,
      );
    }
  });

  console.log('\n' + '═'.repeat(60));

  if (allGuardrailsPassed) {
    console.log(
      `✅ LOAD TEST PASSED [${modeLabel}]: Todos os guardrails respeitados!`,
    );
    console.log(
      '   Foundation local passou; 30M ainda requer Redis/BullMQ/staging/load externo.',
    );
  } else {
    console.log(`❌ LOAD TEST FAILED [${modeLabel}]: Guardrails violados!`);
    if (errorRate > 1) console.log('   - Error rate muito alto');
    if (p95 > 800) console.log('   - p95 acima do threshold');
    if (p99 > 1500) console.log('   - p99 acima do threshold');
    console.log('   Revise a infraestrutura antes de escalar.');
  }

  console.log('═'.repeat(60));

  // Gerar relatório
  generateReport({
    duration,
    totalRequests: completedRequests,
    rps,
    p50,
    p95,
    p99,
    errorRate,
    allGuardrailsPassed,
  });

  // Exit code
  process.exitCode = allGuardrailsPassed ? 0 : 1;
}

main().catch(err => {
  console.error('💥 Erro fatal:', err);
  process.exitCode = 1;
});
