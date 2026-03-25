const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_BILLING_ORIGIN,
  normalizeAppUrl,
  resolveRequestMarket,
  resolvePriceForMarket,
  resolveBillingRuntimeConfig,
  validateStripeBillingRuntime,
} = require('./billingConfig');

const baseEnv = () => ({
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  STRIPE_PRICE_ID: 'price_default',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  APP_URL: 'http://localhost:5173',
  STRIPE_PRICE_BY_CURRENCY_JSON: JSON.stringify({
    USD: 'price_usd',
    EUR: 'price_eur',
    AUD: 'price_aud',
  }),
  STRIPE_PRICE_BY_COUNTRY_JSON: JSON.stringify({
    CH: 'price_ch',
    JP: 'price_jp',
  }),
  STRIPE_PRICE_BY_MARKET_TIER_JSON: JSON.stringify({
    priority_city: 'price_priority_city',
  }),
  STRIPE_DEFAULT_COUNTRY: 'US',
  STRIPE_DEFAULT_CURRENCY: 'USD',
});

test('country override wins over market tier and currency', () => {
  const env = baseEnv();
  const market = resolveRequestMarket({ countryCode: 'CH', cityName: 'Zurich' }, env);
  const selected = resolvePriceForMarket(market, env);
  assert.equal(selected.priceId, 'price_ch');
  assert.equal(selected.selectedBy, 'country');
});

test('market tier override wins over currency when no country override exists', () => {
  const env = baseEnv();
  env.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ CH: 'price_ch' });
  const market = resolveRequestMarket({ countryCode: 'US', cityName: 'New York' }, env);
  const selected = resolvePriceForMarket(market, env);
  assert.equal(market.marketTier, 'priority_city');
  assert.equal(selected.priceId, 'price_priority_city');
  assert.equal(selected.selectedBy, 'market_tier');
});

test('currency fallback applies when neither country nor market tier is configured', () => {
  const env = baseEnv();
  env.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ CH: 'price_ch' });
  env.STRIPE_PRICE_BY_MARKET_TIER_JSON = JSON.stringify({ priority_city: 'price_priority_city' });
  const market = resolveRequestMarket({ countryCode: 'AU', cityName: 'Adelaide' }, env);
  const selected = resolvePriceForMarket(market, env);
  assert.equal(market.currency, 'AUD');
  assert.equal(selected.priceId, 'price_aud');
  assert.equal(selected.selectedBy, 'currency');
});

test('default country fallback works when request has no usable country and no override match', () => {
  const env = baseEnv();
  env.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ US: 'price_us_country' });
  env.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({ EUR: 'price_eur' });
  env.STRIPE_DEFAULT_COUNTRY = 'US';
  env.STRIPE_DEFAULT_CURRENCY = 'EUR';
  const runtime = resolveBillingRuntimeConfig({}, env);
  assert.equal(runtime.priceId, 'price_us_country');
  assert.equal(runtime.priceSelection, 'country');
});

test('falls back to global default price when no override matches', () => {
  const env = baseEnv();
  env.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({});
  env.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({});
  env.STRIPE_PRICE_BY_MARKET_TIER_JSON = JSON.stringify({});
  env.STRIPE_DEFAULT_COUNTRY = '';
  env.STRIPE_DEFAULT_CURRENCY = '';
  const market = resolveRequestMarket({ countryCode: 'AE', cityName: 'Sharjah' }, env);
  const selected = resolvePriceForMarket(market, env);
  assert.equal(selected.priceId, 'price_default');
  assert.equal(selected.selectedBy, 'default');
});

test('city affects market key without changing country currency', () => {
  const env = baseEnv();
  const market = resolveRequestMarket({ countryCode: 'US', cityName: 'Washington, D.C.' }, env);
  assert.equal(market.currency, 'USD');
  assert.equal(market.marketTier, 'priority_city');
  assert.match(market.marketKey, /^US-washington_dc$/);
});

test('invalid mapped price id fails validation early', () => {
  const env = baseEnv();
  env.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({ USD: 'prod_bad' });
  assert.throws(() => validateStripeBillingRuntime(env), /invalid_env_stripe_price_by_currency_json/);
});

test('invalid default country fails validation early', () => {
  const env = baseEnv();
  env.STRIPE_DEFAULT_COUNTRY = 'ZZ';
  assert.throws(() => validateStripeBillingRuntime(env), /invalid_env_stripe_default_country/);
});

test('legacy billing host is normalized to the canonical billing origin', () => {
  const env = baseEnv();
  env.APP_URL = 'https://api.alertpremium.com';
  assert.equal(normalizeAppUrl(env), CANONICAL_BILLING_ORIGIN);
});

test('production runtime rejects non-canonical public billing hosts', () => {
  const env = baseEnv();
  env.APP_URL = 'https://billing.example.com';
  assert.throws(() => resolveBillingRuntimeConfig({}, env), /invalid_env_app_url_host/);
});

test('localhost billing host remains allowed for local development', () => {
  const env = baseEnv();
  env.APP_URL = 'http://localhost:5173';
  assert.equal(normalizeAppUrl(env), 'http://localhost:5173');
});

test('render billing host remains allowed for current deploy origin', () => {
  const env = baseEnv();
  env.APP_URL = 'https://alert-vmpj.onrender.com';
  assert.equal(normalizeAppUrl(env), 'https://alert-vmpj.onrender.com');
});

test('render billing host requires https', () => {
  const env = baseEnv();
  env.APP_URL = 'http://alert-vmpj.onrender.com';
  assert.throws(() => resolveBillingRuntimeConfig({}, env), /invalid_env_app_url/);
});
