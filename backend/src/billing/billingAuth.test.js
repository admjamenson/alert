const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBillingAuthToken,
  verifyBillingAuthToken,
  getAuthenticatedBillingIdentity,
} = require('./billingAuth');

const baseEnv = () => ({
  ALERT_BILLING_SESSION_SECRET: 'test_secret_value_that_is_long_enough',
  ALERT_BILLING_ALLOW_QUERY_AUTH: 'false',
  NODE_ENV: 'production',
});

const buildReq = ({ headers = {}, body = {}, query = {} } = {}) => ({ headers, body, query });

test('signed billing token roundtrip preserves user identity and locale context', () => {
  const env = baseEnv();
  const token = buildBillingAuthToken(
    {
      userId: 'alert-user-1',
      stripeCustomerId: 'cus_123',
      locale: 'pt-BR',
      countryCode: 'BR',
      cityName: 'Sao Paulo',
    },
    env,
  );

  const payload = verifyBillingAuthToken(token, env);
  assert.equal(payload.sub, 'alert-user-1');
  assert.equal(payload.cus, 'cus_123');
  assert.equal(payload.loc, 'pt-BR');
  assert.equal(payload.cc, 'BR');
  assert.equal(payload.city, 'Sao Paulo');
});

test('query auth is blocked in production when explicitly disabled', () => {
  const env = baseEnv();
  const req = buildReq({ query: { user_id: 'alert-user-1' } });
  assert.throws(() => getAuthenticatedBillingIdentity(req, env), /missing_authenticated_user/);
});

test('trusted header auth works without query fallback', () => {
  const env = baseEnv();
  const req = buildReq({
    headers: {
      'x-alert-user-id': 'alert-user-1',
      'x-alert-user-locale': 'en-US',
      'x-alert-country-code': 'US',
      'x-alert-city-name': 'New York',
    },
  });
  const auth = getAuthenticatedBillingIdentity(req, env);
  assert.equal(auth.userId, 'alert-user-1');
  assert.equal(auth.locale, 'en-US');
  assert.equal(auth.countryCode, 'US');
  assert.equal(auth.cityName, 'New York');
  assert.equal(auth.authMode, 'trusted_header');
});

test('trusted body auth works without query fallback', () => {
  const env = baseEnv();
  const req = buildReq({
    body: {
      user_id: 'alert-user-1',
      user_locale: 'pt-BR',
      country_code: 'BR',
      city_name: 'Sao Paulo',
    },
  });
  const auth = getAuthenticatedBillingIdentity(req, env);
  assert.equal(auth.userId, 'alert-user-1');
  assert.equal(auth.locale, 'pt-BR');
  assert.equal(auth.countryCode, 'BR');
  assert.equal(auth.cityName, 'Sao Paulo');
  assert.equal(auth.authMode, 'trusted_header');
});

test('signed billing token in request body is accepted for mobile billing endpoints', () => {
  const env = baseEnv();
  const token = buildBillingAuthToken(
    {
      userId: 'alert-user-1',
      stripeCustomerId: 'cus_body_token',
      locale: 'pt-BR',
      countryCode: 'BR',
      cityName: 'Sao Paulo',
    },
    env,
  );

  const req = buildReq({
    body: {
      billing_token: token,
    },
  });

  const auth = getAuthenticatedBillingIdentity(req, env);
  assert.equal(auth.userId, 'alert-user-1');
  assert.equal(auth.stripeCustomerId, 'cus_body_token');
  assert.equal(auth.authMode, 'signed_token');
});

test('signed token takes precedence over conflicting fallback values', () => {
  const env = baseEnv();
  const token = buildBillingAuthToken(
    {
      userId: 'alert-user-1',
      stripeCustomerId: 'cus_token',
      locale: 'fr-FR',
      countryCode: 'FR',
      cityName: 'Paris',
    },
    env,
  );
  const req = buildReq({
    headers: {
      'x-alert-billing-token': token,
      'x-alert-user-id': 'wrong-user',
      'x-alert-country-code': 'US',
    },
    query: {
      user_id: 'wrong-query-user',
    },
  });

  const auth = getAuthenticatedBillingIdentity(req, env);
  assert.equal(auth.userId, 'alert-user-1');
  assert.equal(auth.stripeCustomerId, 'cus_token');
  assert.equal(auth.countryCode, 'FR');
  assert.equal(auth.cityName, 'Paris');
  assert.equal(auth.authMode, 'signed_token');
});
