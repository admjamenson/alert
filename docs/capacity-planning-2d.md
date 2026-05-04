# Alert Capacity Planning - Mission 2D

Generated for local engineering validation. This is not a proof of global scale.

## Architecture Split

- Ingestion: mobile clients, provider fetches, billing webhooks, SOS relay, chat relay.
- Processing: event normalization, risk scoring, entitlement resolution, route/geocode normalization.
- Serving: Express API routes, feed snapshots, operational snapshots, relay reads, billing state.
- Jobs: push fan-out, widget refresh, provider refresh, retry/dead-letter work.
- Notifications: Firebase Messaging and platform push providers; external limits are contract-bound.

## Implemented In This Round

- Provider fetch cache is now bounded by `ALERT_PROVIDER_CACHE_MAX_ENTRIES`.
- Concurrent identical provider fetches are coalesced by cache/request key.
- Provider fetch metrics expose success, cache hit, rate limit, timeout and latency.
- In-memory job queue supports idempotency, concurrency, retries, exponential backoff and dead-letter visibility.
- External cache port now has memory and Redis-compatible adapters.
- External queue port now has memory and BullMQ-compatible adapters for production wiring.
- Economics guardrail is executable and consumed by capacity scenarios.
- Local load harness can benchmark an already-running backend without external packages.
- Capacity model script emits honest scenario estimates for 100k, 10M, 100M and 1B.

## Capacity Model Assumptions

The capacity model uses MAU, DAU ratio, peak city concentration, peak-hour concentration, feed refreshes per DAU, SOS rate and push fan-out. These are planning assumptions, not production telemetry.

Use:

```powershell
npm.cmd --prefix backend run capacity:model
```

The model now includes 100k, 1M, 10M, 100M and 1B tiers, emits required controls per tier and calculates unit-economics decisions using planning ARPU assumptions.

## Local Load Harness

Use against a running backend:

```powershell
$env:ALERT_LOAD_TARGET='http://127.0.0.1:5005/healthz'
$env:ALERT_LOAD_REQUESTS='200'
$env:ALERT_LOAD_CONCURRENCY='20'
npm.cmd --prefix backend run load:local
```

The harness reports RPS, p50, p95, p99, max latency, status distribution and failures.

## Regional Load Harness

Passo 5 adds `backend/scripts/load-regional.js` for local multi-endpoint pressure. It is not a global internet test; it is a stronger local harness that mixes:

- `/healthz`
- `/v1/ops/summary`
- `/v1/events`
- `/api/v1/risk/feed`
- `/api/v1/weather/feed`
- `/v1/maps/routes`

Use:

```powershell
$env:ALERT_LOAD_BASE_URL='http://127.0.0.1:5005'
$env:ALERT_LOAD_REQUESTS='1800'
$env:ALERT_LOAD_CONCURRENCY='150'
$env:ALERT_LOAD_REGIONAL_SCENARIO='multi_region_burst'
npm.cmd --prefix backend run load:regional
```

Supported regional scenarios:

- `single_city_peak`: concentrates traffic in Sao Paulo.
- `multi_region_burst`: spreads traffic across Sao Paulo, New York, London, Tokyo and Singapore.
- `two_region_failover`: exercises a two-region failover-like distribution.

The output is grouped by endpoint and region, and explicitly classifies local backend load as proven while distributed internet load and multi-region runtime remain not proven here.

## Multi-Region Architecture Target

- Regional serving: stateless API instances per active region behind regional load balancers.
- Regional cache: Redis/Memorystore/Valkey per region with bounded TTLs, stale-while-revalidate and provider-key coalescing.
- Regional queue: BullMQ/Cloud Tasks/SQS-compatible queue per region for SOS push fan-out, retries, backoff and dead-letter.
- Hot-path materialization: city/region event snapshots precomputed for `/v1/events`, risk/weather summaries and ops summaries.
- Provider protection: per-provider regional budget, rate limit, circuit breaker, retry policy and fallback payload.
- Region awareness: clients and edge/API gateway should pass or derive a region/cell id; jobs and caches must prefix keys by region.
- Multi-instance: no in-memory-only dependency on correctness; memory cache is acceptable only as local L1.
- Multi-region: active-active serving for public read paths, region-local writes where data residency requires it, and a global control plane for config/flags.

## Readiness By Tier

### 100k

Plausible with current monolith if Firebase, Stripe, provider quotas and push quotas are correctly provisioned. Needs process manager, horizontal instances and external cache before production confidence.

### 1M

Requires horizontal backend instances, shared cache, queue-backed push fan-out and provider quota monitoring. The repo now has Redis/BullMQ-compatible ports, but this tier still needs production load tests and managed infra validation.

### 10M

Requires managed queue, external Redis/Memorystore, regional backend deployment, pre-materialized city/region feeds, push fan-out workers and provider quota contracts. The repo now has production-facing adapter contracts; the deployed infrastructure is still not proven here.

### 100M

Requires multi-region serving, CDN/edge cache for public read paths, partitioned event store, stream processing, dedicated notification pipeline, provider abstraction with paid contracts and chaos/load testing. Mostly designed, not implemented here.

### 1B

Requires global control plane, regional data planes, strict data residency, edge materialization, multi-provider push strategy, SRE/on-call, traffic engineering and abuse controls. This is model-only in this repo.

## Proven vs Modeled

- Proven locally: bounded cache behavior, request coalescing, job idempotency/retry/dead-letter, Redis/BullMQ adapter behavior with injected clients, load harness execution against local backend.
- Proven locally: regional load harness execution against a local backend, endpoint/region latency/error reporting, `/healthz`, `/v1/ops/summary` and product hot-path mix under local burst.
- Implemented but not large-scale tested: provider metrics, ops summary, monolith route separation patterns, external cache/queue wiring ports, SOS fan-out queue path when Redis/BullMQ are configured.
- Modeled: tier throughput, city peaks, simultaneous regional bursts, push fan-out, provider pressure and unit-economics by tier.
- Future infrastructure dependency: managed queues, external cache, CDN/edge, regional clusters, production provider contracts and distributed load generators.
