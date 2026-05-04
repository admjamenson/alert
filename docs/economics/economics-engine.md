# Economics Engine para Alert

## Objetivo

O Economics Engine protege o backend contra explosão de custos ao limitar a atividade dos usuários com base em um orçamento mensal por tier. Ele garante que chamadas caras entrem em um gate econômico e, quando necessário, degrade para respostas em cache, staled ou seguras em vez de falhar ou chamar provedores externos sem controle.

## Regras principais

- Usuário FREE: custo mensal máximo por usuário <= 20% da receita estimada por ads.
- Usuário PREMIUM: custo mensal máximo por usuário <= 30% da assinatura líquida.
- Chamadas caras devem passar por um gate econômico antes de executar o provider.
- Se o orçamento for ultrapassado, o sistema degrada para respostas seguras ou cacheadas.
- Nunca retornar 500 por limite econômico.
- Não expor PII bruta, secrets ou payloads SOS sensíveis no bloco de economia.

## Como funciona

1. O backend calcula o custo estimado de uma operação usando o catálogo de custos.
2. O gate econômico (`EconomicGate`) compara o custo projetado com o orçamento mensal do tier do usuário.
3. Se o custo estiver dentro do budget, a operação é permitida e o custo é registrado.
4. Se o custo exceder o budget:
   - Para operações padrão, a resposta é degradada para um fallback seguro.
   - Para `life_safety`, a resposta essencial é preservada e apenas o fanout não essencial é reduzido.
5. O tracker de custos agrega gastos por usuário e por região em janela mensal.
6. Métricas de economia aparecem em `/metrics` e `/v1/ops/metrics`.

## Configuração por ambiente

As variáveis de ambiente configuráveis são:

- `ALERT_ECONOMICS_GATE_ENABLED=false`
- `ALERT_FREE_REVENUE_USD_MONTHLY=2.00`
- `ALERT_PREMIUM_REVENUE_USD_MONTHLY=4.00`
- `ALERT_FREE_MAX_COST_RATIO=0.20`
- `ALERT_PREMIUM_MAX_COST_RATIO=0.30`
- `ALERT_COST_BACKEND_REQUEST_BASE_USD=0.000001`
- `ALERT_COST_REDIS_COMMAND_USD=0.000002`
- `ALERT_COST_FIRESTORE_READ_USD=0.000001`
- `ALERT_COST_FIRESTORE_WRITE_USD=0.000003`
- `ALERT_COST_WEATHER_PROVIDER_USD=0.00005`
- `ALERT_COST_RISK_PROVIDER_USD=0.00010`
- `ALERT_COST_GEOCODING_PROVIDER_USD=0.00005`
- `ALERT_COST_MAP_ROUTE_PROVIDER_USD=0.00005`
- `ALERT_COST_PUSH_NOTIFICATION_USD=0.00001`
- `ALERT_COST_BILLING_LOOKUP_USD=0.00002`
- `ALERT_COST_SOS_DRY_RUN_USD=0.00001`
- `ALERT_COST_SOS_REAL_FANOUT_USD=0.00010`

## Leitura de métricas

O endpoint `/metrics` expõe um bloco `economics` com:

- `enabled`: se o gate econômico está ativo.
- `policy`: orçamentos e limites por tier.
- `metrics`: estatísticas de decisões e tracker.

O mesmo bloco também aparece em `/v1/ops/metrics` e em `/v1/ops/summary`.

## Degradação automática

Quando o orçamento for ultrapassado:

- Operações de feed retornam respostas de cache ou payload seguro.
- Entitlement usa cache ou fallback determinístico seguro e evita novos billing lookups.
- Maps/routing reduz execução de provider e retorna rota não disponível segura.
- SOS real não é bloqueado; apenas fanout não essencial é reduzido.

## Limitações e prova

- O engine protege contra custo explosivo por usuário e região, mas não garante suporte a 30M de usuários sem validação operacional e dimensionamento de infraestrutura adicional.
- A prova do suporte a 30M ainda requer testes de carga e validação de autoscaling do Render/Redis.
- Este mecanismo evita excesso de custos e fornece uma camada de controle econômico, mas não substitui análises de capacidade, custo de infraestrutura e otimização de código.
