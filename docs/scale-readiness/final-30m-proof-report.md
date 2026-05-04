# Final 30M Proof Report - COMANDO CENTRAL

- Updated: 2026-05-04
- Status: 30M NAO SUPORTA AINDA - 500 RPS remoto ainda nao foi provado

## 1. Falha anterior

- Target: `https://alert-vmpj.onrender.com`
- Safe mode visto em `/metrics`: `safeMode.isActive=true`
- Fase k6: `500 RPS / 10 min`
- RPS real: `33.4`
- p95: `9233ms`
- error_rate: `2.54%`
- Timeouts observados em `GET /api/v1/risk/feed` e `GET /api/me/entitlements`

## 2. Causa raiz

- O safe mode existente ainda nao fazia hard bypass no primeiro ponto da rota.
- `GET /api/v1/risk/feed` ainda podia atravessar fluxo async, cache, coalescing e caminho de provider antes da resposta final.
- `GET /api/me/entitlements` ainda podia entrar em fluxo de snapshot/release/cache antes de responder.
- Resultado: mesmo com `ALERT_LOAD_TEST_SAFE_MODE=true`, ainda havia custo suficiente para gerar timeout sob carga.

## 3. Correcao aplicada

- `backend/src/config/safeMode.js`
  - `isLoadTestSafeMode()`
  - `isRemoteOverrideDisabled()`
  - `recordSafeModeRiskBypassMetric()`
  - `recordSafeModeEntitlementBypassMetric()`
  - `buildSafeModeRiskFeedPayload(req)` sem `await`
  - `buildSafeModeEntitlementsPayload(req)` sem `await`
- `backend/index.js`
  - hard bypass de `GET /api/v1/risk/feed` antes do registro da rota real
  - hard bypass de `GET /api/me/entitlements` antes do registro da rota real
  - uso do helper central de `remoteOverrideDisabled`
  - exposicao de novas metricas em `/metrics` e `/v1/ops/metrics`
- `backend/src/services/RiskFeedService.js`
  - metricas de `providerCalls` e `firestoreCalls`
- `backend/src/services/EntitlementSnapshotService.js`
  - metrica de `billingLookups`
- `backend/scripts/k6-30m-proof.js`
  - relatorio nao declara suporte a 30M de forma prematura
  - veredito da fase 500 respeita o criterio de RPS real

## 4. Resultado local

Validacao executada localmente em um unico processo Node com:

- `APP_ENV=development`
- `RELAY_HMAC_SECRET=test_secret_long_enough_for_local_development_12345`
- `ALERT_LOAD_TEST_SAFE_MODE=true`
- `ALERT_DISABLE_REMOTE_RELEASE_OVERRIDE=true`

Resultados:

- `GET /api/v1/risk/feed?lat=-23.5505&lon=-46.6333&limit=10`
  - HTTP `200`
  - `source: safe_mode_hard_bypass`
  - `safeMode: true`
  - tempo: `2.869ms`
- `GET /api/me/entitlements`
  - HTTP `200`
  - `source: safe_mode_hard_bypass`
  - `safeMode: true`
  - `tier: free`
  - `premium: false`
  - tempo: `1.828ms`

Snapshot de `/metrics` apos as chamadas:

- `safeMode.isActive=true`
- `safeMode.remoteOverrideDisabled=true`
- `safeMode.hardBypassRiskFeedCount=1`
- `safeMode.hardBypassEntitlementsCount=1`
- `riskFeed.totalRequests=1`
- `riskFeed.safeModeBypass=1`
- `riskFeed.providerCalls=0`
- `riskFeed.firestoreCalls=0`
- `riskFeed.timeouts=0`
- `entitlements.totalRequests=1`
- `entitlements.safeModeBypass=1`
- `entitlements.firestoreLookups=0`
- `entitlements.billingLookups=0`
- `entitlements.timeouts=0`

Snapshot de `/v1/ops/metrics` tambem validado com HTTP `200` e o mesmo schema novo.

## 5. Resultado Render

- Pendente.
- O deploy no Render ainda nao foi confirmado a partir deste workspace.
- Checks pendentes apos deploy:
  - `curl https://alert-vmpj.onrender.com/metrics`
  - `curl https://alert-vmpj.onrender.com/v1/ops/metrics`
  - `curl -w \"\\nTIME:%{time_total}\\n\" \"https://alert-vmpj.onrender.com/api/v1/risk/feed?...\"`
  - `curl -w \"\\nTIME:%{time_total}\\n\" \"https://alert-vmpj.onrender.com/api/me/entitlements\"`

## 6. Resultado k6 500 RPS

- Pendente.
- O teste `ALERT_K6_PHASE=500` contra Render ainda nao foi executado apos esta correcao.
- Criterio de PASS permanece:
  - RPS real `>= 450`
  - `error_rate < 1%`
  - `http_req_failed < 1%`
  - `p95 < 800ms`
  - `p99 < 1500ms`
  - timeout em `risk/feed` e `entitlements` igual a zero ou quase zero

## 7. Status

`30M NAO SUPORTA AINDA - 500 RPS remoto ainda nao foi provado`
