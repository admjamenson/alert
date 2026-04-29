const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchRouteOptions,
  buildRoutingProviderDebugSnapshot,
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
  assert.equal(calls, 2);
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

test('routing adapter prefers a regional provider target when region hint matches', async () => {
  let capturedUrl = null;

  const payload = await fetchRouteOptions(
    {
      fromLat: -23.5505,
      fromLon: -46.6333,
      toLat: -23.5617,
      toLon: -46.6559,
      transportMode: 'walking',
      regionHint: 'sa-east-1-sao-paulo',
    },
    {
      logger: silentLogger,
      config: {
        routing: {
          providerBaseUrl: 'https://route-primary.alert.example/route/v1',
          regionProviderBaseUrls: {
            'sa-east-1': 'https://route-sa.alert.example/route/v1',
          },
        },
      },
      fetchJson: async url => {
        capturedUrl = url;
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
                    [-46.6333, -23.5505],
                    [-46.6559, -23.5617],
                  ],
                },
              },
            ],
          },
          cached: false,
          fetchedAt: '2026-04-27T15:00:00.000Z',
          attempts: 1,
          durationMs: 44,
        };
      },
    },
  );

  assert.equal(payload.ok, true);
  assert.match(capturedUrl, /^https:\/\/route-sa\.alert\.example\/route\/v1\/walking\//);
  assert.equal(payload.providerTargetId, 'osrm:region:sa-east-1');
  assert.equal(payload.providerSource, 'region');
  assert.equal(payload.providerRegionKey, 'sa-east-1');
});

test('routing adapter falls back from a degraded regional provider to the primary provider within budget', async () => {
  const urls = [];

  const payload = await fetchRouteOptions(
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.758,
      toLon: -73.9855,
      transportMode: 'walking',
      regionHint: 'us-east-1-new-york',
    },
    {
      logger: silentLogger,
      now: (() => {
        let current = 10_000;
        return () => {
          current += 150;
          return current;
        };
      })(),
      config: {
        routing: {
          providerBaseUrl: 'https://route-primary.alert.example/route/v1',
          regionProviderBaseUrls: {
            'us-east-1': 'https://route-use1.alert.example/route/v1',
          },
          timeoutMs: 1400,
          retries: 0,
          maxTotalWaitMs: 2200,
        },
      },
      fetchJson: async url => {
        urls.push(url);
        if (url.startsWith('https://route-use1.alert.example/route/v1/')) {
          return {
            ok: false,
            status: 0,
            error: 'network_error',
            errorType: 'timeout',
            fetchedAt: '2026-04-27T15:00:00.000Z',
            attempts: 1,
            durationMs: 700,
          };
        }
        return {
          ok: true,
          status: 200,
          json: {
            routes: [
              {
                distance: 3200,
                duration: 1200,
                geometry: {
                  coordinates: [
                    [-74.006, 40.7128],
                    [-73.9855, 40.758],
                  ],
                },
              },
            ],
          },
          cached: false,
          fetchedAt: '2026-04-27T15:00:01.000Z',
          attempts: 1,
          durationMs: 420,
        };
      },
    },
  );

  assert.equal(payload.ok, true);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/route-use1\.alert\.example\/route\/v1\/walking\//);
  assert.match(urls[1], /^https:\/\/route-primary\.alert\.example\/route\/v1\/walking\//);
  assert.equal(payload.providerTargetId, 'osrm:primary');
  assert.equal(payload.providerSource, 'primary');
});

test('routing adapter gives a secondary provider a short recovery window before declaring budget exhausted', async () => {
  const urls = [];

  const payload = await fetchRouteOptions(
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.758,
      toLon: -73.9855,
      transportMode: 'walking',
      regionHint: 'us-east-1-new-york',
    },
    {
      logger: silentLogger,
      now: (() => {
        const values = [10_000, 10_000, 10_910, 11_020, 11_140];
        let index = 0;
        return () => {
          const value = values[Math.min(index, values.length - 1)];
          index += 1;
          return value;
        };
      })(),
      config: {
        routing: {
          providerBaseUrl: 'https://route-primary.alert.example/route/v1',
          fallbackProviderBaseUrl: 'https://route-fallback.alert.example/route/v1',
          timeoutMs: 900,
          retries: 0,
          maxTotalWaitMs: 1400,
        },
      },
      fetchJson: async (url, options = {}) => {
        urls.push({ url, timeoutMs: options.timeoutMs });
        if (url.startsWith('https://route-primary.alert.example/route/v1/')) {
          return {
            ok: false,
            status: 0,
            error: 'network_error',
            errorType: 'timeout',
            fetchedAt: '2026-04-28T19:30:00.000Z',
            attempts: 1,
            durationMs: 900,
          };
        }
        return {
          ok: true,
          status: 200,
          json: {
            routes: [
              {
                distance: 3200,
                duration: 1200,
                geometry: {
                  coordinates: [
                    [-74.006, 40.7128],
                    [-73.9855, 40.758],
                  ],
                },
              },
            ],
          },
          cached: false,
          fetchedAt: '2026-04-28T19:30:01.000Z',
          attempts: 1,
          durationMs: 120,
        };
      },
    },
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.providerTargetId, 'osrm:fallback');
  assert.equal(urls.length, 2);
  assert.equal(urls[0].timeoutMs, 900);
  assert.equal(urls[1].timeoutMs, 380);
});

test('routing adapter isolates circuit state by region so one bad region does not poison another', async () => {
  const config = {
    routing: {
      providerBaseUrl: 'https://route-primary.alert.example/route/v1',
      timeoutMs: 1400,
      retries: 0,
      failureThreshold: 2,
    },
  };
  const failingFetch = async () => ({
    ok: false,
    status: 0,
    error: 'network_error',
    errorType: 'timeout',
    fetchedAt: '2026-04-27T16:00:00.000Z',
    attempts: 1,
    durationMs: 700,
  });

  await fetchRouteOptions(
    {
      fromLat: -23.5505,
      fromLon: -46.6333,
      toLat: -23.5617,
      toLon: -46.6559,
      transportMode: 'walking',
      regionHint: 'sa-east-1-sao-paulo',
    },
    {
      logger: silentLogger,
      config,
      now: () => 5_000,
      fetchJson: failingFetch,
    },
  );

  await fetchRouteOptions(
    {
      fromLat: -23.5505,
      fromLon: -46.6333,
      toLat: -23.5617,
      toLon: -46.6559,
      transportMode: 'walking',
      regionHint: 'sa-east-1-sao-paulo',
    },
    {
      logger: silentLogger,
      config,
      now: () => 5_001,
      fetchJson: failingFetch,
    },
  );

  let healthyRegionCalled = false;
  const healthyPayload = await fetchRouteOptions(
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.758,
      toLon: -73.9855,
      transportMode: 'walking',
      regionHint: 'us-east-1-new-york',
    },
    {
      logger: silentLogger,
      config,
      now: () => 5_002,
      fetchJson: async () => {
        healthyRegionCalled = true;
        return {
          ok: true,
          status: 200,
          json: {
            routes: [
              {
                distance: 3200,
                duration: 1200,
                geometry: {
                  coordinates: [
                    [-74.006, 40.7128],
                    [-73.9855, 40.758],
                  ],
                },
              },
            ],
          },
          cached: false,
          fetchedAt: '2026-04-27T16:00:02.000Z',
          attempts: 1,
          durationMs: 420,
        };
      },
    },
  );

  assert.equal(healthyRegionCalled, true);
  assert.equal(healthyPayload.ok, true);
  assert.equal(healthyPayload.providerTargetId, 'osrm:primary');
});

test('routing adapter preserves primary before fallback even after a fallback success', async () => {
  const urls = [];
  const config = {
    routing: {
      providerBaseUrl: 'https://route-primary.alert.example/route/v1',
      fallbackProviderBaseUrl: 'https://route-fallback.alert.example/route/v1',
      timeoutMs: 1400,
      retries: 0,
      maxTotalWaitMs: 2200,
    },
  };
  const params = {
    fromLat: 51.5072,
    fromLon: -0.1276,
    toLat: 51.5155,
    toLon: -0.1419,
    transportMode: 'walking',
    regionHint: 'eu-west-2-london',
  };

  const firstPayload = await fetchRouteOptions(params, {
    logger: silentLogger,
    config,
    now: (() => {
      let current = 20_000;
      return () => {
        current += 120;
        return current;
      };
    })(),
    fetchJson: async url => {
      urls.push(url);
      if (url.startsWith('https://route-primary.alert.example/route/v1/')) {
        return {
          ok: false,
          status: 0,
          error: 'network_error',
          errorType: 'timeout',
          fetchedAt: '2026-04-27T16:02:00.000Z',
          attempts: 1,
          durationMs: 650,
        };
      }
      return {
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 2400,
              duration: 860,
              geometry: {
                coordinates: [
                  [-0.1276, 51.5072],
                  [-0.1419, 51.5155],
                ],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-27T16:02:01.000Z',
        attempts: 1,
        durationMs: 410,
      };
    },
  });

  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.providerTargetId, 'osrm:fallback');

  urls.length = 0;
  const secondPayload = await fetchRouteOptions(params, {
    logger: silentLogger,
    config,
    fetchJson: async url => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 2400,
              duration: 860,
              geometry: {
                coordinates: [
                  [-0.1276, 51.5072],
                  [-0.1419, 51.5155],
                ],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-27T16:02:02.000Z',
        attempts: 1,
        durationMs: 300,
      };
    },
  });

  assert.equal(secondPayload.ok, true);
  assert.match(urls[0], /^https:\/\/route-primary\.alert\.example\/route\/v1\/walking\//);
});

test('routing adapter preserves region before primary even after a primary success for the same region', async () => {
  const urls = [];
  const config = {
    routing: {
      providerBaseUrl: 'https://route-primary.alert.example/route/v1',
      regionProviderBaseUrls: {
        'eu-west-2': 'https://route-euw2.alert.example/route/v1',
      },
      timeoutMs: 1400,
      retries: 0,
      maxTotalWaitMs: 2200,
    },
  };
  const params = {
    fromLat: 51.5072,
    fromLon: -0.1276,
    toLat: 51.5155,
    toLon: -0.1419,
    transportMode: 'walking',
    regionHint: 'eu-west-2-london',
  };

  const firstPayload = await fetchRouteOptions(params, {
    logger: silentLogger,
    config,
    now: (() => {
      let current = 30_000;
      return () => {
        current += 120;
        return current;
      };
    })(),
    fetchJson: async url => {
      urls.push(url);
      if (url.startsWith('https://route-euw2.alert.example/route/v1/')) {
        return {
          ok: false,
          status: 0,
          error: 'network_error',
          errorType: 'timeout',
          fetchedAt: '2026-04-27T16:04:00.000Z',
          attempts: 1,
          durationMs: 650,
        };
      }
      return {
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 2400,
              duration: 860,
              geometry: {
                coordinates: [
                  [-0.1276, 51.5072],
                  [-0.1419, 51.5155],
                ],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-27T16:04:01.000Z',
        attempts: 1,
        durationMs: 410,
      };
    },
  });

  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.providerTargetId, 'osrm:primary');

  urls.length = 0;
  const secondPayload = await fetchRouteOptions(params, {
    logger: silentLogger,
    config,
    fetchJson: async url => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: {
          routes: [
            {
              distance: 2400,
              duration: 860,
              geometry: {
                coordinates: [
                  [-0.1276, 51.5072],
                  [-0.1419, 51.5155],
                ],
              },
            },
          ],
        },
        cached: false,
        fetchedAt: '2026-04-27T16:04:02.000Z',
        attempts: 1,
        durationMs: 300,
      };
    },
  });

  assert.equal(secondPayload.ok, true);
  assert.match(urls[0], /^https:\/\/route-euw2\.alert\.example\/route\/v1\/walking\//);
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

test('routing adapter serves stale route snapshot immediately when the circuit is already open', async () => {
  const baseParams = {
    fromLat: -3.73,
    fromLon: -38.52,
    toLat: -3.74,
    toLon: -38.5,
    transportMode: 'walking',
  };

  await fetchRouteOptions(baseParams, {
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

  const failingFetch = async () => ({
    ok: false,
    status: 0,
    error: 'network_error',
    errorType: 'timeout',
    fetchedAt: '2026-04-21T18:02:00.000Z',
    attempts: 1,
    durationMs: 1400,
  });

  await fetchRouteOptions(baseParams, {
    logger: silentLogger,
    now: () => 5_000,
    config: { routing: { failureThreshold: 2, timeoutMs: 1400 } },
    fetchJson: failingFetch,
  });
  await fetchRouteOptions(baseParams, {
    logger: silentLogger,
    now: () => 5_001,
    config: { routing: { failureThreshold: 2, timeoutMs: 1400 } },
    fetchJson: failingFetch,
  });

  let providerCalled = false;
  const circuitPayload = await fetchRouteOptions(baseParams, {
    logger: silentLogger,
    now: () => 5_002,
    config: { routing: { failureThreshold: 2, timeoutMs: 1400 } },
    fetchJson: async () => {
      providerCalled = true;
      return failingFetch();
    },
  });

  assert.equal(providerCalled, false);
  assert.equal(circuitPayload.ok, true);
  assert.equal(circuitPayload.stale, true);
  assert.equal(circuitPayload.reasonCode, 'routing_provider_stale_snapshot');
});

test('routing adapter fails fast with provider_saturated when global route concurrency is exhausted', async () => {
  let releaseFetch;
  const blocker = new Promise(resolve => {
    releaseFetch = resolve;
  });

  const firstCall = fetchRouteOptions(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'walking',
    },
    {
      logger: silentLogger,
      config: { routing: { maxConcurrentRequests: 1, timeoutMs: 1400 } },
      fetchJson: async () => {
        await blocker;
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
          durationMs: 35,
        };
      },
    },
  );

  await new Promise(resolve => setImmediate(resolve));

  const secondCall = await fetchRouteOptions(
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.758,
      toLon: -73.9855,
      transportMode: 'walking',
    },
    {
      logger: silentLogger,
      config: { routing: { maxConcurrentRequests: 1, timeoutMs: 1400 } },
      fetchJson: async () => {
        throw new Error('should_not_run_when_saturated');
      },
    },
  );

  releaseFetch();
  await firstCall;

  assert.equal(secondCall.ok, false);
  assert.equal(secondCall.reasonCode, 'routing_provider_saturated');
  assert.equal(secondCall.meta.attempts, 0);
});

test('routing adapter keeps multi-region burst responses healthy with the restored concurrency budget', async () => {
  const requests = [
    {
      fromLat: -23.5505,
      fromLon: -46.6333,
      toLat: -23.5617,
      toLon: -46.6559,
      regionHint: 'sa-east-1-sao-paulo',
    },
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.758,
      toLon: -73.9855,
      regionHint: 'us-east-1-new-york',
    },
    {
      fromLat: 51.5072,
      fromLon: -0.1276,
      toLat: 51.5155,
      toLon: -0.1419,
      regionHint: 'eu-west-2-london',
    },
    {
      fromLat: 35.6762,
      fromLon: 139.6503,
      toLat: 35.6895,
      toLon: 139.6917,
      regionHint: 'ap-northeast-1-tokyo',
    },
    {
      fromLat: 1.3521,
      fromLon: 103.8198,
      toLat: 1.2834,
      toLon: 103.8607,
      regionHint: 'ap-southeast-1-singapore',
    },
    {
      fromLat: -23.5505,
      fromLon: -46.6333,
      toLat: -23.5618,
      toLon: -46.6558,
      regionHint: 'sa-east-1-sao-paulo',
    },
    {
      fromLat: 40.7128,
      fromLon: -74.006,
      toLat: 40.7581,
      toLon: -73.9854,
      regionHint: 'us-east-1-new-york',
    },
    {
      fromLat: 51.5072,
      fromLon: -0.1276,
      toLat: 51.5156,
      toLon: -0.1418,
      regionHint: 'eu-west-2-london',
    },
  ];
  const observedUrls = [];

  const results = await Promise.all(
    requests.map(routeRequest =>
      fetchRouteOptions(
        {
          ...routeRequest,
          transportMode: 'walking',
        },
        {
          logger: silentLogger,
          config: {
            routing: {
              providerBaseUrl: 'https://route-primary.alert.example/route/v1',
              fallbackProviderBaseUrl:
                'https://route-fallback.alert.example/route/v1',
              maxConcurrentRequests: 4,
              timeoutMs: 900,
              retries: 0,
              maxTotalWaitMs: 1400,
            },
          },
          fetchJson: async url => {
            observedUrls.push(url);
            await new Promise(resolve => setTimeout(resolve, 20));
            return {
              ok: true,
              status: 200,
              json: {
                routes: [
                  {
                    distance: 2200,
                    duration: 860,
                    geometry: {
                      coordinates: [
                        [routeRequest.fromLon, routeRequest.fromLat],
                        [routeRequest.toLon, routeRequest.toLat],
                      ],
                    },
                  },
                ],
              },
              cached: false,
              fetchedAt: '2026-04-28T17:40:00.000Z',
              attempts: 1,
              durationMs: 20,
            };
          },
        },
      ),
    ),
  );

  assert.equal(results.filter(result => result.ok).length, 8);
  assert.equal(results.filter(result => result.degraded).length, 0);
  assert.equal(
    results.filter(result => result.providerTargetId === 'osrm:primary').length,
    4,
  );
  assert.equal(
    results.filter(result => result.providerTargetId === 'osrm:fallback').length,
    4,
  );
  assert.equal(
    observedUrls.filter(url =>
      url.startsWith('https://route-primary.alert.example/route/v1/'),
    ).length,
    4,
  );
  assert.equal(
    observedUrls.filter(url =>
      url.startsWith('https://route-fallback.alert.example/route/v1/'),
    ).length,
    4,
  );
});

test('routing adapter exposes safe target resolution diagnostics for route probes', () => {
  const debugSnapshot = buildRoutingProviderDebugSnapshot(
    {
      regionHint: 'us-east-1-new-york',
      transportMode: 'walking',
    },
    {
      config: {
        routing: {
          providerBaseUrl: 'https://route-primary.alert.example/route/v1',
          fallbackProviderBaseUrl:
            'https://route-fallback.alert.example/route/v1',
          regionProviderBaseUrls: {
            'us-east-1': 'https://route-use1.alert.example/route/v1',
          },
        },
      },
    },
  );

  assert.equal(debugSnapshot.normalizedRegionHint, 'us-east-1-new-york');
  assert.equal(
    debugSnapshot.resolvedRegionalTarget?.targetId,
    'osrm:region:us-east-1',
  );
  assert.deepEqual(
    debugSnapshot.candidateTargets.map(target => target.targetId),
    ['osrm:region:us-east-1', 'osrm:primary', 'osrm:fallback'],
  );
});
