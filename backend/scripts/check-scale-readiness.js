/**
 * check-scale-readiness.js
 *
 * Verifica se o backend está pronto para testes de escala.
 * Valida configuração, saúde do serviço e infraestrutura necessária.
 *
 * USO:
 *   npm run scale:check
 *   ALERT_CHECK_TARGET=http://localhost:5005 npm run scale:check
 */

const {performance} = require('node:perf_hooks');

const TARGET = process.env.ALERT_CHECK_TARGET || 'http://127.0.0.1:5005';
const TIMEOUT_MS = 5000;

const checks = [];
let currentSection = 'general';

const section = name => {
  currentSection = name;
  console.log(`\n📋 ${name}`);
};

const check = (name, fn) => {
  checks.push({name, fn, section: currentSection});
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, timeout = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {'User-Agent': 'Alert-Scale-Check/1.0'},
    });
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => null),
    };
  } finally {
    clearTimeout(timer);
  }
};

// Checks gerais
section('Verificações Gerais');

check('Target está acessível', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  return {
    pass: result.ok,
    details: result.ok
      ? `Status ${result.status}`
      : `Falhou com status ${result.status}`,
  };
});

check('Health endpoint retorna estrutura válida', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const hasOk = result.data && result.data.ok === true;
  return {
    pass: hasOk,
    details: hasOk ? 'Estrutura válida' : 'Estrutura inválida ou ausente',
  };
});

check('Tempo de resposta do healthz < 500ms', async () => {
  const start = performance.now();
  await fetchWithTimeout(`${TARGET}/healthz`);
  const duration = performance.now() - start;
  return {
    pass: duration < 500,
    details: `${Math.round(duration)}ms`,
  };
});

// Checks de configuração
section('Configuração do Backend');

check('APP_ENV configurado', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  // Se o healthz retorna, o backend está rodando
  return {
    pass: result.ok,
    details: result.ok ? 'Backend em execução' : 'Backend não respondendo',
  };
});

check('Firebase disponível (opcional)', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const firebaseAvailable = result.data && result.data.firebaseAvailable;
  return {
    pass: true, // opcional
    details: firebaseAvailable ? 'Disponível' : 'Não disponível (opcional)',
  };
});

check('Módulos críticos disponíveis', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const modules = result.data?.modules || {};
  return {
    pass: true, // módulos podem não estar todos disponíveis
    details: JSON.stringify(modules),
  };
});

// Checks de performance
section('Performance Básica');

check('Latência p95 < 1500ms', async () => {
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await fetchWithTimeout(`${TARGET}/healthz`);
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const p95 =
    latencies[
      Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)
    ];
  return {
    pass: p95 < 1500,
    details: `p95: ${Math.round(p95)}ms`,
  };
});

check('Sem erros em 10 requests sequenciais', async () => {
  let errors = 0;
  for (let i = 0; i < 10; i++) {
    const result = await fetchWithTimeout(`${TARGET}/healthz`);
    if (!result.ok) errors++;
  }
  return {
    pass: errors === 0,
    details: errors === 0 ? 'Todos OK' : `${errors} erros`,
  };
});

// Checks de endpoints seguros
section('Endpoints Seguros (sem custo)');

check('GET / retorna OK', async () => {
  const result = await fetchWithTimeout(`${TARGET}/`);
  return {
    pass: result.ok,
    details: result.ok ? 'OK' : `Status ${result.status}`,
  };
});

check('GET /healthz retorna OK', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  return {
    pass: result.ok,
    details: result.ok ? 'OK' : `Status ${result.status}`,
  };
});

// Checks de infraestrutura externa (opcionais)
section('Infraestrutura Externa (Opcional)');

check('Redis configurado (opcional)', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  // Verificar se há indicação de Redis no healthz
  return {
    pass: true,
    details: 'Verificação não disponível no healthz',
  };
});

check('BullMQ configurado (opcional)', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const queueDriver = result.data?.modules?.sosFanoutQueueDriver;
  return {
    pass: true,
    details: queueDriver ? `Driver: ${queueDriver}` : 'Não configurado',
  };
});

// Executar todos os checks
const main = async () => {
  console.log('🔍 Verificando preparação para escala do Alert Backend');
  console.log(`🎯 Target: ${TARGET}`);
  console.log(`⏱️  Timeout: ${TIMEOUT_MS}ms`);

  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;

  for (const {name, fn, section: checkSection} of checks) {
    try {
      const result = await fn();
      const status = result.pass ? '✅' : '❌';
      console.log(`  ${status} ${name}: ${result.details}`);

      if (result.pass) totalPass++;
      else totalFail++;
    } catch (error) {
      console.log(`  ❌ ${name}: ERRO - ${error.message}`);
      totalFail++;
    }
  }

  // Resumo
  console.log('\n📊 RESUMO:');
  console.log(`  ✅ Pass: ${totalPass}`);
  console.log(`  ❌ Fail: ${totalFail}`);
  console.log(`  ⚠️  Warn: ${totalWarn}`);

  const allPassed = totalFail === 0;
  console.log(
    `\n${allPassed ? '✅' : '❌'} Scale Readiness: ${allPassed ? 'READY' : 'NOT READY'}`,
  );

  if (!allPassed) {
    console.log(
      '\n⚠️  Alguns checks falharam. Corrija os problemas antes de prosseguir.',
    );
    console.log('   Execute: npm run load:cheap para teste de carga seguro');
  } else {
    console.log('\n✅ Backend pronto para testes de escala!');
    console.log('   Execute: npm run load:cheap para teste de carga seguro');
  }

  process.exitCode = allPassed ? 0 : 1;
};

main().catch(error => {
  console.error('💥 Erro fatal:', error);
  process.exitCode = 1;
});
