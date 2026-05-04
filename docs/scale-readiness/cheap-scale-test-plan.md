# 🧪 Plano de Teste de Escala com Custo Mínimo (Cheap Scale Test)

## 📋 Visão Geral

Este documento descreve como executar testes de escala do backend Alert com custo zero ou mínimo (abaixo de US$5 por rodada), utilizando infraestrutura temporária e controlada.

## 🎯 Objetivos

1. Validar capacidade do backend de lidar com carga moderada
2. Medir latência e throughput em diferentes níveis de concorrência
3. Identificar gargalos antes de escalar para produção
4. Testar com segurança sem gerar custos inesperados

## ⚠️ Regras Absolutas

- **NUNCA** testar em produção sem aprovação explícita
- **NUNCA** exceder 5 minutos de teste contínuo
- **NUNCA** testar endpoints que geram custo (SOS real, pagamentos, providers pagos)
- **SEMPRE** usar endpoints seguros: `/healthz`, `/`, `/api/me/entitlements`
- **SEMPRE** ter plano de rollback e parada de emergência

## 🛡️ Guardrails de Segurança

| Parâmetro            | Valor     | Ação                  |
| -------------------- | --------- | --------------------- |
| Tempo máximo         | 5 minutos | Parar automaticamente |
| Taxa de erro         | > 2%      | Parar teste           |
| P95 latência         | > 1500ms  | Parar teste           |
| Timeout em massa     | > 10%     | Parar teste           |
| Concorrência inicial | 5         | Aumento progressivo   |
| Concorrência máxima  | 50        | Limite absoluto       |

## 🏠 Teste Local (Custo Zero)

### Pré-requisitos

```bash
# 1. Instalar dependências
cd backend
npm install

# 2. Configurar variáveis de ambiente (copiar .env.example para .env)
cp .env.example .env

# 3. Garantir que pelo menos RELAY_HMAC_SECRET esteja configurado
# No .env:
# RELAY_HMAC_SECRET=test_secret_long_enough_for_testing
```

### Iniciar Backend Local

```bash
# Terminal 1: Iniciar backend
cd backend
npm start

# O backend iniciará em http://localhost:5005
```

### Executar Testes

```bash
# Terminal 2: Verificar preparação
npm run scale:check

# Executar teste de carga barato
npm run load:cheap
```

### Comandos com Parâmetros Customizados

```bash
# Teste mais leve (2 workers, 50 requests por batch)
ALERT_LOAD_INITIAL_CONCURRENCY=2 \
ALERT_LOAD_MAX_CONCURRENCY=10 \
ALERT_LOAD_REQUESTS_PER_BATCH=50 \
npm run load:cheap

# Teste mais pesado (cuidado!)
ALERT_LOAD_INITIAL_CONCURRENCY=10 \
ALERT_LOAD_MAX_CONCURRENCY=50 \
ALERT_LOAD_REQUESTS_PER_BATCH=200 \
ALERT_LOAD_MAX_DURATION_SEC=180 \
npm run load:cheap
```

## ☁️ Teste Remoto (Custo Mínimo)

### Opção 1: Usar Render Existente (se disponível)

Se você já tem um serviço Render implantado:

```bash
# Obter URL do serviço (ex: https://alert-backend-production.up.railway.app)
export ALERT_LOAD_TARGET=https://seu-servico-render.app/healthz

# Verificar preparação
ALERT_CHECK_TARGET=https://seu-servico-render.app npm run scale:check

# Executar teste
ALERT_LOAD_TARGET=https://seu-servico-render.app/healthz npm run load:cheap
```

### Opção 2: Criar Infraestrutura Temporária Barata

#### Redis Temporário (Docker)

```bash
# Iniciar Redis local temporário
docker run -d --name alert-test-redis -p 6379:6379 redis:7-alpine

# Configurar backend para usar Redis
export ALERT_REDIS_URL=redis://localhost:6379
export ALERT_CACHE_DRIVER=redis
export ALERT_JOB_QUEUE_DRIVER=bullmq

# Reiniciar backend
npm start
```

#### Backend em VM Temporária (AWS/GCP/Azure)

**AVISO**: Isso pode gerar custos. Use apenas se necessário e desligue após o teste.

```bash
# Exemplo AWS EC2 spot instance (custo ~US$0.01/hora)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.micro \
  --spot-price "0.01" \
  --key-name your-key \
  --security-group-ids sg-xxxxx \
  --user-data file://startup-script.sh

# startup-script.sh deve:
# 1. Instalar Node.js
# 2. Clonar repositório
# 3. Instalar dependências
# 4. Iniciar backend
```

## 📊 Métricas Coletadas

O teste `load:cheap` coleta:

| Métrica        | Descrição                        |
| -------------- | -------------------------------- |
| Total Requests | Número total de requisições      |
| RPS Médio      | Requisições por segundo          |
| P50, P95, P99  | Percentis de latência            |
| Taxa de Erro   | Porcentagem de falhas            |
| Duração        | Tempo total do teste             |
| Status         | PASS/FAIL baseado nos guardrails |

## 🚨 Como Parar o Teste

### Parada Imediata

```bash
# Local: Ctrl+C no terminal
Ctrl+C

# Se não responder:
Ctrl+Z
kill %1

# Remoto: Cancelar deployment no dashboard ou via CLI
```

### Procedimento Completo de Parada

Veja `backend/scripts/stop-cheap-test.md` para instruções detalhadas.

## 🧹 Limpeza Pós-Teste

### Local

```bash
# Parar Redis Docker (se usou)
docker stop alert-test-redis
docker rm alert-test-redis

# Limpar variáveis de ambiente
unset ALERT_LOAD_TARGET
unset ALERT_CHECK_TARGET
unset ALERT_REDIS_URL
```

### Remoto

```bash
# Desligar VM temporária
aws ec2 terminate-instances --instance-ids i-xxxxx

# Ou desligar serviço Render
# (via dashboard ou CLI)
```

## 📈 Interpretação dos Resultados

### ✅ Teste PASSOU

- Backend saudável para carga testada
- Pode aumentar gradualmente a carga
- Considere testar com concorrência maior

### ❌ Teste FALHOU

- Identifique o gargalo (CPU, memória, rede, DB)
- Otimize antes de tentar novamente
- Reduza parâmetros e tente de forma mais conservadora

### ⚠️ Teste PARADO PELO GUARDRAIL

- Sistema está sob estresse
- Não aumente a carga sem investigar
- Pode indicar necessidade de scaling ou otimização

## 💰 Estimativa de Custos

| Cenário                   | Custo Estimado                        |
| ------------------------- | ------------------------------------- |
| Teste local               | US$ 0,00                              |
| Render free tier          | US$ 0,00 (se elegível)                |
| Render starter (744h/mês) | ~US$ 5-10/mês (proporcional ao teste) |
| AWS t3.micro spot (1h)    | ~US$ 0,01                             |
| Redis Docker local        | US$ 0,00                              |

**Nota**: Testes devem durar no máximo 5 minutos, então custos são insignificantes.

## 🔧 Troubleshooting

### Backend não inicia

```bash
# Verificar porta em uso
netstat -ano | findstr :5005  # Windows
lsof -i :5005                 # Linux/Mac

# Matar processo na porta
taskkill /PID <PID> /F  # Windows
kill -9 <PID>           # Linux/Mac
```

### Teste falha imediatamente

```bash
# Verificar se backend está rodando
curl http://localhost:5005/healthz

# Verificar logs do backend
# (procure por erros no terminal onde backend está rodando)
```

### Redis não conecta

```bash
# Testar conexão Redis
redis-cli ping  # Deve responder "PONG"

# Verificar se Redis está rodando
docker ps | grep redis
```

## 📚 Referências

- `backend/scripts/load-smoke-cheap.js` - Script principal de teste
- `backend/scripts/check-scale-readiness.js` - Verificação de preparação
- `backend/scripts/stop-cheap-test.md` - Procedimento de parada de emergência
- `backend/.env.example` - Configurações de ambiente

## 📞 Suporte

Em caso de dúvidas ou problemas:

1. Consulte a documentação acima
2. Verifique os logs do backend
3. Execute `npm run scale:check` para diagnóstico
4. Consulte `backend/scripts/stop-cheap-test.md` para emergência

---

**Última atualização**: 2026-05-02  
**Responsável**: Time de Engenharia Alert
