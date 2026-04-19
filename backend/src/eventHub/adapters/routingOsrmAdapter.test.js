const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchRouteOptions,
  __dangerousResetRoutingProviderStateForTests,
} = require('./routingOsrmAdapter');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test.beforeEach(() => {
  __dangerousResetRoutingProviderStateForTests();
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
