const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchRouteOptions,
  __dangerousResetRoutingProviderStateForTests,
  __dangerousResetStaleRouteCacheForTests,
} = require('./routingOsrmAdapter');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test.beforeEach(() => {
  __dangerousResetRoutingProviderStateForTests();
  __dangerousResetStaleRouteCacheForTests();
});

test('routing adapter returns normalized route payload on provider success', async () => {
  const payload = await fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'car',
    },
    {
      logger: silentLogger,
      now: () => 1_000,
      fetchJson: async () => ({
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 1500,
              duration: 240,
              geometry: {
                coordinates: [
                  [-38.52, -3.73],
                  [-38.5, -3.74],
                ],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-09T02:21:00.000Z',
        attempts: 1,
        durationMs: 42,
      }),
    },
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.reasonCode, null);
  assert.equal(payload.routes.length, 1);
  assert.equal(payload.providerId, 'osrm');
  assert.equal(payload.meta.circuitState, 'closed');
});

test('routing adapter opens the circuit after repeated transient failures', async () => {
  let calls = 0;
  const failingFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      errorType: 'network',
      fetchedAt: '2026-04-09T02:21:00.000Z',
      attempts: 2,
      durationMs: 310,
    };
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = await fetchRouteOptions(
      {
        fromLat: -3.73,
        fromLon: -38.52,
        toLat: -3.74,
        toLon: -38.5,
        transportMode: 'car',
      },
      {
        logger: silentLogger,
        now: () => 5_000,
        fetchJson: failingFetch,
      },
    );
    assert.equal(payload.ok, false);
  }

  const shortCircuited = await fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'car',
    },
    {
      logger: silentLogger,
      now: () => 5_001,
      fetchJson: failingFetch,
    },
  );

  assert.equal(shortCircuited.reasonCode, 'routing_provider_circuit_open');
  assert.equal(shortCircuited.meta.circuitState, 'open');
  assert.equal(calls, 3);
});

test('routing adapter categorizes invalid provider payload without crashing', async () => {
  const payload = await fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'car',
    },
    {
      logger: silentLogger,
      now: () => 8_000,
      fetchJson: async () => ({
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 1500,
              duration: 240,
              geometry: {
                coordinates: [[-38.52, -3.73]],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-09T02:21:00.000Z',
        attempts: 1,
        durationMs: 20,
      }),
    },
  );

  assert.equal(payload.ok, false);
  assert.equal(payload.reasonCode, 'routing_invalid_payload');
  assert.equal(payload.retryable, false);
});

test('routing adapter limits retries to stay within hot-path total wait budget', async () => {
  let capturedRetries = null;
  let capturedRetryDelayMs = null;

  await fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'walk',
    },
    {
      logger: silentLogger,
      now: () => 10_000,
      config: {
        routing: {
          timeoutMs: 2600,
          retries: 2,
          retryDelayMs: 180,
          maxTotalWaitMs: 3000,
        },
      },
      fetchJson: async (_url, options = {}) => {
        capturedRetries = options.retries;
        capturedRetryDelayMs = options.retryDelayMs;
        return {
          ok: false,
          status: 0,
          error: 'network_error',
          errorType: 'network',
          fetchedAt: '2026-04-21T18:00:00.000Z',
          attempts: 1,
          durationMs: 2600,
        };
      },
    },
  );

  assert.equal(capturedRetries, 0);
  assert.equal(capturedRetryDelayMs, 180);
});

test('routing adapter accepts walking alias as walk profile', async () => {
  let capturedCacheKey = null;

  const payload = await fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'walking',
    },
    {
      logger: silentLogger,
      fetchJson: async (_url, options = {}) => {
        capturedCacheKey = options.cacheKey;
        return {
          ok: true,
          status: 200,
          json: {
            routes: [
              {
                distance: 1500,
                duration: 900,
                geometry: {
                  coordinates: [
                    [-38.52, -3.73],
                    [-38.5, -3.74],
                  ],
                },
              },
            ],
          },
          cached: false,
          fetchedAt: '2026-04-21T18:00:00.000Z',
          attempts: 1,
          durationMs: 40,
        };
      },
    },
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.transportMode, 'walk');
  assert.match(capturedCacheKey, /^maps-route:walk:/);
});

test('routing adapter serves stale route snapshot on provider timeout after a prior success', async () => {
  const baseParams = {
    fromLat: -3.73,
    fromLon: -38.52,
    toLat: -3.74,
    toLon: -38.5,
    transportMode: 'walking',
  };

  const successPayload = await fetchRouteOptions(baseParams, {
    logger: silentLogger,
    fetchJson: async () => ({
      ok: true,
      status: 200,
      json: {
        routes: [
          {
            distance: 1500,
            duration: 900,
            geometry: {
              coordinates: [
                [-38.52, -3.73],
                [-38.5, -3.74],
              ],
            },
          },
        ],
      },
      cached: false,
      fetchedAt: '2026-04-21T18:00:00.000Z',
      attempts: 1,
      durationMs: 35,
    }),
  });
  assert.equal(successPayload.ok, true);

  const stalePayload = await fetchRouteOptions(baseParams, {
    logger: silentLogger,
    fetchJson: async () => ({
      ok: false,
      status: 0,
      error: 'network_error',
      errorType: 'timeout',
      fetchedAt: '2026-04-21T18:02:00.000Z',
      attempts: 1,
      durationMs: 1700,
    }),
  });

  assert.equal(stalePayload.ok, true);
  assert.equal(stalePayload.stale, true);
  assert.equal(stalePayload.reasonCode, 'routing_provider_stale_snapshot');
  assert.equal(stalePayload.transportMode, 'walk');
  assert.equal(stalePayload.routes.length, 1);
});
