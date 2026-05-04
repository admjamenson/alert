# Alert Unit Economics Guardrails

This document is a planning guardrail, not a billing report.

## Non-Negotiable Caps

- Freemium variable cost must stay at or below 20% of net ad revenue per user.
- Premium variable cost must stay at or below 30% of net subscription revenue per user.

## Implemented Guardrail

The backend now has a deterministic model in `backend/src/economics/unitEconomics.js`.

Run:

```powershell
npm.cmd --prefix backend run economics:model
npm.cmd --prefix backend run economics:guardrail
npm.cmd --prefix backend run test:economics
```

Optional inputs:

```powershell
$env:ALERT_FREEMIUM_NET_AD_ARPU_USD='0.60'
$env:ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD='5.00'
$env:ALERT_PREMIUM_GROSS_BILLING_ARPU_USD='5.00'
$env:ALERT_ECONOMICS_PRICE_BOOK_PATH='C:\secure\alert-pricebook.json'
$env:ALERT_ECONOMICS_STRICT_PRICEBOOK='true'
```

Pricebook entries can be supplied through `ALERT_ECONOMICS_PRICE_BOOK_PATH` or
`ALERT_ECONOMICS_PRICE_BOOK_JSON`. Each cost may be a number, which is treated
as `estimated_reliable`, or an object with `value` and `origin`. Valid origins
are `real`, `estimated_reliable`, `modeled`, and `absent`. Strict mode accepts
only complete `real` or `estimated_reliable` mandatory costs.

The operational pricebook should live outside the repository, for example
`C:\secure\alert-pricebook.json` on an operator workstation or as a secret env
var in staging/production.

Minimum structure:

```json
{
  "costs": {
    "queueRedisMonthlyUsd": { "value": 0, "origin": "real" },
    "cacheRedisMonthlyUsd": { "value": 0, "origin": "real" },
    "workerComputeMonthlyUsd": { "value": 0, "origin": "estimated_reliable" },
    "feedServingCostUsd": { "value": 0, "origin": "modeled" },
    "providerMissCostUsd": { "value": 0, "origin": "modeled" },
    "weatherMissCostUsd": { "value": 0, "origin": "modeled" },
    "mapSessionCostUsd": { "value": 0, "origin": "estimated_reliable" },
    "routingCostUsd": { "value": 0, "origin": "modeled" },
    "sosRelayCostUsd": { "value": 0, "origin": "modeled" },
    "pushFanoutCostUsd": { "value": 0, "origin": "modeled" },
    "queueJobCostUsd": { "value": 0, "origin": "estimated_reliable" },
    "cacheOperationCostUsd": { "value": 0, "origin": "estimated_reliable" },
    "telemetryCostUsd": { "value": 0, "origin": "modeled" },
    "storageCostUsd": { "value": 0, "origin": "estimated_reliable" },
    "webServingCostUsd": { "value": 0, "origin": "estimated_reliable" },
    "backgroundWorkerExecutionCostUsd": {
      "value": 0,
      "origin": "estimated_reliable"
    },
    "paymentProcessorPercent": { "value": 0, "origin": "real" },
    "paymentProcessorFixedFeeUsd": { "value": 0, "origin": "real" },
    "appStoreFeePercent": { "value": 0, "origin": "real" },
    "playStoreFeePercent": { "value": 0, "origin": "real" }
  }
}
```

Use `origin: "absent"` when the cost is mandatory but still missing. Strict
mode must fail in that state instead of silently approving rollout.

## Cost Components Modeled

- Queue Redis monthly allocation
- Cache Redis monthly allocation
- Dedicated worker compute monthly allocation
- Feed serving
- Provider cache misses
- Weather provider misses
- Map sessions
- Routing requests
- SOS relay
- Push fan-out
- Queue jobs
- Cache operations
- Telemetry events
- Storage
- Web service enqueue/serving
- Background worker execution
- Payment processor fees
- App Store / Play Store fee percentage

## Decision Rule

If a feature path exceeds the cap, it must be rejected, cached/materialized, gated, moved to premium, or degraded to a cheaper fallback.

`economics:guardrail` is intentionally executable: it expects cached normal paths to pass, a provider-miss regression scenario to return `block_or_degrade`, and an uncached spike scenario to return `requires_cheaper_path`. A CI failure here means the economics policy changed, required cost inputs are missing in strict mode, or a cost assumption became economically unsafe.

The current queue/cache architecture is represented as separate cost inputs:
`queueRedisMonthlyUsd`, `cacheRedisMonthlyUsd`, `workerComputeMonthlyUsd`,
`webServingCostUsd`, and `backgroundWorkerExecutionCostUsd`. Do not collapse
them back into a generic Redis or backend bucket; that would hide whether the
dedicated BullMQ queue Redis, cache Redis, worker, or web enqueue path is the
source of an overrun.

## Current Classification

- Proved locally: guardrail math, allow/block decisions and tests.
- Modeled: built-in planning defaults used only when an operational pricebook is absent.
- Implemented but not billed here: per-flow cost inputs for feed, weather, maps, routing, SOS, push, queue, cache, telemetry, storage, web serving, dedicated worker execution and payment/store fees.
- Future work: connect observed provider metrics from `/v1/ops/summary` and real provider invoices into this model.
