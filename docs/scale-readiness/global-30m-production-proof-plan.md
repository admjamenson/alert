# Global 30M Production Proof Plan — COMANDO CENTRAL

**Status:** 30M NÃO PROVADO — requer staging externo + load test real  
**Última atualização:** 2026-05-03  
**Próxima revisão:** Após execução do load test externo

---

## 🎯 Objetivo

Preparar validação real fora do localhost para provar caminho rumo a 30 milhões de usuários, utilizando ambiente de staging com Redis real e load test externo controlado.

## ⚠️ Regras Obrigatórias

### Safe Mode — NÃO NEGOCIÁVEL

- [x] **NÃO usar produção** — apenas staging isolado
- [x] **NÃO chamar API paga** — OSRM local/fallback, weather mock
- [x] **NÃO chamar SOS real** — safe mode desativa fanout real
- [x] **NÃO enviar push real** — FCM em modo teste
- [x] **NÃO chamar billing real** — Stripe em modo teste
- [x] **Safe mode obrigatório** — `ALERT_LOAD_TEST_SAFE_MODE=true`
- [x] **NÃO declarar 30M provado sem teste externo** — staging ≠ produção

### Guardrails de Segurança

```bash
# Load test seguro
ALERT_LOAD_TEST_SAFE_MODE=true
ALERT_LOAD_TEST_ALLOW_LOCALHOST=false  # FORÇAR URL EXTERNA

# Backend em safe mode
ALERT_SOS_FANOUT_WORKER_ENABLED=false  # Não dispara SOS real
ALERT_BILLING_SESSION_SECRET=test_secret_only  # Billing mock
```

---

## 📋 Pré-requisitos de Infraestrutura

### 1. Staging no Render (ou similar)

- [ ] Deploy da branch `staging` ou `develop`
- [ ] URL pública acessível (ex: `https://alert-staging.onrender.com`)
- [ ] HTTPS habilitado
- [ ] Health check `/healthz` respondendo

### 2. Redis Externo (Staging)

Configurar pelo menos uma das opções:

| Opção            | Custo         | Conexões   | Persistência | Recomendado para   |
| ---------------- | ------------- | ---------- | ------------ | ------------------ |
| Upstash          | ~$0.60/M cmds | Ilimitadas | Sim          | Staging inicial    |
| Redis Cloud Free | Grátis        | 1          | Limitada     | Testes rápidos     |
| Redis Labs Trial | Grátis 30d    | Múltiplas  | Sim          | Load test completo |
| VPS Self-hosted  | ~$5-10/mês    | Ilimitadas | Configurável | Longo prazo        |

### 3. Variáveis de Ambiente no Render

```bash
# Ambiente
APP_ENV=staging
PORT=5005
HOST=0.0.0.0

# Segurança
RELAY_HMAC_SECRET=<gerar_secret_seguro_staging>

# Redis (CRÍTICO)
ALERT_REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379
ALERT_QUEUE_REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379
ALERT_CACHE_REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379
ALERT_RATE_LIMIT_REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379

# Drivers
ALERT_CACHE_DRIVER=redis
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true

# Safe Mode (OBRIGATÓRIO)
ALERT_LOAD_TEST_SAFE_MODE=true
ALERT_DISABLE_REMOTE_RELEASE_OVERRIDE=true
ALERT_SOS_FANOUT_WORKER_ENABLED=false
ALERT_BILLING_SESSION_SECRET=staging_test_secret_12345

# Opcional - Fail-soft em staging
ALERT_REQUIRE_EXTERNAL_INFRA=false

# Reduzir operações para staging
ALERT_SOS_FANOUT_CONCURRENCY=2
ALERT_SOS_FANOUT_ATTEMPTS=1
ROUTING_PROVIDER_MAX_CONCURRENT_REQUESTS=2
```

---

## 🧪 Script de Load Test Externo Seguro

### Criar script dedicado para staging externo

```bash
# backend/scripts/load-external-staging.js
# OU usar o existente com validação reforçada
```

### Validação de URL Externa (NÃO LOCALHOST)

```javascript
// Validação obrigatória no script
function validateExternalTarget(target) {
  const url = new URL(target);
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';

  if (isLocalhost) {
    throw new Error(
      `❌ LOAD TEST EXTERNO REJEITADO: Target é localhost (${target}).\n` +
        `Use ALERT_LOAD_TARGET=https://seu-staging.onrender.com\n` +
        `Load test externo DEVE usar URL pública.`,
    );
  }

  // Exigir HTTPS em produção/staging
  if (
    url.protocol !== 'https:' &&
    process.env.ALERT_LOAD_REQUIRE_HTTPS === 'true'
  ) {
    throw new Error(
      `❌ LOAD TEST EXTERNO REJEITADO: Target deve usar HTTPS (${target}).\n` +
        `Configure HTTPS no seu staging.`,
    );
  }

  return true;
}
```

### Configurações de Concorrência

| Fase      | Concurrency | Duration | Objetivo         |
| --------- | ----------- | -------- | ---------------- |
| Warm-up   | 10          | 30s      | Aquecer conexões |
| Fase 1    | 20          | 60s      | Carga leve       |
| Fase 2    | 50          | 60s      | Carga média      |
| Fase 3    | 100         | 60s      | Carga alta       |
| Cool-down | 10          | 30s      | Resfriamento     |

### Comandos de Execução

```bash
# Warm-up
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=10 \
ALERT_LOAD_DURATION=30 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js

# Fase 1 - Carga leve
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=20 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js

# Fase 2 - Carga média
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=50 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js

# Fase 3 - Carga alta
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=100 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js
```

---

## 📊 Métricas e Relatório

### Estrutura do Relatório

O relatório deve incluir:

1. **Resumo Executivo**

   - Data/hora do teste
   - URL do staging testada
   - Duração total
   - Classificação final

2. **Configuração**

   - Safe mode ativo
   - Redis configurado
   - BullMQ ativo
   - Endpoints testados

3. **Métricas de Performance**

   | Métrica                | Símbolo    | Descrição              |
   | ---------------------- | ---------- | ---------------------- |
   | Requests por segundo   | RPS        | Throughput do sistema  |
   | Latência mediana       | p50        | 50% dos requests       |
   | Latência 95º percentil | p95        | 95% dos requests       |
   | Latência 99º percentil | p99        | 99% dos requests       |
   | Taxa de erro           | error rate | % de requests com erro |

4. **Guardrails**

   | Guardrail   | Threshold | Status |
   | ----------- | --------- | ------ |
   | Error Rate  | < 1%      | ✅/❌  |
   | p95 Latency | < 800ms   | ✅/❌  |
   | p99 Latency | < 1500ms  | ✅/❌  |

5. **Infraestrutura**

   - Redis: ativo/inativo
   - BullMQ: ativo/inativo
   - Conexões Redis: count
   - Memory usage: MB

6. **Custo Estimado**
   - Redis operations: count
   - Custo Redis: $X.XX
   - Custo Render: $X.XX/mês
   - Custo total estimado 30M: $X,XXX/mês

### Template de Relatório

```markdown
# Load Test Report — Global 30M External Staging

## Execução

- **Data**: YYYY-MM-DD HH:MM:SS
- **Target**: https://xxx.onrender.com
- **Safe Mode**: ✅ ATIVO
- **Redis**: ✅ CONFIGURADO
- **BullMQ**: ✅ ATIVO

## Resultados por Fase

### Fase 1 (20 concurrency, 60s)

| Métrica    | Valor |
| ---------- | ----- |
| RPS        | XXX.X |
| p50        | XXXms |
| p95        | XXXms |
| p99        | XXXms |
| Error Rate | X.XX% |

### Fase 2 (50 concurrency, 60s)

| Métrica    | Valor |
| ---------- | ----- |
| RPS        | XXX.X |
| p50        | XXXms |
| p95        | XXXms |
| p99        | XXXms |
| Error Rate | X.XX% |

### Fase 3 (100 concurrency, 60s)

| Métrica    | Valor |
| ---------- | ----- |
| RPS        | XXX.X |
| p50        | XXXms |
| p95        | XXXms |
| p99        | XXXms |
| Error Rate | X.XX% |

## Infraestrutura

- Redis Commands: XXX,XXX
- Redis Memory: XXX MB
- BullMQ Jobs Processed: XXX
- Render CPU: XX%
- Render Memory: XXX MB

## Custo Estimado

- Redis (Upstash): $X.XX (teste)
- Redis (30M proj): $XXX/mês
- Render: $X.XX/mês
- Total estimado: $XXX/mês

## Classificação

[ ] PROVADO
[ ] PARCIAL
[ ] NÃO PROVADO
```

---

## 🏷️ Classificação de Resultados

### ✅ PROVADO (30M Foundation Validada)

Critérios:

- [ ] Staging externo com Redis real configurado
- [ ] Load test externo executado (URL ≠ localhost)
- [ ] Todas as fases (20, 50, 100 concurrency) completas
- [ ] Error rate < 1% em todas as fases
- [ ] p95 < 800ms em todas as fases
- [ ] p99 < 1500ms em todas as fases
- [ ] Redis manteve performance estável
- [ ] BullMQ processou filas sem perda
- [ ] Custo dentro do orçamento previsto
- [ ] Evidências documentadas (relatório, screenshots, logs)

### ⚠️ PARCIAL (Foundation Parcialmente Validada)

Critérios:

- [ ] Staging configurado mas load test incompleto
- [ ] Redis configurado mas não testado com carga real
- [ ] Algumas fases passaram, outras falharam
- [ ] Guardrails violados mas sistema manteve operação
- [ ] Custo maior que o previsto mas aceitável

### ❌ NÃO PROVADO (Foundation Não Validada)

Critérios:

- [ ] Apenas testes locais (localhost)
- [ ] Redis não configurado (usando memory fallback)
- [ ] Load test não executado
- [ ] Error rate > 1% consistente
- [ ] p95 > 800ms ou p99 > 1500ms consistente
- [ ] Sistema caiu durante teste

---

## 🚀 Passo a Passo de Execução

### Fase 0: Preparação (Dia 1)

1. **Configurar Redis no Upstash**

   ```bash
   # 1. Criar conta em upstash.com
   # 2. Criar Redis database (escolher região próxima do Render)
   # 3. Copiar REST API URL e token
   # 4. Format: rediss://default:TOKEN@HOST:PORT
   ```

2. **Deploy no Render Staging**

   ```bash
   # 1. Conectar repositório no Render
   # 2. Configurar branch: staging ou develop
   # 3. Adicionar variáveis de ambiente (ver seção acima)
   # 4. Deploy manual para validar
   # 5. Testar health check: curl https://xxx.onrender.com/healthz
   ```

3. **Validar Configuração**
   ```bash
   # Testar conexão Redis
   cd backend
   node -e "
   const Redis = require('ioredis');
   const redis = new Redis(process.env.ALERT_REDIS_URL);
   redis.ping().then(r => console.log('Redis OK:', r)).catch(e => console.error('Redis FAIL:', e));
   "
   ```

### Fase 1: Warm-up (Dia 2)

```bash
# Executar warm-up de 30s com 10 workers
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=10 \
ALERT_LOAD_DURATION=30 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js
```

### Fase 2: Carga Progressiva (Dia 2)

```bash
# Fase 1: 20 workers
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=20 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js

# Fase 2: 50 workers
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=50 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js

# Fase 3: 100 workers
ALERT_LOAD_TARGET=https://alert-staging.onrender.com \
ALERT_LOAD_CONCURRENCY=100 \
ALERT_LOAD_DURATION=60 \
ALERT_LOAD_TEST_SAFE_MODE=true \
node backend/scripts/load-mixed-30m-foundation.js
```

### Fase 3: Relatório e Classificação (Dia 2)

1. **Coletar métricas do Render dashboard**

   - CPU usage
   - Memory usage
   - Request count
   - Response times

2. **Coletar métricas do Redis/Upstash dashboard**

   - Commands processed
   - Memory usage
   - Connection count
   - Operations cost

3. **Gerar relatório consolidado**

   - Copiar relatórios gerados pelo script
   - Consolidar em único documento
   - Anexar screenshots dos dashboards

4. **Classificar resultado**
   - Aplicar critérios da seção "Classificação de Resultados"
   - Documentar justificativa

---

## 📎 Anexos e Referências

### Arquivos Relacionados

- `backend/scripts/load-mixed-30m-foundation.js` — Script principal de load test
- `backend/.env.example` — Configurações completas de ambiente
- `docs/scale-readiness/redis-staging-setup.md` — Guia de Redis staging
- `docs/scale-readiness/load-mixed-30m-foundation.md` — Relatório de load test local

### Comandos Úteis

```bash
# Verificar status do staging
curl https://alert-staging.onrender.com/healthz

# Testar endpoint específico
curl https://alert-staging.onrender.com/v1/ops/summary

# Ver logs do Render
render logs -s alert-staging

# Monitorar Redis (Upstash)
# Acessar dashboard.upstash.com
```

### Links Externos

- [Render Documentation](https://render.com/docs)
- [Upstash Documentation](https://upstash.com/docs)
- [BullMQ Documentation](https://docs.bullmq.io)

---

## 🔄 Status e Próximos Passos

### Status Atual

**Classificação:** 30M NÃO PROVADO

**Motivo:** Staging externo ainda não configurado com Redis real e load test externo não executado.

### Próximos Passos

1. [ ] Configurar Redis no Upstash (ou alternativa)
2. [ ] Deploy no Render staging com variáveis corretas
3. [ ] Validar health check e conexão Redis
4. [ ] Executar warm-up (10 workers, 30s)
5. [ ] Executar carga progressiva (20, 50, 100 workers)
6. [ ] Coletar métricas e gerar relatório
7. [ ] Classificar resultado (PROVADO/PARCIAL/NÃO PROVADO)
8. [ ] Atualizar este documento com resultados

### Bloqueadores

- Nenhum no momento

### Riscos

1. **Custo inesperado do Redis** — Monitorar dashboard diariamente
2. **Rate limiting do Render** — Free tier tem limitações
3. **Conexões Redis limitadas** — Upstash free tem 1 conexão simultânea
4. **Timeout em load test** — Ajustar timeout se necessário

---

**Documento criado:** 2026-05-03  
**Autor:** COMANDO CENTRAL — ALERT  
**Revisão:** Após execução do load test externo
