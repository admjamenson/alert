const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearProviderFetchMetrics,
  fetchJsonWithRetry,
  getProviderFetchMetrics,
} = require('./fetcher');

test('fetcher records provider latency, success and cache hits', async () => {
  clearProviderFetchMetrics();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      },
    };
  };

  try {
    await fetchJsonWithRetry('https://provider.test/data', {
      providerId: 'provider-test',
      cacheKey: 'provider-test:data',
      cacheTtlMs: 60_000,
      retries: 0,
    });
    await fetchJsonWithRetry('https://provider.test/data', {
      providerId: 'provider-test',
      cacheKey: 'provider-test:data',
      cacheTtlMs: 60_000,
      retries: 0,
    });
  } finally {
    global.fetch = originalFetch;
  }

  const metrics = getProviderFetchMetrics();
  const provider = metrics.find(row => row.providerId === 'provider-test');
  assert.equal(calls, 1);
  assert.equal(provider.total, 2);
  assert.equal(provider.success, 2);
  assert.equal(provider.cacheHit, 1);
  assert.equal(provider.successRate, 1);
});

test('fetcher coalesces concurrent provider requests by cache key', async () => {
  clearProviderFetchMetrics();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, calls };
      },
    };
  };

  try {
    const [first, second, third] = await Promise.all([
      fetchJsonWithRetry('https://provider.test/burst', {
        providerId: 'provider-burst',
        cacheKey: 'provider-burst:data',
        cacheTtlMs: 60_000,
        retries: 0,
      }),
      fetchJsonWithRetry('https://provider.test/burst', {
        providerId: 'provider-burst',
        cacheKey: 'provider-burst:data',
        cacheTtlMs: 60_000,
        retries: 0,
      }),
      fetchJsonWithRetry('https://provider.test/burst', {
        providerId: 'provider-burst',
        cacheKey: 'provider-burst:data',
        cacheTtlMs: 60_000,
        retries: 0,
      }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
  } finally {
    global.fetch = originalFetch;
  }

  const provider = getProviderFetchMetrics().find(
    row => row.providerId === 'provider-burst',
  );
  assert.equal(calls, 1);
  assert.equal(provider.total, 3);
  assert.equal(provider.success, 3);
});
