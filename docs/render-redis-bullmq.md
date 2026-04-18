# Render Redis/BullMQ Readiness

This runbook is intentionally narrow: it wires the `alerta` backend service to
the private Redis provisioned in Render and proves cache plus BullMQ from inside
the compatible environment.

## Required Render environment variables

Set these on the Render web service named `alerta`:

```bash
ALERT_REDIS_URL=redis://red-d7ht7nn7f7vs738qoko0:6379
ALERT_JOB_QUEUE_DRIVER=bullmq
ALERT_CACHE_DRIVER=redis
ALERT_REQUIRE_EXTERNAL_INFRA=true
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

## Proof command

Run this from the Render shell or a CI job with access to the Render private
network:

```bash
npm run scale:external-smoke
```

Expected proof when the private Redis is reachable:

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
  `ALERT_JOB_QUEUE_DRIVER=bullmq`, it uses BullMQ backed by `ALERT_REDIS_URL`.
- SOS keeps inline fail-soft through `SosFanoutDispatcher` if enqueue fails or
  exceeds `ALERT_SOS_FANOUT_ENQUEUE_TIMEOUT_MS`.
