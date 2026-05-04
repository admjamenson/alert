const test = require('node:test');
const assert = require('node:assert/strict');
const { createInMemoryCacheStore } = require('./InMemoryCacheStore');
const { createCacheStore, resolveCacheRedisUrl } = require('./createCacheStore');
const { createRedisCacheStore } = require('./RedisCacheStore');

test('in-memory cache store expires and exposes bounded metrics', async () => {
  const cache = createInMemoryCacheStore({ name: 'provider-cache', maxEntries: 1 });
  await cache.setJson('a', { ok: true }, 1000);
  await cache.setJson('b', { ok: true }, 1000);

  assert.equal(await cache.getJson('a'), null);
  assert.deepEqual(await cache.getJson('b'), { ok: true });
  assert.equal(cache.snapshot().entries, 1);
  assert.equal(cache.snapshot().evicted, 1);
});

test('redis cache store can run against an injected client for production wiring tests', async () => {
  const rows = new Map();
  const calls = [];
  const fakeClient = {
    isOpen: true,
    async get(key) {
      calls.push(['get', key]);
      return rows.get(key) || null;
    },
    async set(key, value, options) {
      calls.push(['set', key, options]);
      rows.set(key, value);
    },
    async del(key) {
      calls.push(['del', key]);
      rows.delete(key);
    },
    async quit() {
      calls.push(['quit']);
    },
  };

  const cache = createRedisCacheStore({
    name: 'provider-cache',
    prefix: 'alert-test',
    client: fakeClient,
  });

  await cache.setJson('weather:1', { tempC: 21 }, 5000);
  assert.deepEqual(await cache.getJson('weather:1'), { tempC: 21 });
  await cache.delete('weather:1');
  assert.equal(await cache.getJson('weather:1'), null);
  await cache.close();

  assert.deepEqual(calls[0], ['set', 'alert-test:weather:1', { PX: 5000 }]);
  assert.equal(cache.snapshot().external, true);
  assert.equal(cache.snapshot().driver, 'redis');
});

test('cache factory selects RedisCacheStore when ALERT_CACHE_DRIVER=redis', async t => {
  const originalDriver = process.env.ALERT_CACHE_DRIVER;
  process.env.ALERT_CACHE_DRIVER = 'redis';
  t.after(() => {
    if (originalDriver === undefined) {
      delete process.env.ALERT_CACHE_DRIVER;
    } else {
      process.env.ALERT_CACHE_DRIVER = originalDriver;
    }
  });

  const fakeClient = {
    isOpen: true,
    async get() {
      return JSON.stringify({ ok: true });
    },
    async set() {},
    async del() {},
    async quit() {},
  };

  const cache = createCacheStore({
    name: 'factory-cache',
    prefix: 'factory',
    client: fakeClient,
  });

  assert.equal(cache.snapshot().driver, 'redis');
  assert.equal(cache.snapshot().external, true);
  assert.equal(cache.snapshot().urlSource, null);
  assert.deepEqual(await cache.getJson('ready'), { ok: true });
});

test('cache factory allows dedicated ALERT_CACHE_REDIS_URL for separated cache Redis', async t => {
  const originalDriver = process.env.ALERT_CACHE_DRIVER;
  const originalCacheUrl = process.env.ALERT_CACHE_REDIS_URL;
  const originalSharedUrl = process.env.ALERT_REDIS_URL;
  process.env.ALERT_CACHE_DRIVER = 'redis';
  process.env.ALERT_CACHE_REDIS_URL = 'redis://cache:6379';
  process.env.ALERT_REDIS_URL = 'redis://queue:6379';
  t.after(() => {
    if (originalDriver === undefined) delete process.env.ALERT_CACHE_DRIVER;
    else process.env.ALERT_CACHE_DRIVER = originalDriver;
    if (originalCacheUrl === undefined) delete process.env.ALERT_CACHE_REDIS_URL;
    else process.env.ALERT_CACHE_REDIS_URL = originalCacheUrl;
    if (originalSharedUrl === undefined) delete process.env.ALERT_REDIS_URL;
    else process.env.ALERT_REDIS_URL = originalSharedUrl;
  });

  let receivedUrl = null;
  const cache = createCacheStore({
    createClient: options => {
      receivedUrl = options.url;
      return {
        isOpen: true,
        async get() {
          return null;
        },
        async set() {},
        async del() {},
        async quit() {},
      };
    },
  });

  assert.equal(cache.snapshot().driver, 'redis');
  assert.equal(cache.snapshot().urlSource, 'ALERT_CACHE_REDIS_URL');
  assert.equal(receivedUrl, 'redis://cache:6379');
});

test('cache factory falls back to ALERT_REDIS_URL when dedicated cache URL is absent', () => {
  assert.deepEqual(
    resolveCacheRedisUrl(
      {},
      {
        ALERT_REDIS_URL: 'redis://shared:6379',
      },
    ),
    {
      url: 'redis://shared:6379',
      source: 'ALERT_REDIS_URL',
    },
  );
});
