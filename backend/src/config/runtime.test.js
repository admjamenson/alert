const assert = require('node:assert/strict');

const {
  buildRuntimeConfig,
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
});

test('provider URL helper preserves explicit overrides', () => {
  assert.equal(
    readProviderBaseUrl('ROUTING_OSRM_BASE_URL', 'https://fallback.invalid', {
      ROUTING_OSRM_BASE_URL: 'https://route.alert.example',
    }),
    'https://route.alert.example',
  );
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
