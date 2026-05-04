const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerStripeBilling,
  buildBillingAccountCostSnapshot,
  buildBillingOfferFromStripePrice,
  buildUnavailableBillingOffer,
  buildMobilePaymentSheetResponse,
  resolveStripeBillingCurrency,
  extractSubscriptionCurrency,
  extractInvoiceLineCurrency,
} = require('./registerStripeBilling');
const { loadOperationalPriceBook } = require('../economics/priceBook');
const registerFeedRoutes = require('../routes/registerFeedRoutes');
const registerMapsRoutes = require('../routes/registerMapsRoutes');

const clone = value =>
  typeof value === 'undefined' ? undefined : JSON.parse(JSON.stringify(value));

const mergeDocs = (current, next) => ({
  ...(current || {}),
  ...(next || {}),
});

const createDocSnapshot = (id, data) => ({
  id,
  exists: typeof data !== 'undefined',
  data: () => clone(data),
});

const createFakeDb = (seed = {}) => {
  const collections = new Map(
    Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(clone(docs) || {}))]),
  );

  const ensureCollection = name => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  };

  const buildDocRef = (collectionName, docId) => ({
    id: docId,
    async get() {
      return createDocSnapshot(docId, ensureCollection(collectionName).get(docId));
    },
    async set(value, options = {}) {
      const collection = ensureCollection(collectionName);
      const current = collection.get(docId);
      collection.set(
        docId,
        options?.merge ? mergeDocs(current, value) : clone(value),
      );
    },
  });

  return {
    collection(name) {
      return {
        doc(docId) {
          return buildDocRef(name, docId);
        },
        where(field, operator, expected) {
          return {
            async get() {
              if (operator !== '==') {
                throw new Error(`unsupported_operator:${operator}`);
              }
              const docs = Array.from(ensureCollection(name).entries())
                .filter(([, value]) => value && value[field] === expected)
                .map(([docId, value]) => createDocSnapshot(docId, value));
              return {
                docs,
                size: docs.length,
                empty: docs.length === 0,
              };
            },
          };
        },
      };
    },
    async runTransaction(work) {
      const pending = [];
      const transaction = {
        async get(docRef) {
          return docRef.get();
        },
        set(docRef, value, options) {
          pending.push(() => docRef.set(value, options));
        },
      };
      const result = await work(transaction);
      for (const commit of pending) {
        await commit();
      }
      return result;
    },
  };
};

const createAppStub = () => {
  const handlers = new Map();
  return {
    get(path, handler) {
      handlers.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      handlers.set(`POST ${path}`, handler);
    },
    use() {},
    handlers,
  };
};

const createResponseStub = () => ({
  statusCode: 200,
  body: null,
  headers: new Map(),
  status(code) {
    this.statusCode = code;
    return this;
  },
  set(name, value) {
    this.headers.set(String(name || '').toLowerCase(), String(value || ''));
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const baseBillingEnv = () => ({
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  STRIPE_PRICE_ID: 'price_default',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  APP_URL: 'http://localhost:5173',
  STRIPE_PRICE_BY_CURRENCY_JSON: JSON.stringify({
    USD: 'price_usd',
  }),
  STRIPE_DEFAULT_COUNTRY: 'US',
  STRIPE_DEFAULT_CURRENCY: 'USD',
  ALERT_BILLING_SESSION_SECRET: 'test_secret_value_that_is_long_enough',
  ALERT_BILLING_ALLOW_QUERY_AUTH: 'false',
  NODE_ENV: 'development',
});

test.afterEach(() => {
  delete process.env.ALERT_ECONOMICS_PRICE_BOOK_JSON;
  delete process.env.ALERT_BILLING_USAGE_COVERAGE_STARTED_AT;
  Object.assign(process.env, baseBillingEnv());
});

test('buildBillingOfferFromStripePrice returns an available recurring offer', () => {
  const offer = buildBillingOfferFromStripePrice({
    config: {
      priceId: 'price_123',
      market: {
        currency: 'BRL',
      },
    },
    price: {
      id: 'price_123',
      active: true,
      livemode: false,
      currency: 'brl',
      unit_amount: 1490,
      recurring: {
        interval: 'month',
        interval_count: 1,
      },
      product: {
        id: 'prod_123',
        active: true,
        name: 'Alert Premium',
        description: 'Monthly premium access',
      },
    },
  });

  assert.deepEqual(offer, {
    available: true,
    reasonCode: null,
    source: 'stripe_price',
    priceId: 'price_123',
    productId: 'prod_123',
    productName: 'Alert Premium',
    productDescription: 'Monthly premium access',
    unitAmount: 1490,
    currency: 'BRL',
    interval: 'month',
    intervalCount: 1,
    livemode: false,
  });
});

test('buildBillingOfferFromStripePrice marks non-recurring prices as unavailable', () => {
  const offer = buildBillingOfferFromStripePrice({
    config: {
      priceId: 'price_bad',
      market: {
        currency: 'USD',
      },
    },
    price: {
      id: 'price_bad',
      active: true,
      livemode: false,
      currency: 'usd',
      unit_amount: 999,
      recurring: null,
      product: {
        id: 'prod_bad',
        active: true,
        name: 'One-off',
      },
    },
  });

  assert.deepEqual(
    offer,
    buildUnavailableBillingOffer(
      {
        priceId: 'price_bad',
        market: {
          currency: 'USD',
        },
      },
      'stripe_price_not_recurring',
    ),
  );
});

test('buildMobilePaymentSheetResponse preserves the canonical return URL', () => {
  const payload = buildMobilePaymentSheetResponse({
    config: {
      publishableKey: 'pk_test_123',
      market: {
        countryCode: 'BR',
        currency: 'BRL',
      },
    },
    customerId: 'cus_123',
    ephemeralKeySecret: 'ephkey_123',
    subscription: {
      id: 'sub_123',
      latest_invoice: {
        payment_intent: {
          id: 'pi_123',
          client_secret: 'pi_123_secret_abc',
        },
      },
    },
  });

  assert.deepEqual(payload, {
    publishableKey: 'pk_test_123',
    customerId: 'cus_123',
    customerEphemeralKeySecret: 'ephkey_123',
    paymentIntentClientSecret: 'pi_123_secret_abc',
    paymentIntentId: 'pi_123',
    subscriptionId: 'sub_123',
    merchantCountryCode: 'BR',
    currencyCode: 'BRL',
    returnURL: 'alertapp://billing-return',
  });
});

test('resolveStripeBillingCurrency prefers provider currency over metadata fallback', () => {
  const resolved = resolveStripeBillingCurrency(
    null,
    'brl',
    'usd',
    null,
  );

  assert.equal(resolved, 'BRL');
});

test('extractSubscriptionCurrency reads the Stripe subscription item price currency', () => {
  const currency = extractSubscriptionCurrency({
    items: {
      data: [
        {
          price: {
            currency: 'brl',
          },
        },
      ],
    },
  });

  assert.equal(currency, 'BRL');
});

test('extractInvoiceLineCurrency reads the Stripe invoice line price currency', () => {
  const currency = extractInvoiceLineCurrency({
    lines: {
      data: [
        {
          price: {
            currency: 'brl',
          },
        },
      ],
    },
  });

  assert.equal(currency, 'BRL');
});

test('billing account snapshot keeps missing usage absent instead of replacing it with zeros', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        routingCostUsd: { value: 0.00004, origin: 'real' },
        weatherMissCostUsd: { value: 0.0009, origin: 'real' },
        paymentProcessorPercent: { value: 0.039, origin: 'real' },
        paymentProcessorFixedFeeUsd: { value: 0.3, origin: 'real' },
      },
    }),
    path: '',
  });

  const snapshot = buildBillingAccountCostSnapshot({
    record: {
      billing_provider: 'stripe',
      stripe_subscription_id: 'sub_123',
      billing_currency: 'USD',
    },
    subscription: {
      items: {
        data: [
          {
            price: {
              unit_amount: 1490,
              currency: 'usd',
            },
          },
        ],
      },
    },
    invoices: [],
    priceBook,
    usageMetrics: {
      routingCalls: null,
      weatherCalls: null,
      classification: 'absent',
    },
    platformAllocationCostUsd: {
      amountUsd: null,
      classification: 'absent',
      evidence: 'missing allocation input',
    },
  });

  assert.equal(snapshot.provider, 'stripe');
  assert.equal(snapshot.usageMetrics.routingCalls, null);
  assert.equal(snapshot.usageMetrics.weatherCalls, null);
  assert.equal(snapshot.marginAnalysis.classification, 'absent');
  assert.ok(snapshot.marginAnalysis.blockers.includes('missing_routing_usage'));
  assert.ok(snapshot.marginAnalysis.blockers.includes('missing_weather_usage'));
});

test('billing account snapshot reads structured stripe terms without fabricating margin', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        stripe: {
          percentFee: {
            value: 0.0399,
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_percent',
          },
          fixedFee: {
            value: 0.5,
            currency: 'BRL',
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_fixed_brl',
          },
        },
      },
    }),
    path: '',
  });

  const snapshot = buildBillingAccountCostSnapshot({
    record: {
      billing_provider: 'stripe',
      stripe_subscription_id: 'sub_123',
      billing_currency: 'BRL',
    },
    subscription: {
      items: {
        data: [
          {
            price: {
              unit_amount: 1490,
              currency: 'brl',
            },
          },
        ],
      },
    },
    invoices: [],
    priceBook,
    usageMetrics: {
      routingCalls: null,
      weatherCalls: null,
      classification: 'absent',
    },
    platformAllocationCostUsd: {
      amountUsd: null,
      classification: 'absent',
      evidence: 'missing allocation input',
    },
  });

  assert.equal(snapshot.provider, 'stripe');
  assert.equal(snapshot.revenue.amount, 14.9);
  assert.equal(snapshot.revenue.currency, 'BRL');
  assert.equal(snapshot.commercialTerms.fixedFee, 0.5);
  assert.equal(snapshot.commercialTerms.fixedFeeCurrency, 'BRL');
  assert.equal(snapshot.commercialTerms.fixedFeeClassification, 'estimated_reliable');
  assert.equal(snapshot.costBreakdown.paymentProcessorFixedCost, 0.5);
  assert.equal(snapshot.usageMetrics.routingCalls, null);
  assert.equal(snapshot.usageMetrics.weatherCalls, null);
  assert.equal(snapshot.marginAnalysis.classification, 'absent');
  assert.equal(snapshot.fxNormalization.calculationCurrency, 'BRL');
  assert.equal(snapshot.fxNormalization.classification, 'real');
  assert.deepEqual(snapshot.fxNormalization.entries, []);
  assert.ok(snapshot.marginAnalysis.blockers.includes('missing_routing_usage'));
  assert.ok(snapshot.marginAnalysis.blockers.includes('missing_weather_usage'));
});

test('billing account snapshot does not fabricate app store revenue or margin', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        appStoreFeePercent: { value: 0.15, origin: 'real' },
        routingCostUsd: { value: 0.00004, origin: 'real' },
        weatherMissCostUsd: { value: 0.0009, origin: 'real' },
      },
    }),
    path: '',
  });

  const snapshot = buildBillingAccountCostSnapshot({
    record: {
      billing_provider: 'app_store',
      billing_currency: 'USD',
    },
    subscription: null,
    invoices: [],
    priceBook,
    usageMetrics: {
      routingCalls: null,
      weatherCalls: null,
      classification: 'absent',
    },
    platformAllocationCostUsd: {
      amountUsd: null,
      classification: 'absent',
      evidence: 'missing allocation input',
    },
  });

  assert.equal(snapshot.provider, 'app_store');
  assert.equal(snapshot.revenue.amount, null);
  assert.equal(snapshot.marginAnalysis.totalCost, null);
  assert.ok(
    snapshot.marginAnalysis.blockers.includes('provider_revenue_not_available'),
  );
});

test('account billing route reads persisted routing/weather usage and platform allocation snapshots', async () => {
  Object.assign(process.env, baseBillingEnv());
  process.env.ALERT_BILLING_USAGE_COVERAGE_STARTED_AT =
    '2026-04-30T00:00:00.000Z';

  const db = createFakeDb({
    billing_subscriptions: {
      'alert-user-1': {
        user_id: 'alert-user-1',
        billing_provider: 'app_store',
        billing_currency: 'USD',
        premium_active: true,
        subscription_status: 'active',
      },
      'alert-user-2': {
        user_id: 'alert-user-2',
        billing_provider: 'stripe',
        premium_active: true,
        subscription_status: 'active',
      },
    },
  });
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        app_store: {
          chosenPercentFee: {
            value: 0.3,
            classification: 'estimated_reliable',
            evidence: 'apple_default',
          },
        },
      },
      monthlyInfrastructure: {
        queueRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'queue_invoice',
        },
        cacheRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'cache_invoice',
        },
        workerComputeMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'worker_invoice',
        },
        webServingMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'web_invoice',
        },
      },
    }),
    path: '',
  });

  const app = createAppStub();
  const config = {
    weather: {
      userAgent: 'AlertBackend/Tests',
    },
    routing: {
      timeoutMs: 900,
    },
  };
  const logger = {
    warn: () => {},
    error: () => {},
    info: () => {},
  };

  registerFeedRoutes(app, {
    db,
    config,
    logger,
    getWeatherFeedFn: async () => ({
      available: true,
      location: {
        city: 'Fortaleza',
        latitude: -3.7319,
        longitude: -38.5267,
        timezone: 'America/Fortaleza',
      },
      current: {
        tempC: 29,
        apparentTempC: 31,
        humidity: 70,
        windKmh: 12,
        weatherCode: 1,
        icon: 'weather-sunny',
        labelKey: 'weather_clear_sky_day',
        isDay: true,
        precipitation: 0,
        rain: 0,
        showers: 0,
        snowfall: 0,
      },
      daily: {
        forecastDays: [],
      },
      intelligenceSignal: null,
      freshness: {
        fetchedAt: '2026-04-30T12:00:00.000Z',
        cacheTtlSec: 60,
        status: 'FRESH',
      },
    }),
  });
  registerMapsRoutes(app, {
    db,
    config,
    logger,
    routeOptionsSnapshot: async () => ({
      available: true,
      degraded: false,
      reasonCode: null,
      retryable: false,
      fallbackUsed: false,
      routeMode: 'provider',
      precision: 'high',
      providerAvailable: true,
      advisory: null,
      routes: [
        {
          id: 'provider-route',
          geometry: [
            [-38.5267, -3.7319],
            [-38.5107, -3.7172],
          ],
        },
      ],
      updatedAt: '2026-04-30T12:00:00.000Z',
      provider: {
        id: 'osrm',
        available: true,
        degraded: false,
      },
      transportMode: 'walk',
    }),
  });
  registerStripeBilling(app, {
    db,
    priceBookLoader: () => priceBook,
  });

  const weatherHandler = app.handlers.get('GET /api/v1/weather/feed');
  const weatherResponse = createResponseStub();
  await weatherHandler(
    {
      query: {
        lat: '-3.7319',
        lon: '-38.5267',
        locale: 'pt-BR',
      },
      headers: {
        'x-alert-user-id': 'alert-user-1',
      },
    },
    weatherResponse,
  );
  assert.equal(weatherResponse.statusCode, 200);

  const routesHandler = app.handlers.get('GET /v1/maps/routes');
  const routesResponse = createResponseStub();
  await routesHandler(
    {
      query: {
        fromLat: '-3.7319',
        fromLon: '-38.5267',
        toLat: '-3.7172',
        toLon: '-38.5107',
        mode: 'walk',
      },
      headers: {
        'x-alert-user-id': 'alert-user-1',
      },
      get: () => '',
    },
    routesResponse,
  );
  assert.equal(routesResponse.statusCode, 200);

  const billingHandler = app.handlers.get('GET /account/billing.json');
  const billingResponse = createResponseStub();
  await billingHandler(
    {
      headers: {
        'x-alert-user-id': 'alert-user-1',
        'x-alert-user-locale': 'en-US',
        'x-alert-country-code': 'US',
        'x-alert-city-name': 'New York',
      },
      query: {},
      body: {},
    },
    billingResponse,
  );

  assert.equal(billingResponse.statusCode, 200);
  assert.equal(billingResponse.body.usageMetrics.routingCalls, 1);
  assert.equal(billingResponse.body.usageMetrics.weatherCalls, 1);
  assert.ok(
    new Set(['real', 'estimated_reliable']).has(
      billingResponse.body.usageMetrics.classification,
    ),
  );
  assert.equal(
    billingResponse.body.operationalCosts.platformAllocationCostUsd,
    0.34,
  );
  assert.ok(
    new Set(['estimated_reliable', 'modeled']).has(
      billingResponse.body.operationalCosts.platformAllocationCostClassification,
    ),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes('missing_routing_usage'),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes('missing_weather_usage'),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'missing_platform_allocation_cost',
    ),
  );
  assert.ok(
    billingResponse.body.marginAnalysis.blockers.includes(
      'provider_revenue_not_available',
    ),
  );
  assert.equal(billingResponse.body.economicPolicy.tier, 'premium');
  assert.equal(
    billingResponse.body.economicPolicy.targetCostCapPercent,
    0.3,
  );
});

test('account billing route converts USD operational costs into BRL margin with an explicit structured FX rate', async () => {
  Object.assign(process.env, baseBillingEnv());
  process.env.ALERT_BILLING_USAGE_COVERAGE_STARTED_AT =
    '2026-04-01T00:00:00.000Z';

  const db = createFakeDb({
    billing_subscriptions: {
      'alert-user-1': {
        user_id: 'alert-user-1',
        billing_provider: 'stripe',
        billing_currency: 'BRL',
        stripe_price_id: 'price_brl_premium',
        premium_active: true,
        subscription_status: 'active',
      },
    },
  });
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        stripe: {
          percentFee: {
            value: 0.0399,
            classification: 'estimated_reliable',
            evidence: 'stripe_percent',
          },
          fixedFee: {
            value: 0.5,
            currency: 'BRL',
            classification: 'estimated_reliable',
            evidence: 'stripe_fixed_brl',
          },
        },
      },
      currencyNormalization: {
        usdToBrl: {
          value: 5,
          classification: 'estimated_reliable',
          evidence: 'bcb_ptax_reference',
        },
      },
      monthlyInfrastructure: {
        queueRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'queue_invoice',
        },
        cacheRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'cache_invoice',
        },
        workerComputeMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'worker_invoice',
        },
        webServingMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'web_invoice',
        },
      },
    }),
    path: '',
    strict: true,
  });

  const app = createAppStub();
  const config = {
    weather: {
      userAgent: 'AlertBackend/Tests',
    },
    routing: {
      timeoutMs: 900,
    },
  };
  const logger = {
    warn: () => {},
    error: () => {},
    info: () => {},
  };

  registerFeedRoutes(app, {
    db,
    config,
    logger,
    getWeatherFeedFn: async () => ({
      available: true,
      location: {
        city: 'Fortaleza',
        latitude: -3.7319,
        longitude: -38.5267,
        timezone: 'America/Fortaleza',
      },
      current: {
        tempC: 29,
        apparentTempC: 31,
        humidity: 70,
        windKmh: 12,
        weatherCode: 1,
        icon: 'weather-sunny',
        labelKey: 'weather_clear_sky_day',
        isDay: true,
        precipitation: 0,
        rain: 0,
        showers: 0,
        snowfall: 0,
      },
      daily: {
        forecastDays: [],
      },
      intelligenceSignal: null,
      freshness: {
        fetchedAt: '2026-04-30T12:00:00.000Z',
        cacheTtlSec: 60,
        status: 'FRESH',
      },
    }),
  });
  registerMapsRoutes(app, {
    db,
    config,
    logger,
    routeOptionsSnapshot: async () => ({
      available: true,
      degraded: false,
      reasonCode: null,
      retryable: false,
      fallbackUsed: false,
      routeMode: 'provider',
      precision: 'high',
      providerAvailable: true,
      advisory: null,
      routes: [
        {
          id: 'provider-route',
          geometry: [
            [-38.5267, -3.7319],
            [-38.5107, -3.7172],
          ],
        },
      ],
      updatedAt: '2026-04-30T12:00:00.000Z',
      provider: {
        id: 'osrm',
        available: true,
        degraded: false,
      },
      transportMode: 'walk',
    }),
  });
  registerStripeBilling(app, {
    db,
    priceBookLoader: () => priceBook,
    getStripeClientFn: () => ({}),
    loadBillingOfferFn: async () => ({
      available: true,
      source: 'stripe_price',
      priceId: 'price_brl_premium',
      productId: 'prod_alert',
      productName: 'Alert Premium',
      productDescription: 'Monthly premium access',
      unitAmount: 1490,
      currency: 'BRL',
      interval: 'month',
      intervalCount: 1,
      livemode: false,
    }),
  });

  const weatherHandler = app.handlers.get('GET /api/v1/weather/feed');
  const weatherResponse = createResponseStub();
  await weatherHandler(
    {
      query: {
        lat: '-3.7319',
        lon: '-38.5267',
        locale: 'pt-BR',
      },
      headers: {
        'x-alert-user-id': 'alert-user-1',
      },
    },
    weatherResponse,
  );
  assert.equal(weatherResponse.statusCode, 200);

  const routesHandler = app.handlers.get('GET /v1/maps/routes');
  const routesResponse = createResponseStub();
  await routesHandler(
    {
      query: {
        fromLat: '-3.7319',
        fromLon: '-38.5267',
        toLat: '-3.7172',
        toLon: '-38.5107',
        mode: 'walk',
      },
      headers: {
        'x-alert-user-id': 'alert-user-1',
      },
      get: () => '',
    },
    routesResponse,
  );
  assert.equal(routesResponse.statusCode, 200);

  const billingHandler = app.handlers.get('GET /account/billing.json');
  const billingResponse = createResponseStub();
  await billingHandler(
    {
      headers: {
        'x-alert-user-id': 'alert-user-1',
        'x-alert-user-locale': 'pt-BR',
        'x-alert-country-code': 'BR',
        'x-alert-city-name': 'Fortaleza',
      },
      query: {},
      body: {},
    },
    billingResponse,
  );

  assert.equal(billingResponse.statusCode, 200);
  assert.equal(billingResponse.body.revenueAnalysis.amount, 14.9);
  assert.equal(billingResponse.body.revenueAnalysis.currency, 'BRL');
  assert.equal(
    billingResponse.body.revenueAnalysis.classification,
    'estimated_reliable',
  );
  assert.equal(billingResponse.body.usageMetrics.routingCalls, 1);
  assert.equal(billingResponse.body.usageMetrics.weatherCalls, 1);
  assert.equal(billingResponse.body.usageMetrics.classification, 'real');
  assert.equal(
    billingResponse.body.operationalCosts.platformAllocationCostUsd,
    0.34,
  );
  assert.equal(
    billingResponse.body.operationalCosts.routingUnitCostUsd,
    0.000004,
  );
  assert.equal(
    billingResponse.body.operationalCosts.weatherUnitCostUsd,
    0.000004,
  );
  assert.equal(
    billingResponse.body.operationalCosts.routingUnitCostClassification,
    'modeled',
  );
  assert.equal(
    billingResponse.body.operationalCosts.weatherUnitCostClassification,
    'modeled',
  );
  assert.equal(
    billingResponse.body.operationalCosts.platformAllocationCostClassification,
    'estimated_reliable',
  );
  assert.equal(
    billingResponse.body.operationalCosts.priceBookStatus,
    'strict_failed',
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'missing_revenue_amount',
    ),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'missing_routing_unit_cost',
    ),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'missing_weather_unit_cost',
    ),
  );
  const expectedTotal =
    14.9 * 0.0399 + 0.5 + (0.000004 + 0.000004 + 0.34) * 5;
  assert.equal(
    billingResponse.body.costBreakdown.totalCostCurrency,
    'BRL',
  );
  assert.equal(
    billingResponse.body.fxNormalization.calculationCurrency,
    'BRL',
  );
  assert.equal(
    billingResponse.body.fxNormalization.classification,
    'estimated_reliable',
  );
  assert.equal(
    billingResponse.body.fxNormalization.entries.length,
    1,
  );
  assert.equal(
    billingResponse.body.fxNormalization.entries[0].baseCurrency,
    'USD',
  );
  assert.equal(
    billingResponse.body.fxNormalization.entries[0].targetCurrency,
    'BRL',
  );
  assert.equal(
    billingResponse.body.fxNormalization.entries[0].rate,
    5,
  );
  assert.deepEqual(
    billingResponse.body.fxNormalization.entries[0].appliedTo,
    ['platformAllocationCost', 'routingCost', 'weatherCost'],
  );
  assert.ok(
    Math.abs(
      (billingResponse.body.marginAnalysis.totalCost || 0) - expectedTotal,
    ) < 0.00001,
  );
  assert.equal(
    billingResponse.body.marginAnalysis.classification,
    'modeled',
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'missing_currency_conversion_rate_usd_to_brl',
    ),
  );
  assert.ok(
    !billingResponse.body.marginAnalysis.blockers.includes(
      'cost_components_use_mixed_currencies',
    ),
  );
  assert.deepEqual(billingResponse.body.fxNormalization.blockers, []);
  assert.equal(billingResponse.body.economicPolicy.tier, 'premium');
  assert.equal(
    billingResponse.body.economicPolicy.targetCostCapPercent,
    0.3,
  );
  assert.ok(
    billingResponse.body.economicPolicy.actualCostRatio <
      billingResponse.body.economicPolicy.targetCostCapPercent,
  );
  assert.equal(
    billingResponse.body.economicPolicy.requires_cheaper_path,
    false,
  );
  assert.equal(
    billingResponse.body.economicPolicy.block_or_degrade,
    false,
  );
  assert.equal(
    billingResponse.body.economicPolicy.sampleVolume.observedActiveUsers,
    1,
  );
  assert.equal(
    billingResponse.body.economicPolicy.sampleVolume.effectiveAllocationUsers,
    100,
  );
  assert.equal(
    billingResponse.body.economicPolicy.minSampleThreshold.activeUsers,
    100,
  );
  assert.equal(
    billingResponse.body.economicPolicy.minSampleThreshold.totalSuccessfulCalls,
    1000,
  );
});
