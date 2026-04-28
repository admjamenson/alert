const test = require('node:test');
const assert = require('node:assert/strict');
const { EventHubService } = require('./EventHubService');

test('EventHubService reads the configured cache store before provider fan-in', async () => {
  const cachedPayload = {
    events: [],
    healthTop: [],
    providers: [],
    meta: {
      generatedAt: '2026-04-18T00:00:00.000Z',
      count: 0,
    },
  };
  const cacheStore = {
    async getJson() {
      return cachedPayload;
    },
    async setJson() {
      throw new Error('provider_fan_in_should_not_write_on_hit');
    },
    snapshot() {
      return { driver: 'redis', external: true };
    },
  };

  const payload = await EventHubService.getEvents(
    {
      bbox: '-46.7,-23.6,-46.5,-23.4',
      types: 'infrastructure',
      since: 'cache-hit-render-test',
      limit: 5,
    },
    { cacheStore },
  );

  assert.equal(payload.meta.cacheHit, true);
  assert.equal(payload.meta.cacheDriver, 'redis');
  assert.equal(payload.meta.coalesced, false);
});

test('EventHubService writes provider fan-in payloads through the configured cache store', async () => {
  const writes = [];
  const cacheStore = {
    async getJson() {
      return null;
    },
    async setJson(key, value, ttlMs) {
      writes.push({ key, value, ttlMs });
      return true;
    },
    snapshot() {
      return { driver: 'redis', external: true };
    },
  };

  const payload = await EventHubService.getEvents(
    {
      bbox: '-46.7,-23.6,-46.5,-23.4',
      types: 'infrastructure',
      since: 'cache-write-render-test',
      limit: 5,
    },
    { cacheStore },
  );

  assert.equal(payload.meta.cacheHit, false);
  assert.equal(payload.meta.cacheDriver, 'redis');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].ttlMs > 0);
});

test('EventHubService honors providerIdsOverride for hot-path callers', async () => {
  const payload = await EventHubService.getEvents(
    {
      bbox: '-46.7,-23.6,-46.5,-23.4',
      types: 'flood,storm,drought',
      since: 'provider-override-render-test',
      limit: 5,
    },
    {
      cacheStore: {
        async getJson() {
          return null;
        },
        async setJson() {
          return true;
        },
        snapshot() {
          return { driver: 'redis', external: true };
        },
      },
      providerIdsOverride: ['meteo_nowcast_openmeteo'],
    },
  );

  assert.equal(payload.providers.length, 1);
  assert.equal(payload.providers[0].providerId, 'meteo_nowcast_openmeteo');
});
