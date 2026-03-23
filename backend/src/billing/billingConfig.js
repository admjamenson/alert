const { COUNTRY_MARKET_CONFIG, resolveBillingMarket } = require('./priorityMarkets');

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const BILLING_ADDRESS_COLLECTION_VALUES = new Set(['auto', 'required']);
const CANONICAL_BILLING_ORIGIN = 'https://api.alert.app';
const LOCAL_BILLING_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LEGACY_BILLING_HOSTS = new Set(['api.alertpremium.com']);

const normalizeCountryCode = value => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
};

const normalizeCurrencyCode = value => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
};

const normalizeStripeLocale = value => {
  const raw = String(value || '').trim().replace('_', '-');
  if (!raw) return 'auto';
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(raw)) {
    return raw;
  }
  return 'auto';
};

const normalizeAppUrl = (env = process.env) => {
  const rawValue = requiredEnv('APP_URL', env);
  let parsed;

  try {
    parsed = new URL(rawValue);
  } catch (_error) {
    const error = new Error('invalid_env_app_url');
    error.statusCode = 500;
    throw error;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const error = new Error('invalid_env_app_url');
    error.statusCode = 500;
    throw error;
  }

  const normalizedHost = String(parsed.hostname || '').trim().toLowerCase();
  const normalizedPathname =
    parsed.pathname && parsed.pathname !== '/'
      ? parsed.pathname.replace(/\/+$/g, '')
      : '';

  if (LEGACY_BILLING_HOSTS.has(normalizedHost)) {
    return `${CANONICAL_BILLING_ORIGIN}${normalizedPathname}`;
  }

  if (LOCAL_BILLING_HOSTS.has(normalizedHost) || normalizedHost.endsWith('.local')) {
    return `${parsed.origin}${normalizedPathname}`;
  }

  const canonicalHost = new URL(CANONICAL_BILLING_ORIGIN).hostname;
  if (normalizedHost !== canonicalHost) {
    const error = new Error('invalid_env_app_url_host');
    error.statusCode = 500;
    error.details = {
      expectedHost: canonicalHost,
      receivedHost: normalizedHost || null,
    };
    throw error;
  }

  if (parsed.protocol !== 'https:') {
    const error = new Error('invalid_env_app_url');
    error.statusCode = 500;
    throw error;
  }

  return `${CANONICAL_BILLING_ORIGIN}${normalizedPathname}`;
};

const requiredEnv = (key, env = process.env) => {
  const value = String(env[key] || '').trim();
  if (!value) {
    const error = new Error(`missing_env_${key.toLowerCase()}`);
    error.statusCode = 500;
    throw error;
  }
  return value;
};

const requireStripeEnvShape = (key, expectedPrefixes, env = process.env) => {
  const value = requiredEnv(key, env);
  const normalizedPrefixes = Array.isArray(expectedPrefixes)
    ? expectedPrefixes
    : [expectedPrefixes];
  const isValid = normalizedPrefixes.some(prefix => value.startsWith(prefix));
  if (isValid) {
    return value;
  }

  const error = new Error(`invalid_env_${key.toLowerCase()}`);
  error.statusCode = 500;
  error.details = {
    key,
    expectedPrefixes: normalizedPrefixes,
  };
  throw error;
};

const parseJsonEnv = (key, env = process.env) => {
  const value = String(env[key] || '').trim();
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid_json_env_shape');
    }
    return parsed;
  } catch (_error) {
    const wrapped = new Error(`invalid_env_${key.toLowerCase()}`);
    wrapped.statusCode = 500;
    wrapped.details = { key };
    throw wrapped;
  }
};

const parseBooleanEnv = (key, defaultValue = false, env = process.env) => {
  const raw = String(env[key] || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (BOOLEAN_TRUE_VALUES.has(raw)) return true;
  if (BOOLEAN_FALSE_VALUES.has(raw)) return false;
  const error = new Error(`invalid_env_${key.toLowerCase()}`);
  error.statusCode = 500;
  error.details = { key, expected: ['true', 'false'] };
  throw error;
};

const parseEnumEnv = (key, allowedValues, defaultValue, env = process.env) => {
  const raw = String(env[key] || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (allowedValues.has(raw)) return raw;
  const error = new Error(`invalid_env_${key.toLowerCase()}`);
  error.statusCode = 500;
  error.details = { key, allowedValues: Array.from(allowedValues) };
  throw error;
};

const validatePriceMap = (map, { envKey, keyTransform = value => value } = {}) =>
  Object.entries(map).reduce((acc, [entryKey, entryValue]) => {
    const key = keyTransform(String(entryKey || '').trim());
    const value = String(entryValue || '').trim();
    if (!key || !value) {
      return acc;
    }
    if (!value.startsWith('price_')) {
      const error = new Error(`invalid_env_${String(envKey || 'stripe_price_map').toLowerCase()}`);
      error.statusCode = 500;
      error.details = { key };
      throw error;
    }
    acc[key] = value;
    return acc;
  }, {});

const resolveRequestMarket = (input = {}, env = process.env) => {
  const defaultCountryCode = normalizeCountryCode(env.STRIPE_DEFAULT_COUNTRY);
  const defaultCurrency = normalizeCurrencyCode(env.STRIPE_DEFAULT_CURRENCY);
  const market = resolveBillingMarket({
    locale: input.locale,
    countryCode: input.countryCode,
    cityName: input.cityName,
    fallbackCountryCode: defaultCountryCode,
  });

  if (defaultCurrency && !market.currency) {
    return {
      ...market,
      currency: defaultCurrency,
    };
  }

  return market;
};

const resolvePriceForMarket = (market, env = process.env) => {
  const defaultPriceId = requireStripeEnvShape('STRIPE_PRICE_ID', ['price_'], env);
  const pricesByCurrency = validatePriceMap(parseJsonEnv('STRIPE_PRICE_BY_CURRENCY_JSON', env), {
    envKey: 'STRIPE_PRICE_BY_CURRENCY_JSON',
    keyTransform: value => normalizeCurrencyCode(value),
  });
  const pricesByCountry = validatePriceMap(parseJsonEnv('STRIPE_PRICE_BY_COUNTRY_JSON', env), {
    envKey: 'STRIPE_PRICE_BY_COUNTRY_JSON',
    keyTransform: value => normalizeCountryCode(value),
  });
  const pricesByMarketTier = validatePriceMap(
    parseJsonEnv('STRIPE_PRICE_BY_MARKET_TIER_JSON', env),
    {
      envKey: 'STRIPE_PRICE_BY_MARKET_TIER_JSON',
      keyTransform: value => String(value || '').trim().toLowerCase(),
    },
  );
  const defaultCountryCode = normalizeCountryCode(env.STRIPE_DEFAULT_COUNTRY);
  const defaultCurrency = normalizeCurrencyCode(env.STRIPE_DEFAULT_CURRENCY);

  if (market.countryCode && pricesByCountry[market.countryCode]) {
    return {
      priceId: pricesByCountry[market.countryCode],
      selectedBy: 'country',
    };
  }

  if (market.marketTier && pricesByMarketTier[String(market.marketTier).toLowerCase()]) {
    return {
      priceId: pricesByMarketTier[String(market.marketTier).toLowerCase()],
      selectedBy: 'market_tier',
    };
  }

  if (market.currency && pricesByCurrency[market.currency]) {
    return {
      priceId: pricesByCurrency[market.currency],
      selectedBy: 'currency',
    };
  }

  if (defaultCountryCode && pricesByCountry[defaultCountryCode]) {
    return {
      priceId: pricesByCountry[defaultCountryCode],
      selectedBy: 'default_country',
    };
  }

  if (defaultCurrency && pricesByCurrency[defaultCurrency]) {
    return {
      priceId: pricesByCurrency[defaultCurrency],
      selectedBy: 'default_currency',
    };
  }

  return {
    priceId: defaultPriceId,
    selectedBy: 'default',
  };
};

const resolveBillingRuntimeConfig = (input = {}, env = process.env) => {
  const market = resolveRequestMarket(input, env);
  const selectedPrice = resolvePriceForMarket(market, env);
  const automaticTaxEnabled = parseBooleanEnv('STRIPE_AUTOMATIC_TAX_ENABLED', false, env);
  const billingAddressCollection = parseEnumEnv(
    'STRIPE_BILLING_ADDRESS_COLLECTION',
    BILLING_ADDRESS_COLLECTION_VALUES,
    automaticTaxEnabled ? 'required' : 'auto',
    env,
  );
  const taxIdCollectionEnabled = parseBooleanEnv(
    'STRIPE_TAX_ID_COLLECTION_ENABLED',
    false,
    env,
  );

  return {
    publishableKey: requireStripeEnvShape('STRIPE_PUBLISHABLE_KEY', ['pk_test_', 'pk_live_'], env),
    secretKey: requireStripeEnvShape('STRIPE_SECRET_KEY', ['sk_test_', 'sk_live_'], env),
    webhookSecret: requireStripeEnvShape('STRIPE_WEBHOOK_SECRET', ['whsec_'], env),
    appUrl: normalizeAppUrl(env),
    priceId: selectedPrice.priceId,
    priceSelection: selectedPrice.selectedBy,
    market,
    checkoutLocale: normalizeStripeLocale(market.locale),
    automaticTaxEnabled,
    billingAddressCollection,
    taxIdCollectionEnabled,
    defaultCountryCode: normalizeCountryCode(env.STRIPE_DEFAULT_COUNTRY),
    defaultCurrency: normalizeCurrencyCode(env.STRIPE_DEFAULT_CURRENCY),
  };
};

const validateStripeBillingRuntime = (env = process.env) => {
  const config = resolveBillingRuntimeConfig({}, env);

  if (
    config.defaultCountryCode &&
    !COUNTRY_MARKET_CONFIG[config.defaultCountryCode] &&
    !parseJsonEnv('STRIPE_PRICE_BY_COUNTRY_JSON', env)[config.defaultCountryCode]
  ) {
    const error = new Error('invalid_env_stripe_default_country');
    error.statusCode = 500;
    error.details = { defaultCountryCode: config.defaultCountryCode };
    throw error;
  }

  return config;
};

module.exports = {
  BILLING_ADDRESS_COLLECTION_VALUES,
  normalizeCountryCode,
  normalizeCurrencyCode,
  normalizeStripeLocale,
  normalizeAppUrl,
  CANONICAL_BILLING_ORIGIN,
  LEGACY_BILLING_HOSTS,
  requiredEnv,
  requireStripeEnvShape,
  parseJsonEnv,
  parseBooleanEnv,
  parseEnumEnv,
  validatePriceMap,
  resolveRequestMarket,
  resolvePriceForMarket,
  resolveBillingRuntimeConfig,
  validateStripeBillingRuntime,
};
