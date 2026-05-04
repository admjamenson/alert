# Redis Staging Setup — Validação FAANG 30M

**Status:** 30M NÃO PROVADO — requer staging real + load externo  
**Última atualização:** 2026-05-02

## Objetivo

Preparar ambiente de staging real com Redis para validação de capacidade de 30 milhões de usuários, **sem usar produção ou APIs pagas**.

## Variáveis de Ambiente Suportadas

O backend já suporta as seguintes configurações Redis (ver `backend/.env.example`):

### Redis URLs

```bash
# Redis principal (fallback geral)
ALERT_REDIS_URL=redis://[user:password@]host:port[/db]

# Redis dedicado para BullMQ (queue) - CRÍTICO
# Deve usar política noeviction e persistence enabled
ALERT_QUEUE_REDIS_URL=redis://[user:password@]host:port[/db]

# Redis para cache (TTL limitado, LRU aceitável)
ALERT_CACHE_REDIS_URL=redis://[user:password@]host:port[/db]

# Redis para rate limiting distribuído
# Fallback: ALERT_REDIS_URL se não especificado
ALERT_RATE_LIMIT_REDIS_URL=redis://[user:password@]host:port[/db]
```

### Drivers e Controle

```bash
# Driver de cache: memory (default) ou redis
ALERT_CACHE_DRIVER=memory

# Driver de fila: memory (default) ou bullmq
ALERT_JOB_QUEUE_DRIVER=memory

# Habilita rate limiting distribuído (requer Redis)
ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=false

# Fail-fast em staging/Render se Redis não configurado
ALERT_REQUIRE_EXTERNAL_INFRA=false

# Timeout de conexão Redis (ms)
ALERT_REDIS_CONNECT_TIMEOUT_MS=2500
```

## Como Usar Redis Externo Barato

### Opção 1: Redis Cloud Free (30MB)

1. Criar conta em [Redis Cloud](https://redis.com/redis-enterprise-cloud/overview/)
2. Criar database free (30MB, 1 connection)
3. Copiar URL de conexão
4. **Limitação:** Apenas para testes iniciais, não suporta 30M

### Opção 2: Upstash (Pay-as-you-go)

1. Criar conta em [Upstash](https://upstash.com/)
2. Criar Redis database (global edge)
3. Copiar `UPSTASH_REDIS_REST_URL` e token
4. Formato URL: `rediss://default:TOKEN@HOST:PORT`
5. **Custo:** ~$0.60/milhão de comandos (barato para staging)

### Opção 3: Redis Labs Trial

1. Trial de 30 dias com database maior
2. Bom para testes de carga limitados
3. **Atenção:** Expira após 30 dias

### Opção 4: Self-hosted em VPS Barata

```bash
# DigitalOcean/Hetzner VPS (~$5-10/mês)
# Instalar Redis:
sudo apt-get install redis-server
sudo systemctl enable redis-server

# Configurar para aceitar conexões externas:
sudo nano /etc/redis/redis.conf
# bind 0.0.0.0
# requirepass strong_password_here

# Criar URL:
# redis://:strong_password_here@VPS_IP:6379/0
```

## Como Desligar Redis

Para desativar Redis e usar fallback local:

```bash
# Voltar drivers para memory
ALERT_CACHE_DRIVER=memory
ALERT_JOB_QUEUE_DRIVER=memory

# Desligar rate limiting distribuído
ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=false

# Limpar URLs (opcional, não usado se drivers=memory)
ALERT_REDIS_URL=
ALERT_QUEUE_REDIS_URL=
ALERT_CACHE_REDIS_URL=
ALERT_RATE_LIMIT_REDIS_URL=
```

## Riscos de Custo

### ⚠️ Atenção Crítica

1. **Redis Cloud/Upstash:** Cobrança por comando/operação

   - Staging com load testing pode gerar custos inesperados
   - Monitorar dashboard diariamente
   - Setar alerts de orçamento

2. **BullMQ com Redis:** Cada job enqueue/dequeue = múltiplos comandos

   - 30M usuários × múltiplas operações = custo significativo
   - **Nunca** usar produção Redis para load testing

3. **Cache Redis:** TTLs curtos = muitas operações
   - Configurar TTLs adequados para staging
   - Considerar `maxmemory-policy noeviction` para evitar custos de re-fetch

### Limites Seguros para Staging

```bash
# Limitar operações em staging
ALERT_SOS_FANOUT_CONCURRENCY=2  # Reduzir de 8
ALERT_SOS_FANOUT_ATTEMPTS=1     # Reduzir de 3
ROUTING_PROVIDER_MAX_CONCURRENT_REQUESTS=2  # Reduzir de 4
```

## Configuração para Validação 30M

### Passo 1: Verificar Configuração Atual

```bash
# No backend, verificar se Redis está configurado:
cd backend
grep -E "ALERT_(REDIS|CACHE|JOB_QUEUE|DISTRIBUTED_RATE_LIMIT)" .env

# Se URLs estiverem vazias, usar fallback memory
# Se URLs existirem, testar conexão
```

### Passo 2: Configurar Staging com Redis Barato

```bash
# Exemplo com Upstash (pay-as-you-go)
ALERT_REDIS_URL="rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379"
ALERT_QUEUE_REDIS_URL="rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379"
ALERT_CACHE_REDIS_URL="rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379"
ALERT_RATE_LIMIT_REDIS_URL="rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379"

# Habilitar Redis drivers
ALERT_CACHE_DRIVER=redis
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true

# Reduzir operações para staging
ALERT_SOS_FANOUT_CONCURRENCY=2
ALERT_SOS_FANOUT_ATTEMPTS=1
ALERT_REQUIRE_EXTERNAL_INFRA=false  # Fail-soft em staging
```

### Passo 3: Testar Conexão

```bash
# Testar conexão Redis
cd backend
npm run test:redis-connection

# Ou manualmente:
node -e "
const Redis = require('ioredis');
const redis = new Redis(process.env.ALERT_REDIS_URL);
redis.ping().then(r => console.log('Redis OK:', r)).catch(e => console.error('Redis FAIL:', e));
"
```

### Passo 4: Load Test Seguro

```bash
# Usar safe mode para evitar chamadas externas
ALERT_LOAD_TEST_SAFE_MODE=true

# Rodar load test limitado
npm run load-test:staging

# Monitorar:
# - Redis commands/sec no dashboard
# - Memory usage
# - Connection count
# - Custo acumulado
```

## Critérios de Validação

### ✅ PROVADO (30M)

- [ ] Staging com Redis real configurado
- [ ] Load test externo simulando 30M usuários
- [ ] Redis mantém performance estável
- [ ] Rate limiting distribuído funciona
- [ ] BullMQ processa filas sem perda
- [ ] Custo dentro do orçamento previsto
- [ ] Evidências documentadas (screenshots, logs, métricas)

### ⚠️ PARCIAL

- [ ] TypeScript compilado sem erros
- [ ] Redis configurado mas não testado com load real
- [ ] Apenas testes locais/simulações

### ❌ NÃO PROVADO

- [ ] Apenas fallback memory
- [ ] Nenhum teste com Redis real
- [ ] Configuração incompleta

## Status Atual

**Classificação:** 30M NÃO PROVADO

**Motivo:** Staging externo ainda não configurado com Redis real e load test externo não executado.

**Próximos passos:**

1. [ ] Configurar Redis no Upstash (ou alternativa)
2. [ ] Deploy no Render staging com variáveis corretas
3. [ ] Validar health check e conexão Redis
4. [ ] Executar warm-up (10 workers, 30s)
5. [ ] Executar carga progressiva (20, 50, 100 workers)
6. [ ] Coletar métricas e gerar relatório
7. [ ] Classificar resultado (PROVADO/PARCIAL/NÃO PROVADO)
8. [ ] Atualizar este documento com resultados

**Documento relacionado:**

- `docs/scale-readiness/global-30m-production-proof-plan.md` — Plano completo de validação 30M

## Notas de Segurança

- **Nunca** commitar URLs reais do Redis no repositório
- Usar variáveis de ambiente ou secrets manager
- Rotacionar senhas periodicamente
- Monitorar acessos não autorizados
- Usar TLS (`rediss://`) para conexões externas

## Referências

- `backend/.env.example` - Configurações completas
- `backend/src/infrastructure/rateLimit/RedisRateLimiter.js` - Implementação
- `backend/scripts/check-30m-foundation.js` - Validação de capacidade
