# Alert Operational Cost And Release Inputs

These files are operator-facing templates for the final honest classification gates.

## Files

- `alert-pricebook.template.json`
  Copy to a secure path, replace every `origin: "absent"` entry with `real` or `estimated_reliable`, and add the supporting invoice, quote, or measurement note.
- `release-metrics.template.json`
  Copy to a secure path and populate the live release SLO metrics for the current rollout window.

## Required operational inputs

The strict gates only close when both inputs are present:

1. A complete operational pricebook with every mandatory cost classified as `real` or `estimated_reliable`.
2. A complete release metrics payload with the live SLO observations required by `release:gate`.

## What can be sourced from public pricing

Only use public pricing when it actually matches the active billing path or enrolled program.

- `paymentProcessorPercent` and `paymentProcessorFixedFeeUsd`
  Stripe public pricing is currently `2.9% + $0.30` for successful domestic card transactions in the US. Treat this as `estimated_reliable` unless you have invoice-backed settlement data for the active account.
  Source: `https://stripe.com/pricing`
- `playStoreFeePercent`
  Google Play subscriptions are currently `15%` for automatically renewing subscriptions. This can usually be `estimated_reliable` for the current Android subscription path.
  Source: `https://support.google.com/googleplay/android-developer/answer/112622`
- `appStoreFeePercent`
  Apple's reduced Small Business Program commission is currently `15%`, but it only applies when the developer account is eligible and enrolled. Keep this `absent` unless the active account is confirmed to use that tier or another known rate.
  Source: `https://developer.apple.com/app-store/small-business-program/`

## What still requires operator-specific evidence

These must come from the actual deployed setup, invoice, contract, or a measured internal rate:

- `queueRedisMonthlyUsd`
- `cacheRedisMonthlyUsd`
- `workerComputeMonthlyUsd`
- `feedServingCostUsd`
- `providerMissCostUsd`
- `weatherMissCostUsd`
- `mapSessionCostUsd`
- `routingCostUsd`
- `sosRelayCostUsd`
- `pushFanoutCostUsd`
- `queueJobCostUsd`
- `cacheOperationCostUsd`
- `telemetryCostUsd`
- `storageCostUsd`
- `webServingCostUsd`
- `backgroundWorkerExecutionCostUsd`

Public provider or infrastructure pricing is not enough by itself when the repo does not pin the active service tier, plan, contract, or quota.

For the current Alert codebase, these provider paths are visible but still not enough to auto-close cost inputs:

- Mobile map raster styles currently point to CARTO and Esri fallback tiles in `src/constants/MapStyles.ts`.
- Weather hot path currently uses Open-Meteo and BigDataCloud reverse geocoding in `backend/src/eventHub/adapters/weatherFeedOpenMeteoAdapter.js`.
- Routing still uses OSRM targets configured through Render env in `backend/src/eventHub/adapters/routingOsrmAdapter.js`.
- Redis, web service, and background worker costs depend on the actual Render instance types selected by the operator.

Useful public pricing references:

- Render compute and Key Value pricing: `https://render.com/pricing`
- Render Key Value docs: `https://render.com/docs/key-value`

## PowerShell example

```powershell
$env:ALERT_ECONOMICS_PRICE_BOOK_PATH='C:\secure\alert-pricebook.json'
$env:ALERT_ECONOMICS_STRICT_PRICEBOOK='true'
$env:ALERT_RELEASE_METRICS_JSON=(Get-Content -Raw 'C:\secure\alert-release-metrics.json')
$env:ALERT_RELEASE_VERSION='2026.04.29-canary'
$env:ALERT_PREVIOUS_RELEASE_VERSION='2026.04.28'
$env:ALERT_CANARY_PERCENT='1'

npm --prefix backend run economics:guardrail
npm --prefix backend run release:gate
npm --prefix backend run capacity:model
```

## Expected honest outcomes

- `economics:guardrail`
  Must not return `strict_failed`.
- `release:gate`
  Must not hold because of `operational_pricebook_incomplete` or `missing_required_release_metrics`.
- `capacity:model`
  Must not return `blocked_missing_operational_pricebook`.

If any of those still fail, the Alert classification remains blocked and must not be promoted.
