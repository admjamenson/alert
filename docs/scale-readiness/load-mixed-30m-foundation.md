# Alert Load Test - Mixed 30M Foundation

## Resumo Executivo

- **Data**: 2026-05-03T03:20:49.848Z
- **Target**: https://alert-vmpj.onrender.com
- **Mode**: SAFE MODE
- **Duração**: 301.3s
- **Concorrência**: 100
- **Total Requests**: 107885
- **RPS Médio**: 358.1

## Configuração de Segurança

- **SAFE MODE**: ✅ ATIVO
- **External Endpoints**: ✅ NONE
- **Environment Variables**:
  - `ALERT_LOAD_TEST_SAFE_MODE=true`

## Distribuição de Endpoints

| Endpoint | Peso | Requests | % Real |
|----------|------|----------|--------|
| /v1/ops/summary | 65% | 70078 | 65.0% |
| /api/v1/weather/feed?lat=-23.5505&lon=-46.6333 | 20% | 21625 | 20.0% |
| /api/v1/risk/feed?lat=-23.5505&lon=-46.6333&limit=10 | 10% | 10830 | 10.0% |
| /api/me/entitlements | 4% | 4213 | 3.9% |
| /healthz | 1% | 1139 | 1.1% |

## Métricas de Performance

| Métrica | Valor | Threshold | Status |
|---------|-------|-----------|--------|
| RPS | 358.1 | - | ✅ |
| p50 | 257ms | - | ✅ |
| p95 | 372ms | 800ms | ✅ |
| p99 | 469ms | 1500ms | ✅ |
| Error Rate | 0.00% | 1% | ✅ |

## Resultados por Endpoint

### /v1/ops/summary (65%)
- Requests: 70078
- p50: 253ms | p95: 342ms | p99: 436ms
- Error Rate: 0.00%
- Errors: Nenhum

### /api/v1/weather/feed?lat=-23.5505&lon=-46.6333 (20%)
- Requests: 21625
- p50: 253ms | p95: 350ms | p99: 472ms
- Error Rate: 0.00%
- Errors: Nenhum

### /api/v1/risk/feed?lat=-23.5505&lon=-46.6333&limit=10 (10%)
- Requests: 10830
- p50: 329ms | p95: 438ms | p99: 525ms
- Error Rate: 0.00%
- Errors: Nenhum

### /api/me/entitlements (4%)
- Requests: 4213
- p50: 329ms | p95: 438ms | p99: 522ms
- Error Rate: 0.00%
- Errors: Nenhum

### /healthz (1%)
- Requests: 1139
- p50: 252ms | p95: 335ms | p99: 405ms
- Error Rate: 0.00%
- Errors: Nenhum


## Guardrails

| Guardrail | Threshold | Resultado | Status |
|-----------|-----------|-----------|--------|
| Error Rate | < 1% | 0.00% | ✅ PASS |
| p95 Latency | < 800ms | 372ms | ✅ PASS |
| p99 Latency | < 1500ms | 469ms | ✅ PASS |

## Conclusão

✅ **LOAD TEST PASSED (SAFE MODE)**: Todos os guardrails respeitados. Sistema pronto para escalar.

## Notas de Segurança

- **SAFE MODE**: Ativo - Zero chamadas externas garantidas
- Teste executado com keep-alive habilitado
- Coordenadas fixas usadas para evitar chamadas externas
- Nenhum endpoint de billing ou SOS real foi chamado
- Payload leve em todos os requests
- **PROTEÇÕES ATIVAS**: Sem OSRM externo, sem Firestore remoto, sem billing, sem push, sem SOS real

## Comandos

```bash
# Executar teste em SAFE MODE (recomendado - zero chamadas externas)
ALERT_LOAD_TEST_SAFE_MODE=true npm run load:mixed:30m:foundation

# Executar teste padrão (20 workers, 30s) - requer OSRM local
npm run load:mixed:30m:foundation

# Executar com mais workers e duração maior
ALERT_LOAD_CONCURRENCY=50 ALERT_LOAD_DURATION=60 npm run load:mixed:30m:foundation

# Executar contra target remoto
ALERT_LOAD_TARGET=http://seu-servidor:5005 npm run load:mixed:30m:foundation
```
