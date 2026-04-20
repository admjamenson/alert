# Render Redis/BullMQ Readiness

This runbook wires the `alert` backend service to Render Redis, then moves the
SOS fan-out worker out of the web process once the Redis/BullMQ path is proven.

## Required Render environment variables

Set these on the Render web service named `alert`:

```bash
ALERT_REDIS_URL=redis://red-d7ht7nn7f7vs738qoko0:6379
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_CACHE_DRIVER=redis
ALERT_REQUIRE_EXTERNAL_INFRA=true
```

After the dedicated worker is deployed, set the web service to enqueue-only
mode:

```bash
ALERT_SOS_FANOUT_WORKER_ENABLED=false
```

The worker service must keep worker mode enabled:

```bash
ALERT_SOS_FANOUT_WORKER_ENABLED=true
```

Recommended production knobs:

```bash
ALERT_REDIS_CONNECT_TIMEOUT_MS=2500
ALERT_EVENT_CACHE_KEY_PREFIX=alert:event-hub
ALERT_SOS_FANOUT_QUEUE_NAME=alert-sos-fanout
ALERT_SOS_FANOUT_CONCURRENCY=8
ALERT_SOS_FANOUT_ATTEMPTS=3
ALERT_SOS_FANOUT_BACKOFF_MS=500
ALERT_SOS_FANOUT_ENQUEUE_TIMEOUT_MS=1200
```

## Redis eviction policy

BullMQ stores waiting, active, delayed, retry, and failed-job state in Redis. A
Redis eviction policy such as `allkeys-lru` can evict queue keys under memory
pressure, which risks lost jobs, inconsistent queue counts, broken retry state,
or missing failed-job retention.

Recommended production architecture:

- Queue Redis: dedicated instance for BullMQ with `maxmemory-policy noeviction`
  and persistence enabled.
- Cache Redis: separate instance for EventHub/provider cache. `allkeys-lru` is
  acceptable here because cache keys are disposable and can be rebuilt.

If only one Redis instance is available temporarily, use `noeviction`, keep
cache TTLs short, and cap cache cardinality at the application layer. Do not run
BullMQ long-term on a shared `allkeys-lru` Redis.

The code supports separated URLs:

```bash
ALERT_QUEUE_REDIS_URL=redis://queue-redis:6379
ALERT_CACHE_REDIS_URL=redis://cache-redis:6379
```

Both fall back to `ALERT_REDIS_URL` for the already-proven single-Redis deploy.

## Dedicated worker service

Create a Render background worker service using the same repo and backend root:

```bash
cd backend && npm run worker:sos-fanout
```

Required worker env:

```bash
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_QUEUE_REDIS_URL=redis://<queue-redis-host>:6379
ALERT_REQUIRE_EXTERNAL_INFRA=true
ALERT_SOS_FANOUT_WORKER_ENABLED=true
FIREBASE_SERVICE_ACCOUNT=<same Firebase Admin JSON or file path>
```

Recommended web env after the worker is live:

```bash
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_QUEUE_REDIS_URL=redis://<queue-redis-host>:6379
ALERT_CACHE_DRIVER=redis
ALERT_CACHE_REDIS_URL=redis://<cache-redis-host>:6379
ALERT_REQUIRE_EXTERNAL_INFRA=true
ALERT_SOS_FANOUT_WORKER_ENABLED=false
```

Keep the current single-process behavior until the worker service passes smoke;
that preserves the already-proven `/api/sos` path.

## Proof command

Run this from the Render shell or a CI job with access to the Render private
network:

```bash
npm run scale:external-smoke
```

Expected proof when the private Redis is reachable:

- `env:queue-redis-url` identifies `ALERT_QUEUE_REDIS_URL`, or the compatible
  `ALERT_REDIS_URL` fallback during the already-proven single-Redis deploy.
- `env:cache-redis-url` identifies `ALERT_CACHE_REDIS_URL`, or the compatible
  `ALERT_REDIS_URL` fallback during the already-proven single-Redis deploy.
- `redis:roundtrip` passes for set/get.
- `redis:ttl` passes.
- `redis:delete` passes.
- `bullmq:enqueue-retry-dead-letter` passes.
- `flow:sos-fanout` passes, proving the SOS fan-out worker path.

If the same command is run from a developer notebook outside Render, the private
hostname may be classified as blocked rather than failed. That is an environment
boundary, not proof that the Render integration is broken.

## Product paths using the infra

- EventHub hot-path caching uses `createCacheStore`; with
  `ALERT_CACHE_DRIVER=redis`, it uses `RedisCacheStore`.
- `/api/sos` uses `createExternalSosFanoutQueue`; with
  `ALERT_JOB_QUEUE_DRIVER=bullmq`, it uses BullMQ backed by
  `ALERT_QUEUE_REDIS_URL` or `ALERT_REDIS_URL`.
- SOS keeps inline fail-soft through `SosFanoutDispatcher` if enqueue fails or
  exceeds `ALERT_SOS_FANOUT_ENQUEUE_TIMEOUT_MS`.

## Cost note

Two Redis instances cost more than one, but the split is economically cleaner:
the queue instance protects SOS reliability and should be sized for jobs, retry,
and failed-job retention; the cache instance can be cheaper and tuned for churn.
This makes unit economics measurable by separating cache operations from queue
operations in the pricebook.

Operational pricebook inputs should be injected through one of:

```bash
ALERT_ECONOMICS_PRICE_BOOK_PATH=/etc/secrets/alert-pricebook.json
ALERT_ECONOMICS_PRICE_BOOK_JSON={"costs":{...}}
```

The pricebook must keep queue and cache costs separate with
`queueRedisMonthlyUsd`, `cacheRedisMonthlyUsd`, `queueJobCostUsd`,
`cacheOperationCostUsd`, `workerComputeMonthlyUsd`, `webServingCostUsd`, and
`backgroundWorkerExecutionCostUsd`. Enable strict mode in staging before
release gates:

```bash
ALERT_ECONOMICS_STRICT_PRICEBOOK=true
```
