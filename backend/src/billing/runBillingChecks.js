const assert = require('node:assert/strict');
const {
  CANONICAL_BILLING_ORIGIN,
  normalizeAppUrl,
  resolveRequestMarket,
  resolvePriceForMarket,
  resolveBillingRuntimeConfig,
  validateStripeBillingRuntime,
} = require('./billingConfig');
const {
  buildBillingAuthToken,
  verifyBillingAuthToken,
  getAuthenticatedBillingIdentity,
} = require('./billingAuth');
const { resolveBillingMarket } = require('./priorityMarkets');

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
  ALERT_BILLING_SESSION_SECRET: 'test_secret_value_that_is_long_enough',
  ALERT_BILLING_ALLOW_QUERY_AUTH: 'false',
  NODE_ENV: 'production',
});

const buildReq = ({ headers = {}, body = {}, query = {} } = {}) => ({ headers, body, query });

const run = () => {
  const envCountry = baseEnv();
  const marketCountry = resolveRequestMarket({ countryCode: 'CH', cityName: 'Zurich' }, envCountry);
  const selectedCountry = resolvePriceForMarket(marketCountry, envCountry);
  assert.equal(selectedCountry.priceId, 'price_ch');
  assert.equal(selectedCountry.selectedBy, 'country');

  const envTier = baseEnv();
  envTier.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ CH: 'price_ch' });
  const marketTier = resolveRequestMarket({ countryCode: 'US', cityName: 'New York' }, envTier);
  const selectedTier = resolvePriceForMarket(marketTier, envTier);
  assert.equal(marketTier.marketTier, 'priority_city');
  assert.equal(selectedTier.priceId, 'price_priority_city');
  assert.equal(selectedTier.selectedBy, 'market_tier');

  const envCurrency = baseEnv();
  envCurrency.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ CH: 'price_ch' });
  const marketCurrency = resolveRequestMarket({ countryCode: 'AU', cityName: 'Adelaide' }, envCurrency);
  const selectedCurrency = resolvePriceForMarket(marketCurrency, envCurrency);
  assert.equal(selectedCurrency.priceId, 'price_aud');
  assert.equal(selectedCurrency.selectedBy, 'currency');

  const envDefault = baseEnv();
  envDefault.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({ US: 'price_us_country' });
  envDefault.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({ EUR: 'price_eur' });
  envDefault.STRIPE_DEFAULT_COUNTRY = 'US';
  envDefault.STRIPE_DEFAULT_CURRENCY = 'EUR';
  const runtime = resolveBillingRuntimeConfig({}, envDefault);
  assert.equal(runtime.priceId, 'price_us_country');
  assert.equal(runtime.priceSelection, 'country');

  const envGlobal = baseEnv();
  envGlobal.STRIPE_PRICE_BY_COUNTRY_JSON = JSON.stringify({});
  envGlobal.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({});
  envGlobal.STRIPE_PRICE_BY_MARKET_TIER_JSON = JSON.stringify({});
  envGlobal.STRIPE_DEFAULT_COUNTRY = '';
  envGlobal.STRIPE_DEFAULT_CURRENCY = '';
  const marketGlobal = resolveRequestMarket({ countryCode: 'AE', cityName: 'Sharjah' }, envGlobal);
  const selectedGlobal = resolvePriceForMarket(marketGlobal, envGlobal);
  assert.equal(selectedGlobal.priceId, 'price_default');
  assert.equal(selectedGlobal.selectedBy, 'default');

  const envInvalid = baseEnv();
  envInvalid.STRIPE_PRICE_BY_CURRENCY_JSON = JSON.stringify({ USD: 'prod_bad' });
  assert.throws(() => validateStripeBillingRuntime(envInvalid), /invalid_env_stripe_price_by_currency_json/);

  const envInvalidCountry = baseEnv();
  envInvalidCountry.STRIPE_DEFAULT_COUNTRY = 'ZZ';
  assert.throws(() => validateStripeBillingRuntime(envInvalidCountry), /invalid_env_stripe_default_country/);

  const envLegacyHost = baseEnv();
  envLegacyHost.APP_URL = 'https://api.alertpremium.com';
  assert.equal(normalizeAppUrl(envLegacyHost), CANONICAL_BILLING_ORIGIN);

  const envInvalidHost = baseEnv();
  envInvalidHost.APP_URL = 'https://billing.example.com';
  assert.throws(() => resolveBillingRuntimeConfig({}, envInvalidHost), /invalid_env_app_url_host/);

  const envRenderHost = baseEnv();
  envRenderHost.APP_URL = 'https://preview-alert.onrender.com';
  assert.equal(normalizeAppUrl(envRenderHost), 'https://preview-alert.onrender.com');

  const envRenderHostHttp = baseEnv();
  envRenderHostHttp.APP_URL = 'http://preview-alert.onrender.com';
  assert.throws(() => resolveBillingRuntimeConfig({}, envRenderHostHttp), /invalid_env_app_url/);

  const token = buildBillingAuthToken(
    {
      userId: 'alert-user-1',
      stripeCustomerId: 'cus_123',
      locale: 'pt-BR',
      countryCode: 'BR',
      cityName: 'Sao Paulo',
    },
    baseEnv(),
  );
  const payload = verifyBillingAuthToken(token, baseEnv());
  assert.equal(payload.sub, 'alert-user-1');
  assert.equal(payload.cus, 'cus_123');

  assert.throws(
    () => getAuthenticatedBillingIdentity(buildReq({ query: { user_id: 'alert-user-1' } }), baseEnv()),
    /missing_authenticated_user/,
  );

  const auth = getAuthenticatedBillingIdentity(
    buildReq({
      headers: {
        'x-alert-user-id': 'alert-user-1',
        'x-alert-user-locale': 'en-US',
        'x-alert-country-code': 'US',
        'x-alert-city-name': 'New York',
      },
    }),
    baseEnv(),
  );
  assert.equal(auth.userId, 'alert-user-1');
  assert.equal(auth.authMode, 'trusted_header');

  const hongKong = resolveBillingMarket({ countryCode: 'CN', cityName: 'Hong Kong', locale: 'zh-HK' });
  assert.equal(hongKong.countryCode, 'HK');
  assert.equal(hongKong.currency, 'HKD');

  const sanJose = resolveBillingMarket({ countryCode: 'US', cityName: 'San Jose (CA)', locale: 'en-US' });
  assert.equal(sanJose.currency, 'USD');
  assert.equal(sanJose.marketTier, 'priority_city');
  assert.match(sanJose.marketKey, /^US-san_jose$/);

  console.log('billing_checks_passed');
};

run();
