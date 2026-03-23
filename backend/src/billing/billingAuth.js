const crypto = require('crypto');

const BILLING_TOKEN_TTL_SEC = 20 * 60;

const base64UrlEncode = input =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const base64UrlDecode = input => {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
};

const getBillingAuthSecret = env => {
  const value = String(env.ALERT_BILLING_SESSION_SECRET || '').trim();
  if (!value) {
    const error = new Error('missing_env_alert_billing_session_secret');
    error.statusCode = 500;
    throw error;
  }
  return value;
};

const buildBillingAuthToken = (payload, env = process.env) => {
  const secret = getBillingAuthSecret(env);
  const issuedAt = Math.floor(Date.now() / 1000);
  const envelope = {
    sub: String(payload.userId || '').trim(),
    cus: String(payload.stripeCustomerId || '').trim() || null,
    loc: String(payload.locale || '').trim() || null,
    cc: String(payload.countryCode || '').trim().toUpperCase() || null,
    city: String(payload.cityName || '').trim() || null,
    iat: issuedAt,
    exp: issuedAt + BILLING_TOKEN_TTL_SEC,
    jti: crypto.randomUUID(),
  };
  if (!envelope.sub) {
    const error = new Error('missing_billing_token_subject');
    error.statusCode = 400;
    throw error;
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(envelope));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${encodedPayload}.${signature}`;
};

const verifyBillingAuthToken = (token, env = process.env) => {
  const stableToken = String(token || '').trim();
  if (!stableToken) return null;
  const [encodedPayload, signature] = stableToken.split('.');
  if (!encodedPayload || !signature) {
    const error = new Error('invalid_billing_token_format');
    error.statusCode = 401;
    throw error;
  }

  const secret = getBillingAuthSecret(env);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    const error = new Error('invalid_billing_token_signature');
    error.statusCode = 401;
    throw error;
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp <= nowSec) {
    const error = new Error('billing_token_expired');
    error.statusCode = 401;
    throw error;
  }

  return payload;
};

const allowQueryAuth = (env = process.env) => {
  const raw = String(env.ALERT_BILLING_ALLOW_QUERY_AUTH || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return String(env.NODE_ENV || 'development').toLowerCase() !== 'production';
};

const readHeaderValue = (req, ...keys) => {
  for (const key of keys) {
    const headerValue = req?.headers?.[key];
    if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  }
  return '';
};

const readBodyValue = (req, ...keys) => {
  for (const key of keys) {
    const bodyValue = req?.body?.[key];
    if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();
  }
  return '';
};

const readQueryValue = (req, ...keys) => {
  for (const key of keys) {
    const queryValue = req?.query?.[key];
    if (typeof queryValue === 'string' && queryValue.trim()) return queryValue.trim();
  }
  return '';
};

const readRequestValue = (req, ...keys) =>
  readHeaderValue(req, ...keys) || readBodyValue(req, ...keys) || readQueryValue(req, ...keys);

const readTrustedIdentityValue = (req, headerKey, ...bodyKeys) =>
  readHeaderValue(req, headerKey) || readBodyValue(req, headerKey, ...bodyKeys);

const getAuthenticatedBillingIdentity = (req, env = process.env) => {
  const billingToken =
    readRequestValue(req, 'x-alert-billing-token', 'billing_token', 'billingToken') || null;
  const tokenPayload = billingToken ? verifyBillingAuthToken(billingToken, env) : null;

  const userIdFromTrustedSources = readTrustedIdentityValue(req, 'x-alert-user-id', 'user_id', 'userId');
  const stripeCustomerIdFromTrustedSources = readTrustedIdentityValue(
    req,
    'x-alert-stripe-customer-id',
    'stripe_customer_id',
    'stripeCustomerId',
  );
  const localeFromTrustedSources = readTrustedIdentityValue(
    req,
    'x-alert-user-locale',
    'user_locale',
    'userLocale',
    'locale',
  );
  const countryCodeFromTrustedSources = readTrustedIdentityValue(
    req,
    'x-alert-country-code',
    'country_code',
    'countryCode',
    'country',
  );
  const cityNameFromTrustedSources = readTrustedIdentityValue(
    req,
    'x-alert-city-name',
    'city_name',
    'cityName',
    'city',
  );

  const canFallbackToQuery = allowQueryAuth(env);
  const userIdFromFallback = canFallbackToQuery
    ? readRequestValue(req, 'user_id', 'userId')
    : '';
  const stripeCustomerIdFromFallback = canFallbackToQuery
    ? readRequestValue(req, 'stripe_customer_id', 'stripeCustomerId')
    : '';
  const localeFromFallback = canFallbackToQuery
    ? readRequestValue(req, 'user_locale', 'userLocale', 'locale')
    : '';
  const countryCodeFromFallback = canFallbackToQuery
    ? readRequestValue(req, 'country_code', 'countryCode', 'country')
    : '';
  const cityNameFromFallback = canFallbackToQuery
    ? readRequestValue(req, 'city_name', 'cityName', 'city')
    : '';

  const userId = String(
    tokenPayload?.sub ||
      userIdFromTrustedSources ||
      userIdFromFallback ||
      '',
  ).trim();

  if (!userId) {
    const error = new Error('missing_authenticated_user');
    error.statusCode = 401;
    throw error;
  }

  return {
    userId,
    stripeCustomerId:
      String(
        tokenPayload?.cus ||
          stripeCustomerIdFromTrustedSources ||
          stripeCustomerIdFromFallback ||
          '',
      ).trim() || null,
    locale:
      String(tokenPayload?.loc || localeFromTrustedSources || localeFromFallback || '').trim() ||
      null,
    countryCode:
      String(
        tokenPayload?.cc || countryCodeFromTrustedSources || countryCodeFromFallback || '',
      )
        .trim()
        .toUpperCase() || null,
    cityName:
      String(tokenPayload?.city || cityNameFromTrustedSources || cityNameFromFallback || '').trim() ||
      null,
    billingToken,
    billingTokenId: tokenPayload?.jti || null,
    authMode: tokenPayload ? 'signed_token' : canFallbackToQuery ? 'query_fallback' : 'trusted_header',
  };
};

module.exports = {
  allowQueryAuth,
  buildBillingAuthToken,
  verifyBillingAuthToken,
  getAuthenticatedBillingIdentity,
};
