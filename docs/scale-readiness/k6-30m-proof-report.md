# Alert k6 Load Test - Final 30M Proof

## Resumo Executivo

- **Data**: 2026-05-04T05:08:01.557Z
- **Target**: https://alert-vmpj.onrender.com
- **Safe Mode**: ✅ ATIVO
- **Fase Executada**: Fase 500 RPS (10m)
- **Total Requests**: 20324
- **RPS Médio**: 33.4

## Cenários Executados

| 500 | 500 | 10m | Executado |

## Métricas de Performance

| Métrica | Valor | Threshold | Status |
|---------|-------|-----------|--------|
| p95 Latency | 9233ms | < 800ms | ❌ FAIL |
| p99 Latency | N/A | < 1500ms | ❌ N/A |
| Error Rate | 2.54% | < 1% | ❌ FAIL |
| RPS Médio | 33.4 | - | ✅ |

## Guardrails

| Guardrail | Threshold | Resultado | Status |
|-----------|-----------|-----------|--------|
| p95 Latency | < 800ms | 9233ms | ❌ FAIL |
| p99 Latency | < 1500ms | N/A | ❌ N/A |
| Error Rate | < 1% | 2.54% | ❌ FAIL |

## Custo Estimado

### Por 1M Requests

- **Redis Operations** (Upstash): ~$0.60 por 1M commands
- **Render Hosting**: ~$7-25/mês (free tier a pro)
- **Custo total estimado 1M requests**: ~$0.60-1.00

### Projeção 30M Usuários

- **Requests/mês estimado**: 30M × 100 requests/usuário = 3B requests
- **Redis Operations**: 3B × $0.60/1M = ~$1,800/mês
- **Render/Infra**: ~$100-500/mês
- **Total estimado/mês**: ~$2,000-2,500

## Conclusão

❌ **LOAD TEST FAILED**: Um ou mais guardrails foram violados. Sistema precisa de otimização antes de escalar.

## Classificação Final

[ ] NÃO SUPORTA
[ ] SUPORTA COM RISCOS
[ ] NÃO PROVADO

---

*Relatório gerado automaticamente pelo k6*
