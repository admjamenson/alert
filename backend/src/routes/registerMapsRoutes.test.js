const test = require('node:test');
const assert = require('node:assert/strict');

const registerMapsRoutes = require('./registerMapsRoutes');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createAppStub = () => {
  const handlers = new Map();
  return {
    get: (path, handler) => {
      handlers.set(path, handler);
    },
    handlers,
  };
};

const createResponseStub = () => {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    set: (name, value) => {
      headers.set(String(name || '').toLowerCase(), String(value || ''));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    getHeader(name) {
      return headers.get(String(name || '').toLowerCase()) || null;
    },
  };
};

test('registerMapsRoutes adds safe route ops debug payload and headers on explicit probe requests', async () => {
  const app = createAppStub();
  registerMapsRoutes(app, {
    config: {
      weather: {
        userAgent: 'AlertBackend/Tests',
      },
      routing: {
        providerBaseUrl: 'https://route-primary.alert.example/route/v1',
        fallbackProviderBaseUrl:
          'https://route-fallback.alert.example/route/v1',
        regionProviderBaseUrls: {
          'us-east-1': 'https://route-use1.alert.example/route/v1',
        },
        timeoutMs: 900,
        retries: 0,
        maxTotalWaitMs: 1400,
        maxConcurrentRequests: 4,
        cacheTtlMs: 300000,
        staleRouteTtlMs: 900000,
        staleRouteMaxEntries: 1000,
        maxPerMinute: 120,
      },
    },
    logger: silentLogger,
    routeOptionsSnapshot: async () => ({
      available: true,
      degraded: false,
      reasonCode: null,
      retryable: false,
      fallbackUsed: false,
      routeMode: 'provider',
      precision: 'high',
      providerAvailable: true,
      advisory: null,
      routes: [
        {
          id: 'provider-route',
          geometry: [
            [-74.006, 40.7128],
            [-73.9855, 40.758],
          ],
        },
      ],
      updatedAt: '2026-04-28T20:00:00.000Z',
      provider: {
        id: 'osrm',
        targetId: 'osrm:region:us-east-1',
        source: 'region',
        regionKey: 'us-east-1',
        available: true,
        degraded: false,
        stale: false,
        reasonCode: null,
        retryable: false,
        circuitState: 'closed',
        attempts: 1,
        cacheHit: false,
        latencyMs: 120,
        timeoutMs: 900,
      },
      transportMode: 'walk',
    }),
  });

  const handler = app.handlers.get('/v1/maps/routes');
  const response = createResponseStub();
  const request = {
    query: {
      fromLat: '40.7128',
      fromLon: '-74.006',
      toLat: '40.758',
      toLon: '-73.9855',
      mode: 'walking',
    },
    get: name => {
      const normalized = String(name || '').toLowerCase();
      if (normalized === 'x-alert-region') {
        return 'us-east-1-new-york';
      }
      if (normalized === 'x-alert-ops-route-debug') {
        return '1';
      }
      return '';
    },
  };

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body.opsDebug?.configFingerprint || '', /^[a-f0-9]{12}$/);
  assert.equal(
    response.body.opsDebug?.targetResolution?.resolvedRegionalTarget?.targetId,
    'osrm:region:us-east-1',
  );
  assert.deepEqual(
    response.body.opsDebug?.targetResolution?.candidateTargets?.map(
      target => target.targetId,
    ),
    ['osrm:region:us-east-1', 'osrm:primary', 'osrm:fallback'],
  );
  assert.equal(
    response.getHeader('x-alert-route-target'),
    'osrm:region:us-east-1',
  );
  assert.equal(response.getHeader('x-alert-route-source'), 'region');
  assert.equal(
    response.getHeader('x-alert-route-region'),
    'us-east-1-new-york',
  );
});
