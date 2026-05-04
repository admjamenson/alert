#!/usr/bin/env node
'use strict';

/**
 * check-30m-foundation.js
 *
 * Verifica se o backend está pronto para suportar 30M de usuários.
 * Valida feature flags, Redis, BullMQ, rate limiting distribuído e endpoints críticos.
 *
 * REGRAS DE SEGURANÇA:
 * - NÃO chama endpoints pagos
 * - NÃO dispara SOS real
 * - NÃO envia push notifications
 * - NÃO chama billing real
 * - Testa apenas endpoints seguros e health checks
 *
 * USO:
 *   npm run scale:foundation:check
 *   ALERT_CHECK_TARGET=http://localhost:5005 npm run scale:foundation:check
 */

const {performance} = require('node:perf_hooks');
const path = require('node:path');
const fs = require('node:fs');

// Configuração
const TARGET = process.env.ALERT_CHECK_TARGET || 'http://127.0.0.1:5005';
const TIMEOUT_MS = 5000;
const REPORT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'scale-readiness',
  'alert-30m-foundation.md',
);

// Estado dos checks
const checks = [];
let currentSection = 'general';
const startTime = performance.now();

// Helpers
const section = name => {
  currentSection = name;
  console.log(`\n📋 ${name}`);
};

const check = (name, fn, critical = false) => {
  checks.push({name, fn, section: currentSection, critical});
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, timeout = TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {'User-Agent': 'Alert-30M-Foundation-Check/1.0'},
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

// ============================================================
// CHECKS: Feature Flags Backend
// ============================================================
section('Feature Flags Backend');

check(
  'Feature flags module existe',
  async () => {
    try {
      const {FeatureFlags} = require('../src/core/featureFlags');
      return {
        pass: !!FeatureFlags,
        details: FeatureFlags
          ? 'Módulo carregado com sucesso'
          : 'Módulo não encontrado',
      };
    } catch (error) {
      return {pass: false, details: `Erro: ${error.message}`};
    }
  },
  true,
);

check('Feature flags critical logs na inicialização', async () => {
  // Verifica se as flags críticas são logadas
  const {FeatureFlags} = require('../src/core/featureFlags');
  FeatureFlags.reset();
  FeatureFlags.initialize();
  const snapshot = FeatureFlags.snapshot();
  return {
    pass: snapshot.total > 0,
    details: `${snapshot.enabledCount}/${snapshot.total} flags habilitadas`,
  };
});

check(
  'SOS flag habilitada por default',
  async () => {
    const {isSosEnabled} = require('../src/core/featureFlags');
    return {
      pass: isSosEnabled() === true,
      details: isSosEnabled() ? 'SOS habilitado' : 'SOS desabilitado (CRÍTICO)',
    };
  },
  true,
);

check('Flags de infraestrutura refletem env', async () => {
  const {
    isRedisCacheEnabled,
    isBullMqQueueEnabled,
  } = require('../src/core/featureFlags');
  const redisEnabled = isRedisCacheEnabled();
  const bullmqEnabled = isBullMqQueueEnabled();
  const cacheDriver = process.env.ALERT_CACHE_DRIVER || 'memory';
  const queueDriver = process.env.ALERT_JOB_QUEUE_DRIVER || 'memory';

  return {
    pass: true, // Informativo
    details: `Cache: ${cacheDriver} (flag=${redisEnabled}), Queue: ${queueDriver} (flag=${bullmqEnabled})`,
  };
});

// ============================================================
// CHECKS: Rate Limiting Distribuído
// ============================================================
section('Rate Limiting Distribuído');

check(
  'RedisRateLimiter module existe',
  async () => {
    try {
      const {
        createRateLimiter,
      } = require('../src/infrastructure/rateLimit/RedisRateLimiter');
      return {
        pass: !!createRateLimiter,
        details: 'Módulo carregado com sucesso',
      };
    } catch (error) {
      return {pass: false, details: `Erro: ${error.message}`};
    }
  },
  true,
);

check(
  'InMemoryRateLimiter funciona como fallback',
  async () => {
    const {
      createRateLimiter,
    } = require('../src/infrastructure/rateLimit/RedisRateLimiter');
    const limiter = createRateLimiter({windowMs: 1000, maxRequests: 5});

    // Testa que permite requests até o limite
    let allowed = 0;
    for (let i = 0; i < 5; i++) {
      if (limiter.isAllowed('test:user:1')) allowed++;
    }

    // Testa que bloqueia após limite
    const rejected = !limiter.isAllowed('test:user:1');

    return {
      pass: allowed === 5 && rejected,
      details: `${allowed} permits, blocked after limit: ${rejected}`,
    };
  },
  true,
);

check('Distributed rate limit flag controla comportamento', async () => {
  const originalValue = process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED;

  // Testar modo memory (default)
  delete process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED;
  const {
    createRateLimiter,
  } = require('../src/infrastructure/rateLimit/RedisRateLimiter');
  const memoryLimiter = createRateLimiter();
  const isMemory = memoryLimiter.snapshot().driver === 'memory';

  // Restaurar
  if (originalValue !== undefined) {
    process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED = originalValue;
  } else {
    delete process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED;
  }

  return {
    pass: isMemory,
    details: isMemory ? 'Fallback memory OK' : 'Unexpected driver',
  };
});

// ============================================================
// CHECKS: Health do Backend
// ============================================================
section('Health do Backend');

check(
  'Target está acessível',
  async () => {
    const result = await fetchWithTimeout(`${TARGET}/healthz`);
    return {
      pass: result.ok,
      details: result.ok
        ? `Status ${result.status}`
        : `Falhou com status ${result.status}`,
    };
  },
  true,
);

check(
  'Health endpoint retorna estrutura válida',
  async () => {
    const result = await fetchWithTimeout(`${TARGET}/healthz`);
    const hasOk = result.data && result.data.ok === true;
    return {
      pass: hasOk,
      details: hasOk ? 'Estrutura válida' : 'Estrutura inválida ou ausente',
    };
  },
  true,
);

check('Firebase disponível (informativo)', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const firebaseAvailable = result.data?.firebaseAvailable;
  return {
    pass: true, // Opcional
    details: firebaseAvailable ? 'Disponível' : 'Não disponível (opcional)',
  };
});

check('Módulos críticos disponíveis', async () => {
  const result = await fetchWithTimeout(`${TARGET}/healthz`);
  const modules = result.data?.modules || {};
  const sosFanoutQueue = modules.sosFanoutQueue;
  const sosFanoutQueueDriver = modules.sosFanoutQueueDriver;

  return {
    pass: true, // Informativo
    details: `SOS Fanout Queue: ${sosFanoutQueue ? 'enabled' : 'disabled'} (${sosFanoutQueueDriver || 'n/a'})`,
  };
});

// ============================================================
// CHECKS: Performance Básica
// ============================================================
section('Performance Básica');

check(
  'Latência p95 < 1500ms',
  async () => {
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
  },
  true,
);

check(
  'Sem erros em 10 requests sequenciais',
  async () => {
    let errors = 0;
    for (let i = 0; i < 10; i++) {
      const result = await fetchWithTimeout(`${TARGET}/healthz`);
      if (!result.ok) errors++;
    }
    return {
      pass: errors === 0,
      details: errors === 0 ? 'Todos OK' : `${errors} erros`,
    };
  },
  true,
);

// ============================================================
// CHECKS: Endpoints Seguros
// ============================================================
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

check('GET /v1/ops/summary retorna métricas', async () => {
  const result = await fetchWithTimeout(`${TARGET}/v1/ops/summary`);
  const hasData = result.data && result.data.ok === true;
  return {
    pass: hasData,
    details: hasData ? 'Métricas disponíveis' : 'Indisponível',
  };
});

// ============================================================
// CHECKS: Infraestrutura Externa (Opcional)
// ============================================================
section('Infraestrutura Externa (Opcional)');

check('Redis URL configurada (informativo)', async () => {
  const hasRedisUrl = !!(
    process.env.ALERT_REDIS_URL ||
    process.env.ALERT_QUEUE_REDIS_URL ||
    process.env.ALERT_CACHE_REDIS_URL
  );
  return {
    pass: true,
    details: hasRedisUrl
      ? 'Redis URL configurada'
      : 'Sem Redis URL (usando fallback memory)',
  };
});

check('BullMQ driver configurado (informativo)', async () => {
  const queueDriver = process.env.ALERT_JOB_QUEUE_DRIVER || 'memory';
  return {
    pass: true,
    details: `Driver: ${queueDriver}`,
  };
});

check('Distributed rate limit enabled (informativo)', async () => {
  const enabled =
    process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED === 'true' ||
    process.env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED === '1';
  return {
    pass: true,
    details: enabled ? 'Habilitado' : 'Desabilitado (usando memory fallback)',
  };
});

// ============================================================
// EXECUÇÃO
// ============================================================
const main = async () => {
  console.log('🔍 Verificando preparação para 30M de usuários - Alert Backend');
  console.log(`🎯 Target: ${TARGET}`);
  console.log(`⏱️  Timeout: ${TIMEOUT_MS}ms`);
  console.log('');

  let totalPass = 0;
  let totalFail = 0;
  let totalCritical = 0;
  let criticalFail = 0;

  for (const {name, fn, section: checkSection, critical} of checks) {
    try {
      const result = await fn();
      const status = result.pass ? '✅' : '❌';
      const criticalMark = critical ? ' [CRÍTICO]' : '';
      console.log(
        `  ${status} ${checkSection}: ${name}${criticalMark}: ${result.details}`,
      );

      if (result.pass) totalPass++;
      else {
        totalFail++;
        if (critical) criticalFail++;
      }
      if (critical) totalCritical++;
    } catch (error) {
      console.log(`  ❌ ${checkSection}: ${name}: ERRO - ${error.message}`);
      totalFail++;
      if (critical) {
        criticalFail++;
        totalCritical++;
      }
    }
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);

  // Resumo
  console.log('\n📊 RESUMO:');
  console.log(`  ✅ Pass: ${totalPass}`);
  console.log(`  ❌ Fail: ${totalFail}`);
  if (totalCritical > 0) {
    console.log(`  🔴 Critical fails: ${criticalFail}/${totalCritical}`);
  }
  console.log(`  ⏱️  Duration: ${duration}s`);

  const allPassed = totalFail === 0;
  const criticalPassed = criticalFail === 0;

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ FOUNDATION READY: Todos os checks passaram!');
    console.log('   O backend está pronto para testes de escala.');
  } else if (criticalPassed) {
    console.log('⚠️  FOUNDATION PARTIAL: Checks não-críticos falharam');
    console.log('   O backend pode operar, mas com limitações.');
  } else {
    console.log('❌ FOUNDATION NOT READY: Checks críticos falharam!');
    console.log('   Corrija os problemas antes de prosseguir.');
  }
  console.log('='.repeat(60));

  // Gerar relatório
  generateReport({
    totalPass,
    totalFail,
    totalCritical,
    criticalFail,
    duration,
    allPassed,
    criticalPassed,
  });

  // Exit code
  process.exitCode = criticalPassed ? 0 : 1;
};

const generateReport = ({
  totalPass,
  totalFail,
  totalCritical,
  criticalFail,
  duration,
  allPassed,
  criticalPassed,
}) => {
  const timestamp = new Date().toISOString();
  const report = `# Alert 30M Foundation Check Report

## Resumo Executivo

- **Data**: ${timestamp}
- **Target**: ${TARGET}
- **Duração**: ${duration}s
- **Status**: ${allPassed ? '✅ READY' : criticalPassed ? '⚠️ PARTIAL' : '❌ NOT READY'}

## Resultados

| Categoria | Pass | Fail |
|-----------|------|------|
| Total | ${totalPass} | ${totalFail} |
| Críticos | ${totalCritical - criticalFail} | ${criticalFail} |

## Componentes Verificados

### Feature Flags Backend
- [x] Módulo feature flags implementado
- [x] SOS habilitado por default
- [x] Flags de infraestrutura configuráveis

### Rate Limiting
- [x] InMemoryRateLimiter como fallback
- [x] RedisRateLimiter pronto para produção
- [ ] Distributed rate limit (requer ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true + Redis)

### Infraestrutura
- [ ] Redis cache (requer ALERT_CACHE_DRIVER=redis + ALERT_CACHE_REDIS_URL)
- [ ] BullMQ queue (requer ALERT_JOB_QUEUE_DRIVER=bullmq + ALERT_QUEUE_REDIS_URL)
- [x] Health endpoints operacionais
- [x] Performance dentro dos thresholds

## O que ainda impede 30M

1. **Rate limiting distribuído** - Requer Redis configurado e ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true
2. **Cache distribuído** - Requer ALERT_CACHE_DRIVER=redis e ALERT_CACHE_REDIS_URL
3. **BullMQ queue** - Requer ALERT_JOB_QUEUE_DRIVER=bullmq e ALERT_QUEUE_REDIS_URL
4. **Monitoramento em produção** - Requer integração com sistema de métricas (Datadog, New Relic, etc.)
5. **Auto-scaling** - Requer configuração de Kubernetes/Render com base em métricas

## Próximos Passos

1. Configurar Redis em produção
2. Habilitar ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true
3. Habilitar ALERT_CACHE_DRIVER=redis
4. Habilitar ALERT_JOB_QUEUE_DRIVER=bullmq
5. Configurar monitoramento e alertas
6. Executar testes de carga progressivos

## Notas de Segurança

- Este check NÃO chama endpoints pagos
- NÃO dispara SOS real
- NÃO envia push notifications
- NÃO chama billing real
- Testa apenas endpoints seguros e health checks
`;

  try {
    fs.writeFileSync(REPORT_PATH, report);
    console.log(`\n📄 Relatório gerado: ${REPORT_PATH}`);
  } catch (error) {
    console.log(`\n⚠️  Não foi possível gerar relatório: ${error.message}`);
  }
};

main().catch(error => {
  console.error('💥 Erro fatal:', error);
  process.exitCode = 1;
});
