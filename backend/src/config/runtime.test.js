const assert = require('node:assert/strict');

const {
  buildRuntimeConfig,
  readRegionalProviderBaseUrls,
  readProviderBaseUrl,
} = require('./runtime');

const baseEnv = {
  RELAY_HMAC_SECRET: 'test_hmac_secret_long_enough',
};

const tests = [];

const test = (name, fn) => {
  tests.push({ name, fn });
};

test('runtime config allows public provider defaults outside production', () => {
  const config = buildRuntimeConfig({
    ...baseEnv,
    APP_ENV: 'development',
  });

  assert.equal(config.app.environment, 'development');
  assert.equal(config.app.allowPublicProviderDefaults, true);
  assert.equal(
    config.routing.providerBaseUrl,
    'https://router.project-osrm.org/route/v1',
  );
});

test('runtime config requires explicit provider URLs in production', () => {
  assert.throws(
    () =>
      buildRuntimeConfig({
        ...baseEnv,
        APP_ENV: 'production',
        ALERT_ALLOW_PUBLIC_PROVIDER_DEFAULTS: 'false',
      }),
    /missing_env_epidemic_br_notifica_base_url/,
  );
});

test('runtime config accepts explicit provider URLs in production', () => {
  const config = buildRuntimeConfig({
    ...baseEnv,
    APP_ENV: 'production',
    ALERT_ALLOW_PUBLIC_PROVIDER_DEFAULTS: 'false',
    EPIDEMIC_BR_NOTIFICA_BASE_URL: 'https://providers.alert.example/notifica',
    ROUTING_OSRM_BASE_URL: 'https://providers.alert.example/route/v1',
    ROUTING_OSRM_FALLBACK_BASE_URL:
      'https://providers.alert.example/route-fallback/v1',
    ROUTING_OSRM_REGION_BASE_URLS_JSON: JSON.stringify({
      'sa-east-1': 'https://sa-route.alert.example/route/v1',
      'us-east-1': 'https://us-route.alert.example/route/v1',
    }),
  });

  assert.equal(config.app.environment, 'production');
  assert.equal(config.app.allowPublicProviderDefaults, false);
  assert.equal(
    config.epidemic.notificaBaseUrl,
    'https://providers.alert.example/notifica',
  );
  assert.equal(
    config.routing.providerBaseUrl,
    'https://providers.alert.example/route/v1',
  );
  assert.equal(
    config.routing.fallbackProviderBaseUrl,
    'https://providers.alert.example/route-fallback/v1',
  );
  assert.deepEqual(config.routing.regionProviderBaseUrls, {
    'sa-east-1': 'https://sa-route.alert.example/route/v1',
    'us-east-1': 'https://us-route.alert.example/route/v1',
  });
});

test('provider URL helper preserves explicit overrides', () => {
  assert.equal(
    readProviderBaseUrl('ROUTING_OSRM_BASE_URL', 'https://fallback.invalid', {
      ROUTING_OSRM_BASE_URL: 'https://route.alert.example',
    }),
    'https://route.alert.example',
  );
});

test('regional provider URL helper ignores invalid rows and normalizes keys', () => {
  assert.deepEqual(
    readRegionalProviderBaseUrls('ROUTING_OSRM_REGION_BASE_URLS_JSON', {
      ROUTING_OSRM_REGION_BASE_URLS_JSON: JSON.stringify({
        ' SA-EAST-1 ': 'https://sa-route.alert.example/route/v1',
        '': 'https://invalid.example/route/v1',
        'us-east-1': '',
      }),
    }),
    {
      'sa-east-1': 'https://sa-route.alert.example/route/v1',
    },
  );
});

test('runtime config exposes routing max total wait budget for fast fail-soft', () => {
  const config = buildRuntimeConfig({
    ...baseEnv,
    ROUTING_PROVIDER_MAX_TOTAL_WAIT_MS: '2800',
  });

  assert.equal(config.routing.maxTotalWaitMs, 2800);
});

test('runtime config hardens route provider defaults for burst protection', () => {
  const config = buildRuntimeConfig({
    ...baseEnv,
  });

  assert.equal(config.routing.timeoutMs, 1400);
  assert.equal(config.routing.retries, 0);
  assert.equal(config.routing.retryDelayMs, 120);
  assert.equal(config.routing.maxTotalWaitMs, 1600);
  assert.equal(config.routing.failureThreshold, 2);
  assert.equal(config.routing.maxConcurrentRequests, 4);
  assert.equal(config.routing.cacheTtlMs, 5 * 60 * 1000);
  assert.equal(config.routing.staleRouteTtlMs, 15 * 60 * 1000);
  assert.equal(config.routing.staleRouteMaxEntries, 1000);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
