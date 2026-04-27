# Render Routing Provider for 100M Readiness

## Goal

Remove the public OSRM endpoint from the hot path used by `GET /v1/maps/routes` and move Render to a dedicated or regionalized route provider setup.

## Required Render env vars

Set these on the web service that serves `GET /v1/maps/routes`:

```text
ROUTING_OSRM_BASE_URL=https://<primary-route-provider>/route/v1
ROUTING_OSRM_FALLBACK_BASE_URL=https://<fallback-route-provider>/route/v1
ROUTING_OSRM_REGION_BASE_URLS_JSON={"sa-east-1":"https://<sa-provider>/route/v1","us-east-1":"https://<us-provider>/route/v1","eu-west-2":"https://<eu-provider>/route/v1","ap-northeast-1":"https://<apne-provider>/route/v1","ap-southeast-1":"https://<apse-provider>/route/v1"}
ROUTING_PROVIDER_TIMEOUT_MS=900
ROUTING_PROVIDER_RETRIES=0
ROUTING_PROVIDER_RETRY_DELAY_MS=120
ROUTING_PROVIDER_MAX_TOTAL_WAIT_MS=1400
ROUTING_PROVIDER_FAILURE_THRESHOLD=2
ROUTING_PROVIDER_COOLDOWN_MS=30000
ROUTING_PROVIDER_MAX_CONCURRENT_REQUESTS=2
ROUTING_PROVIDER_CACHE_TTL_MS=300000
ROUTING_PROVIDER_STALE_ROUTE_TTL_MS=900000
ROUTING_PROVIDER_STALE_ROUTE_MAX_ENTRIES=1000
ROUTING_PROVIDER_MAX_PER_MINUTE=240
```

## Selection order

The route adapter now resolves providers in this order:

1. regional provider from `ROUTING_OSRM_REGION_BASE_URLS_JSON`, using `x-alert-region`
2. primary provider from `ROUTING_OSRM_BASE_URL`
3. fallback provider from `ROUTING_OSRM_FALLBACK_BASE_URL`

The adapter deduplicates identical base URLs and only tries another provider if there is enough latency budget left in the same request.

## Operational behavior

- `provider_selected` logs the target picked for the request.
- `provider_fallback_next` logs when the adapter skips to the next configured provider.
- `short_circuit`, `provider_saturated`, `provider_failure`, and `stale_snapshot_used` remain active.
- Stale route snapshots are returned early when the chosen provider is already open, saturated, or out of remaining budget.
- Estimated straight-line fallback still stays explicit with `degraded: true`.

## Validation

After updating env vars and redeploying Render:

```powershell
$env:ALERT_LOAD_BASE_URL='https://alert-vmpj.onrender.com'
$env:ALERT_LOAD_REQUESTS='120'
$env:ALERT_LOAD_CONCURRENCY='12'
$env:ALERT_LOAD_TIMEOUT_MS='5000'
npm.cmd --prefix backend run readiness:100m:staging
curl.exe -sS https://alert-vmpj.onrender.com/v1/ops/summary
```

## Acceptance criteria

Only treat the routing path as materially improved when all of these hold:

- `maps_routes p95 <= 1800 ms`
- `maps_routes degradedRate <= 0.5`
- `maps-route:walk timeout <= 1`
- `maps-route:walk avgLatencyMs <= 700`
- no regression in `risk_feed` or `weather_feed`

## Rejection criteria

Hold rollout if any of these happen:

- `maps_routes` keeps passing only because stale snapshots dominate
- `degradedRate > 0.5`
- provider fallback loops without reducing p95
- provider metrics still show multi-second average latency under staging load
