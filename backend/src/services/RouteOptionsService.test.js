const test = require('node:test');
const assert = require('node:assert/strict');
const { getRouteOptionsSnapshot } = require('./RouteOptionsService');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test('route options service returns online payload when provider succeeds', async () => {
  const payload = await getRouteOptionsSnapshot(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'car',
    },
    {
      logger: silentLogger,
      config: {
        weather: { userAgent: 'AlertBackend/Tests' },
        routing: { timeoutMs: 2600 },
      },
      routingProvider: async () => ({
        ok: true,
        degraded: false,
        reasonCode: null,
        retryable: false,
        routes: [
          {
            id: 'provider-route',
            title: 'Fastest',
            distanceMeters: 1800,
            durationSec: 240,
            geometry: [
              [-38.52, -3.73],
              [-38.5, -3.74],
            ],
            trafficLevel: 'unknown',
          },
        ],
        updatedAt: '2026-04-09T02:21:00.000Z',
        providerId: 'osrm',
        transportMode: 'car',
        meta: {
          circuitState: 'closed',
          attempts: 1,
          cacheHit: false,
          latencyMs: 48,
          timeoutMs: 2600,
        },
      }),
    },
  );

  assert.equal(payload.available, true);
  assert.equal(payload.degraded, false);
  assert.equal(payload.fallbackUsed, false);
  assert.equal(payload.routeMode, 'provider');
  assert.equal(payload.precision, 'high');
  assert.equal(payload.providerAvailable, true);
  assert.equal(payload.advisory, null);
  assert.equal(payload.routes.length, 1);
  assert.equal(payload.provider.id, 'osrm');
});

test('route options service falls back safely when provider times out', async () => {
  const payload = await getRouteOptionsSnapshot(
    {
      fromLat: -3.73,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'walk',
    },
    {
      logger: silentLogger,
      config: {
        weather: { userAgent: 'AlertBackend/Tests' },
        routing: { timeoutMs: 2600 },
      },
      routingProvider: async () => ({
        ok: false,
        degraded: true,
        reasonCode: 'routing_provider_timeout',
        retryable: true,
        routes: [],
        updatedAt: '2026-04-09T02:21:00.000Z',
        providerId: 'osrm',
        transportMode: 'walk',
        meta: {
          circuitState: 'open',
          attempts: 2,
          cacheHit: false,
          latencyMs: 2601,
          timeoutMs: 2600,
        },
      }),
    },
  );

  assert.equal(payload.available, true);
  assert.equal(payload.degraded, true);
  assert.equal(payload.fallbackUsed, true);
  assert.equal(payload.routeMode, 'estimated_straight_line');
  assert.equal(payload.precision, 'low');
  assert.equal(payload.providerAvailable, false);
  assert.equal(payload.reasonCode, 'routing_provider_timeout');
  assert.equal(payload.advisory?.code, 'route_advisory_estimated_straight_line');
  assert.equal(payload.routes.length, 1);
  assert.deepEqual(payload.routes[0].geometry, [
    [-38.52, -3.73],
    [-38.5, -3.74],
  ]);
});

test('route options service rejects invalid coordinates without fallback noise', async () => {
  const payload = await getRouteOptionsSnapshot(
    {
      fromLat: null,
      fromLon: -38.52,
      toLat: -3.74,
      toLon: -38.5,
      transportMode: 'car',
    },
    {
      logger: silentLogger,
      config: {},
    },
  );

  assert.equal(payload.available, false);
  assert.equal(payload.degraded, false);
  assert.equal(payload.routeMode, 'unavailable');
  assert.equal(payload.precision, 'none');
  assert.equal(payload.providerAvailable, false);
  assert.equal(payload.reasonCode, 'invalid_coordinates');
  assert.equal(payload.advisory?.code, 'route_advisory_unavailable');
  assert.equal(payload.routes.length, 0);
});
