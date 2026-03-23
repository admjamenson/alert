const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { StripeBillingRepository, premiumActiveForStatus } = require('./stripeBillingRepository');
const {
  resolveBillingRuntimeConfig,
  validateStripeBillingRuntime,
} = require('./billingConfig');
const {
  allowQueryAuth,
  buildBillingAuthToken,
  getAuthenticatedBillingIdentity,
} = require('./billingAuth');

const BILLING_FRONTEND_ROUTES = ['/checkout', '/success', '/cancel', '/account/billing'];

const getStripeClient = () => {
  const { secretKey } = resolveBillingRuntimeConfig({}, process.env);
  const Stripe = require('stripe');
  return new Stripe(secretKey, {
    apiVersion: '2024-06-20',
    maxNetworkRetries: 2,
  });
};

const normalizePeriodEnd = value => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const extractSubscriptionPriceId = subscription => {
  const item = subscription?.items?.data?.[0];
  return item?.price?.id || null;
};

const logBilling = (level, message, extra = {}) => {
  const payload = {
    service: 'alert-stripe-billing',
    level,
    message,
    ...extra,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
};

const safeRequestId = value => String(value || '').trim().slice(0, 120) || null;

const normalizeStripeTimestamp = value => {
  if (!value) return null;
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
};

const toCurrencyCode = value => String(value || '').trim().toUpperCase() || null;

const buildInvoiceSummary = invoice => ({
  id: invoice?.id || '',
  number: invoice?.number || null,
  status: invoice?.status || null,
  currency: toCurrencyCode(invoice?.currency),
  amountPaid: typeof invoice?.amount_paid === 'number' ? invoice.amount_paid : null,
  amountDue: typeof invoice?.amount_due === 'number' ? invoice.amount_due : null,
  createdAt: normalizeStripeTimestamp(invoice?.created),
  hostedInvoiceUrl: invoice?.hosted_invoice_url || null,
  invoicePdf: invoice?.invoice_pdf || null,
});

const buildPaymentMethodSummary = paymentMethod => {
  if (!paymentMethod || paymentMethod.deleted) {
    return null;
  }

  const card = paymentMethod.card || null;
  if (!card) {
    return null;
  }

  return {
    brand: card.brand || null,
    last4: card.last4 || null,
    expMonth: Number.isFinite(card.exp_month) ? card.exp_month : null,
    expYear: Number.isFinite(card.exp_year) ? card.exp_year : null,
  };
};

const resolveDefaultPaymentMethod = ({ subscription, customer }) => {
  const subscriptionPaymentMethod = subscription?.default_payment_method;
  if (subscriptionPaymentMethod && typeof subscriptionPaymentMethod === 'object') {
    return subscriptionPaymentMethod;
  }

  const customerPaymentMethod = customer?.invoice_settings?.default_payment_method;
  if (customerPaymentMethod && typeof customerPaymentMethod === 'object') {
    return customerPaymentMethod;
  }

  return null;
};

const expressStaticSafe = dir => {
  const express = require('express');
  return express.static(dir);
};

const mountBillingFrontend = app => {
  const billingDist = path.join(__dirname, '..', '..', '..', 'billing-web', 'dist');
  if (!fs.existsSync(billingDist)) {
    return;
  }

  app.use(expressStaticSafe(billingDist));
  const indexHtml = path.join(billingDist, 'index.html');
  app.get(BILLING_FRONTEND_ROUTES, (_req, res) => {
    res.sendFile(indexHtml);
  });
};

const buildSuccessUrl = appUrl =>
  `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`;

const buildCancelUrl = appUrl => `${appUrl}/cancel`;

const buildPortalReturnUrl = appUrl => `${appUrl}/account/billing`;

const wantsRedirectResponse = req => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const accept = String(req.headers.accept || '').toLowerCase();
  const mobileBillingHeader = String(req.headers['x-alert-mobile-billing'] || '').trim();
  const mobileBillingBody =
    String(req.body?.mobile_billing || req.body?.mobileBilling || '').trim();

  if (
    mobileBillingHeader === '1' ||
    mobileBillingBody === '1' ||
    accept.includes('application/json')
  ) {
    return false;
  }

  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    accept.includes('text/html')
  );
};

const readRequestValue = (req, ...keys) => {
  for (const key of keys) {
    const headerValue = req?.headers?.[key];
    if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();

    const bodyValue = req?.body?.[key];
    if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();

    const queryValue = req?.query?.[key];
    if (typeof queryValue === 'string' && queryValue.trim()) return queryValue.trim();
  }
  return '';
};

const extractBillingMarketInput = req => ({
  locale: readRequestValue(req, 'x-alert-user-locale', 'user_locale', 'userLocale', 'locale'),
  countryCode: readRequestValue(
    req,
    'x-alert-country-code',
    'country_code',
    'countryCode',
    'country',
    'cc',
  ),
  cityName: readRequestValue(req, 'x-alert-city-name', 'city_name', 'cityName', 'city'),
});

const getBillingConfig = req => resolveBillingRuntimeConfig(extractBillingMarketInput(req), process.env);

const mapMobileBillingError = (error, intent) => {
  const fallbackError =
    intent === 'payment'
      ? 'payment_intent_unavailable'
      : intent === 'checkout'
      ? 'checkout_session_unavailable'
      : 'portal_session_unavailable';
  const message = String(error?.message || '').trim();

  if (!message) {
    return {
      statusCode: error?.statusCode || 500,
      error: fallbackError,
    };
  }

  if (message === 'missing_authenticated_user') {
    return {
      statusCode: 401,
      error: 'billing_auth_missing',
    };
  }

  if (
    message === 'invalid_billing_token_format' ||
    message === 'invalid_billing_token_signature' ||
    message === 'billing_token_expired'
  ) {
    return {
      statusCode: 401,
      error: 'billing_identity_invalid',
    };
  }

  if (
    message === 'missing_env_alert_billing_session_secret' ||
    message === 'invalid_json_env_shape' ||
    message === 'invalid_env_stripe_default_country' ||
    message.startsWith('missing_env_') ||
    message.startsWith('invalid_env_')
  ) {
    return {
      statusCode: 500,
      error: 'billing_configuration_invalid',
    };
  }

  if (
    message === 'billing_auth_missing' ||
    message === 'billing_identity_invalid' ||
    message === 'billing_configuration_invalid' ||
    message === 'billing_service_unavailable' ||
    message === 'stripe_checkout_missing_url' ||
    message === 'stripe_portal_missing_url' ||
    message === 'stripe_payment_missing_client_secret' ||
    message === 'missing_stripe_customer_id' ||
    message === 'payment_intent_unavailable' ||
    message === 'checkout_session_unavailable' ||
    message === 'portal_session_unavailable'
  ) {
    return {
      statusCode: error?.statusCode || 500,
      error: message,
    };
  }

  return {
    statusCode: error?.statusCode || 500,
    error: fallbackError,
  };
};

const toSafeMetadataValue = value => {
  const stableValue = String(value || '').trim();
  return stableValue ? stableValue.slice(0, 500) : '';
};

const buildBillingMetadata = ({ userId, market, priceId }) => ({
  user_id: toSafeMetadataValue(userId),
  billing_country_code: toSafeMetadataValue(market?.countryCode),
  billing_currency: toSafeMetadataValue(market?.currency),
  billing_locale: toSafeMetadataValue(market?.locale),
  billing_city_name: toSafeMetadataValue(market?.cityName),
  billing_market_tier: toSafeMetadataValue(market?.marketTier),
  billing_market_key: toSafeMetadataValue(market?.marketKey),
  billing_price_id: toSafeMetadataValue(priceId),
});

const buildStripeIdempotencyKey = (operation, payload) =>
  `${operation}_${crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 48)}`;

const extractRequestId = (req, auth) =>
  String(
    req.headers['idempotency-key'] ||
      req.headers['x-request-id'] ||
      req.body?.request_id ||
      req.body?.requestId ||
      req.query?.request_id ||
      req.query?.requestId ||
      auth?.billingTokenId ||
      `${auth?.userId || 'anon'}:${Math.floor(Date.now() / (5 * 60 * 1000))}`,
  ).trim();

const buildCustomerPreferredLocales = locale => {
  const normalized = String(locale || '').trim();
  if (!normalized) return undefined;
  const languageOnly = normalized.split('-')[0];
  return Array.from(new Set([normalized, languageOnly].filter(Boolean))).slice(0, 2);
};

const ensureStripeCustomer = async ({ stripe, repo, auth, current, config, requestId }) => {
  const metadata = buildBillingMetadata({
    userId: auth.userId,
    market: config.market,
    priceId: config.priceId,
  });
  const preferred_locales = buildCustomerPreferredLocales(config.market.locale);

  if (current?.stripe_customer_id) {
    await stripe.customers.update(current.stripe_customer_id, {
      metadata,
      preferred_locales,
    });

    await repo.upsertCustomerProfile({
      userId: auth.userId,
      stripeCustomerId: current.stripe_customer_id,
      billingCurrency: config.market.currency,
      billingCountryCode: config.market.countryCode,
      billingLocale: config.market.locale,
      billingCityName: config.market.cityName,
      billingMarketTier: config.market.marketTier,
      billingMarketKey: config.market.marketKey,
      sourceEvent: 'checkout_customer_existing',
    });

    return current.stripe_customer_id;
  }

  if (auth?.stripeCustomerId) {
    try {
      await stripe.customers.update(auth.stripeCustomerId, {
        metadata,
        preferred_locales,
      });

      await repo.upsertCustomerProfile({
        userId: auth.userId,
        stripeCustomerId: auth.stripeCustomerId,
        billingCurrency: config.market.currency,
        billingCountryCode: config.market.countryCode,
        billingLocale: config.market.locale,
        billingCityName: config.market.cityName,
        billingMarketTier: config.market.marketTier,
        billingMarketKey: config.market.marketKey,
        sourceEvent: 'checkout_customer_reuse',
      });

      return auth.stripeCustomerId;
    } catch (error) {
      if (error?.code !== 'resource_missing') {
        throw error;
      }
    }
  }

  const customer = await stripe.customers.create(
    {
      metadata,
      preferred_locales,
    },
    {
      idempotencyKey: buildStripeIdempotencyKey('customer', {
        userId: auth.userId,
        priceId: config.priceId,
        marketKey: config.market.marketKey,
        requestId,
      }),
    },
  );

  await repo.upsertCustomerProfile({
    userId: auth.userId,
    stripeCustomerId: customer.id,
    billingCurrency: config.market.currency,
    billingCountryCode: config.market.countryCode,
    billingLocale: config.market.locale,
    billingCityName: config.market.cityName,
    billingMarketTier: config.market.marketTier,
    billingMarketKey: config.market.marketKey,
    sourceEvent: 'checkout_customer_created',
  });

  return customer.id;
};

const extractBillingMetadata = (primary = {}, fallback = {}) => ({
  billingCurrency: primary?.billing_currency || fallback?.billing_currency || null,
  billingCountryCode: primary?.billing_country_code || fallback?.billing_country_code || null,
  billingLocale: primary?.billing_locale || fallback?.billing_locale || null,
  billingCityName: primary?.billing_city_name || fallback?.billing_city_name || null,
  billingMarketTier: primary?.billing_market_tier || fallback?.billing_market_tier || null,
  billingMarketKey: primary?.billing_market_key || fallback?.billing_market_key || null,
});

const MOBILE_PAYMENT_SHEET_RETURN_URL = 'alertapp://billing-return';

const resolveMobileMerchantCountryCode = config => {
  const normalized = String(
    config?.market?.countryCode || config?.defaultCountryCode || 'US',
  )
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : 'US';
};

const resolveMobileCurrencyCode = config => {
  const normalized = String(
    config?.market?.currency || config?.defaultCurrency || 'USD',
  )
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD';
};

const getPaymentIntentFromSubscription = subscription =>
  subscription?.latest_invoice?.payment_intent || null;

const buildMobilePaymentSheetResponse = ({
  config,
  customerId,
  ephemeralKeySecret,
  subscription,
}) => {
  const publishableKey = String(config?.publishableKey || '').trim();
  const customerEphemeralKeySecret = String(ephemeralKeySecret || '').trim();
  const paymentIntent = getPaymentIntentFromSubscription(subscription);
  const paymentIntentClientSecret = String(paymentIntent?.client_secret || '').trim();
  const paymentIntentId = String(paymentIntent?.id || '').trim();

  if (!publishableKey) {
    const error = new Error('billing_configuration_invalid');
    error.statusCode = 500;
    throw error;
  }

  if (!customerEphemeralKeySecret || !paymentIntentClientSecret || !paymentIntentId) {
    const error = new Error('stripe_payment_missing_client_secret');
    error.statusCode = 502;
    throw error;
  }

  return {
    publishableKey,
    customerId: String(customerId || '').trim(),
    customerEphemeralKeySecret,
    paymentIntentClientSecret,
    paymentIntentId,
    subscriptionId: String(subscription?.id || '').trim() || null,
    merchantCountryCode: resolveMobileMerchantCountryCode(config),
    currencyCode: resolveMobileCurrencyCode(config),
    returnURL: MOBILE_PAYMENT_SHEET_RETURN_URL,
  };
};

const handleSubscriptionSync = async (repo, subscription, sourceEvent) => {
  const existingBySubscription = await repo.findBySubscriptionId(subscription?.id);
  const existingByCustomer = await repo.findByCustomerId(subscription?.customer);
  const existing = existingBySubscription || existingByCustomer;
  const userId =
    subscription?.metadata?.user_id ||
    subscription?.metadata?.userId ||
    existing?.user_id ||
    null;

  return repo.syncSubscription({
    userId,
    stripeCustomerId: subscription?.customer || existing?.stripe_customer_id || null,
    stripeSubscriptionId: subscription?.id || existing?.stripe_subscription_id || null,
    stripePriceId: extractSubscriptionPriceId(subscription) || existing?.stripe_price_id || null,
    subscriptionStatus: subscription?.status || existing?.subscription_status || 'inactive',
    currentPeriodEnd: normalizePeriodEnd(subscription?.current_period_end || existing?.current_period_end),
    premiumActive: premiumActiveForStatus(subscription?.status),
    ...extractBillingMetadata(subscription?.metadata, existing || {}),
    sourceEvent,
  });
};

const syncSubscriptionFromInvoice = async (
  stripe,
  repo,
  invoice,
  sourceEvent,
  options = {},
) => {
  const current =
    (await repo.findBySubscriptionId(invoice?.subscription)) ||
    (await repo.findByCustomerId(invoice?.customer));
  const subscription = invoice?.subscription
    ? await stripe.subscriptions.retrieve(invoice.subscription)
    : null;
  const metadata = extractBillingMetadata(subscription?.metadata, current || {});
  const subscriptionStatus =
    options.subscriptionStatus || subscription?.status || current?.subscription_status || 'inactive';
  const premiumActive =
    typeof options.premiumActive === 'boolean'
      ? options.premiumActive
      : premiumActiveForStatus(subscriptionStatus);

  return repo.syncSubscription({
    userId:
      subscription?.metadata?.user_id ||
      current?.user_id ||
      invoice?.metadata?.user_id ||
      null,
    stripeCustomerId: invoice?.customer || subscription?.customer || current?.stripe_customer_id || null,
    stripeSubscriptionId: invoice?.subscription || subscription?.id || current?.stripe_subscription_id || null,
    stripePriceId:
      extractSubscriptionPriceId(subscription) ||
      invoice?.lines?.data?.[0]?.price?.id ||
      current?.stripe_price_id ||
      null,
    subscriptionStatus,
    currentPeriodEnd: normalizePeriodEnd(
      subscription?.current_period_end || current?.current_period_end || null,
    ),
    premiumActive,
    ...metadata,
    sourceEvent,
  });
};

const syncSubscriptionFromRefundedCharge = async (stripe, repo, charge, sourceEvent) => {
  if (charge?.invoice) {
    const invoice = await stripe.invoices.retrieve(charge.invoice);
    return syncSubscriptionFromInvoice(stripe, repo, invoice, sourceEvent);
  }

  const current = await repo.findByCustomerId(charge?.customer);
  if (!current) {
    return null;
  }

  return repo.syncSubscription({
    userId: current.user_id,
    stripeCustomerId: current.stripe_customer_id,
    stripeSubscriptionId: current.stripe_subscription_id,
    stripePriceId: current.stripe_price_id,
    subscriptionStatus: current.subscription_status,
    currentPeriodEnd: current.current_period_end,
    premiumActive: premiumActiveForStatus(current.subscription_status),
    billingCurrency: current.billing_currency,
    billingCountryCode: current.billing_country_code,
    billingLocale: current.billing_locale,
    billingCityName: current.billing_city_name,
    billingMarketTier: current.billing_market_tier,
    billingMarketKey: current.billing_market_key,
    sourceEvent,
  });
};

const buildPortalLookupContext = async ({ stripe, repo, auth, sessionId }) => {
  let userId = auth?.userId || null;
  let current = userId ? await repo.getByUserId(userId) : null;
  let customerId = current?.stripe_customer_id || auth?.stripeCustomerId || null;

  if (!customerId && sessionId) {
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    customerId = checkoutSession.customer || null;
    userId =
      userId ||
      checkoutSession.client_reference_id ||
      checkoutSession.metadata?.user_id ||
      checkoutSession.metadata?.userId ||
      null;
    current = current || (userId ? await repo.getByUserId(userId) : null);

    if (userId && customerId) {
      await repo.upsertCustomerProfile({
        userId,
        stripeCustomerId: customerId,
        ...extractBillingMetadata(checkoutSession.metadata || {}),
        sourceEvent: 'portal_session_lookup',
      });
    }
  }

  return { userId, current, customerId };
};

  const registerStripeBilling = (app, { db }) => {
  validateStripeBillingRuntime(process.env);
  const repo = new StripeBillingRepository(db);

  app.post('/billing/auth-token', async (req, res) => {
    try {
      const auth = getAuthenticatedBillingIdentity(req, process.env);
      const current = await repo.getByUserId(auth.userId);
      const token = buildBillingAuthToken(
        {
          userId: auth.userId,
          stripeCustomerId: current?.stripe_customer_id || auth.stripeCustomerId,
          locale: auth.locale,
          countryCode: auth.countryCode,
          cityName: auth.cityName,
        },
        process.env,
      );

      return res.json({
        token,
        userId: auth.userId,
        stripeCustomerId: current?.stripe_customer_id || auth.stripeCustomerId || null,
        authMode: auth.authMode,
      });
    } catch (error) {
      logBilling('error', 'Stripe billing auth token failed', {
        error: error.message,
      });
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get('/billing/config', (req, res) => {
    try {
      const config = getBillingConfig(req);
      return res.json({
        publishableKey: config.publishableKey,
        appUrl: config.appUrl,
        successUrl: buildSuccessUrl(config.appUrl),
        cancelUrl: buildCancelUrl(config.appUrl),
        portalReturnUrl: buildPortalReturnUrl(config.appUrl),
        priceId: config.priceId,
        priceSelection: config.priceSelection,
        market: config.market,
        checkoutLocale: config.checkoutLocale,
        automaticTaxEnabled: config.automaticTaxEnabled,
        billingAddressCollection: config.billingAddressCollection,
        taxIdCollectionEnabled: config.taxIdCollectionEnabled,
        queryAuthAllowed: allowQueryAuth(process.env),
      });
    } catch (error) {
      logBilling('error', 'Stripe billing config unavailable', {
        error: error.message,
      });
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

    const handleBillingAccountRequest = async (req, res) => {
      try {
        const auth = getAuthenticatedBillingIdentity(req, process.env);
        const config = getBillingConfig(req);
        const requestId = safeRequestId(extractRequestId(req, auth));
        const record = await repo.getByUserId(auth.userId);
      let customer = null;
      let subscription = null;
      let paymentMethod = null;
      let invoices = [];

      if (record?.stripe_customer_id) {
        try {
          const stripe = getStripeClient();
          customer = await stripe.customers.retrieve(record.stripe_customer_id, {
            expand: ['invoice_settings.default_payment_method'],
          });

          if (record?.stripe_subscription_id) {
            subscription = await stripe.subscriptions.retrieve(record.stripe_subscription_id, {
              expand: ['default_payment_method'],
            });
          }

          const invoiceList = await stripe.invoices.list({
            customer: record.stripe_customer_id,
            limit: 8,
          });

          invoices = Array.isArray(invoiceList?.data)
            ? invoiceList.data.map(buildInvoiceSummary)
            : [];
          paymentMethod = buildPaymentMethodSummary(
            resolveDefaultPaymentMethod({ subscription, customer }),
          );
        } catch (error) {
          logBilling('error', 'Billing Stripe account enrichment failed', {
            route: '/account/billing.json',
            requestId,
            error: error.message,
          });
        }
      }

      return res.json({
        userId: auth.userId,
        market: config.market,
        billing: record,
        customer:
          customer && !customer.deleted
            ? {
                id: customer.id || null,
                email: customer.email || null,
                name: customer.name || null,
              }
            : null,
        paymentMethod,
        invoices,
        portalAvailable: Boolean(record?.stripe_customer_id),
        checkoutAvailable: true,
        queryAuthAllowed: allowQueryAuth(process.env),
      });
    } catch (error) {
      logBilling('error', 'Billing account fetch failed', {
        route: '/account/billing.json',
        error: error.message,
        });
        return res.status(error.statusCode || 500).json({ error: error.message });
      }
    };

    app.get('/account/billing.json', handleBillingAccountRequest);
    app.post('/account/billing.json', handleBillingAccountRequest);

  app.post('/create-checkout-session', async (req, res) => {
    try {
      const stripe = getStripeClient();
      const auth = getAuthenticatedBillingIdentity(req, process.env);
      const config = getBillingConfig(req);
      const current = await repo.getByUserId(auth.userId);
      const requestId = extractRequestId(req, auth);
      const customerId = await ensureStripeCustomer({
        stripe,
        repo,
        auth,
        current,
        config,
        requestId,
      });
      const metadata = buildBillingMetadata({
        userId: auth.userId,
        market: config.market,
        priceId: config.priceId,
      });

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          client_reference_id: auth.userId,
          line_items: [
            {
              price: config.priceId,
              quantity: 1,
            },
          ],
          customer: customerId,
          success_url: buildSuccessUrl(config.appUrl),
          cancel_url: buildCancelUrl(config.appUrl),
          locale: config.checkoutLocale,
          billing_address_collection: config.billingAddressCollection,
          automatic_tax: { enabled: config.automaticTaxEnabled },
          tax_id_collection: { enabled: config.taxIdCollectionEnabled },
          payment_method_collection: 'always',
          customer_update: {
            address: 'auto',
            name: 'auto',
          },
          subscription_data: {
            metadata,
          },
          metadata,
        },
        {
          idempotencyKey: buildStripeIdempotencyKey('checkout', {
            userId: auth.userId,
            stripeCustomerId: customerId,
            priceId: config.priceId,
            marketKey: config.market.marketKey,
            requestId,
          }),
        },
      );

      logBilling('info', 'Stripe checkout session created', {
        route: '/create-checkout-session',
        requestId: safeRequestId(requestId),
        marketKey: config.market.marketKey,
        hasUrl: Boolean(session?.url),
      });
      if (!session?.url) {
        logBilling('error', 'Stripe checkout session missing url', {
          route: '/create-checkout-session',
          requestId: safeRequestId(requestId),
          hasUrl: false,
        });
        return res.status(502).json({ error: 'stripe_checkout_missing_url' });
      }
      if (wantsRedirectResponse(req)) {
        return res.redirect(303, session.url);
      }
      return res.json({
        url: session.url,
        sessionId: session.id,
      });
    } catch (error) {
      const auth = (() => {
        try {
          return getAuthenticatedBillingIdentity(req, process.env);
        } catch {
          return null;
        }
      })();
      const requestId = safeRequestId(extractRequestId(req, auth || {}));
      logBilling('error', 'Stripe checkout session failed', {
        route: '/create-checkout-session',
        requestId,
        error: error.message,
      });
      const normalized = mapMobileBillingError(error, 'checkout');
      return res.status(normalized.statusCode).json({ error: normalized.error });
    }
  });

  app.post('/create-payment-intent', async (req, res) => {
    try {
      const stripe = getStripeClient();
      const auth = getAuthenticatedBillingIdentity(req, process.env);
      const config = getBillingConfig(req);
      const current = await repo.getByUserId(auth.userId);
      const requestId = extractRequestId(req, auth);
      const customerId = await ensureStripeCustomer({
        stripe,
        repo,
        auth,
        current,
        config,
        requestId,
      });
      const metadata = buildBillingMetadata({
        userId: auth.userId,
        market: config.market,
        priceId: config.priceId,
      });

      const ephemeralKey = await stripe.ephemeralKeys.create(
        {
          customer: customerId,
        },
        {
          apiVersion: '2024-06-20',
        },
      );

      const subscription = await stripe.subscriptions.create(
        {
          customer: customerId,
          items: [
            {
              price: config.priceId,
            },
          ],
          payment_behavior: 'default_incomplete',
          payment_settings: {
            save_default_payment_method: 'on_subscription',
          },
          metadata,
          expand: ['latest_invoice.payment_intent'],
        },
        {
          idempotencyKey: buildStripeIdempotencyKey('mobile_subscription', {
            userId: auth.userId,
            stripeCustomerId: customerId,
            priceId: config.priceId,
            marketKey: config.market.marketKey,
            requestId,
          }),
        },
      );

      await repo.syncSubscription({
        userId: auth.userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription?.id || null,
        stripePriceId: extractSubscriptionPriceId(subscription) || config.priceId,
        subscriptionStatus: subscription?.status || 'incomplete',
        currentPeriodEnd: normalizePeriodEnd(subscription?.current_period_end),
        premiumActive: premiumActiveForStatus(subscription?.status),
        ...extractBillingMetadata(subscription?.metadata, {
          billing_currency: config.market.currency,
          billing_country_code: config.market.countryCode,
          billing_locale: config.market.locale,
          billing_city_name: config.market.cityName,
          billing_market_tier: config.market.marketTier,
          billing_market_key: config.market.marketKey,
        }),
        sourceEvent: 'mobile_payment_sheet_created',
      });

      const responsePayload = buildMobilePaymentSheetResponse({
        config,
        customerId,
        ephemeralKeySecret: ephemeralKey?.secret,
        subscription,
      });

      logBilling('info', 'Stripe mobile payment sheet created', {
        route: '/create-payment-intent',
        requestId: safeRequestId(requestId),
        hasClientSecret: Boolean(responsePayload.paymentIntentClientSecret),
      });

      return res.json(responsePayload);
    } catch (error) {
      const auth = (() => {
        try {
          return getAuthenticatedBillingIdentity(req, process.env);
        } catch {
          return null;
        }
      })();
      const requestId = safeRequestId(extractRequestId(req, auth || {}));
      logBilling('error', 'Stripe mobile payment sheet failed', {
        route: '/create-payment-intent',
        requestId,
        error: error.message,
      });
      const normalized = mapMobileBillingError(
        error?.message === 'stripe_payment_missing_client_secret'
          ? Object.assign(error, { statusCode: 502 })
          : error,
        'payment',
      );
      return res.status(normalized.statusCode).json({ error: normalized.error });
    }
  });

  app.post('/create-portal-session', async (req, res) => {
    try {
      const stripe = getStripeClient();
      const config = getBillingConfig(req);
      const sessionId = String(req.body?.session_id || req.body?.sessionId || '').trim();
      let auth = null;

      try {
        auth = getAuthenticatedBillingIdentity(req, process.env);
      } catch (error) {
        if (!sessionId) {
          throw error;
        }
      }

      const { userId, customerId } = await buildPortalLookupContext({
        stripe,
        repo,
        auth,
        sessionId,
      });

      if (!customerId) {
        return res.status(400).json({ error: 'missing_stripe_customer_id' });
      }

      const requestId = extractRequestId(req, auth || { userId, billingTokenId: sessionId });
      const session = await stripe.billingPortal.sessions.create(
        {
          customer: customerId,
          return_url: buildPortalReturnUrl(config.appUrl),
        },
        {
          idempotencyKey: buildStripeIdempotencyKey('portal', {
            userId,
            stripeCustomerId: customerId,
            requestId,
            sessionId,
          }),
        },
      );

      logBilling('info', 'Stripe portal session created', {
        route: '/create-portal-session',
        requestId: safeRequestId(requestId),
        hasUrl: Boolean(session?.url),
      });
      if (!session?.url) {
        logBilling('error', 'Stripe portal session missing url', {
          route: '/create-portal-session',
          requestId: safeRequestId(requestId),
          hasUrl: false,
        });
        return res.status(502).json({ error: 'stripe_portal_missing_url' });
      }
      if (wantsRedirectResponse(req)) {
        return res.redirect(303, session.url);
      }
      return res.json({ url: session.url });
    } catch (error) {
      const auth = (() => {
        try {
          return getAuthenticatedBillingIdentity(req, process.env);
        } catch {
          return null;
        }
      })();
      const requestId = safeRequestId(extractRequestId(req, auth || {}));
      logBilling('error', 'Stripe portal session failed', {
        route: '/create-portal-session',
        requestId,
        error: error.message,
      });
      const normalized = mapMobileBillingError(error, 'portal');
      return res.status(normalized.statusCode).json({ error: normalized.error });
    }
  });

  const stripeWebhookHandler = async (req, res) => {
    let event;

    try {
      const stripe = getStripeClient();
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).send('missing_stripe_signature');
      }

      const payloadBuffer = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
      if (!payloadBuffer) {
        return res.status(400).send('missing_raw_webhook_body');
      }

      event = stripe.webhooks.constructEvent(
        payloadBuffer,
        signature,
        resolveBillingRuntimeConfig({}, process.env).webhookSecret,
      );
    } catch (error) {
      logBilling('error', 'Stripe webhook verification failed', {
        error: error.message,
      });
      return res.status(400).send(`webhook_error:${error.message}`);
    }

    const object = event?.data?.object || {};
    const claim = await repo.claimWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      objectId:
        object.id ||
        object.subscription ||
        object.customer ||
        object.invoice ||
        null,
      requestIdempotencyKey: object?.idempotency_key || null,
    });

    if (claim.alreadyProcessed) {
      logBilling('info', 'Stripe webhook duplicate ignored', {
        eventId: event.id,
        type: event.type,
      });
      return res.json({ received: true, duplicate: true });
    }

    try {
      logBilling('info', 'Stripe webhook received', {
        eventId: event.id,
        type: event.type,
      });

      const stripe = getStripeClient();
      let syncResult = null;

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const userId =
            session.client_reference_id ||
            session.metadata?.user_id ||
            session.metadata?.userId ||
            null;
          let subscription = null;
          if (session.subscription) {
            subscription = await stripe.subscriptions.retrieve(session.subscription);
          }
          if (userId && session.customer) {
            await repo.upsertCustomerProfile({
              userId,
              stripeCustomerId: session.customer,
              ...extractBillingMetadata(subscription?.metadata, session.metadata || {}),
              sourceEvent: event.type,
            });
          }
          syncResult = await repo.syncSubscription({
            userId,
            stripeCustomerId: session.customer || subscription?.customer || null,
            stripeSubscriptionId: session.subscription || subscription?.id || null,
            stripePriceId:
              extractSubscriptionPriceId(subscription) ||
              session.metadata?.billing_price_id ||
              null,
            subscriptionStatus: subscription?.status || 'incomplete',
            currentPeriodEnd: normalizePeriodEnd(subscription?.current_period_end),
            premiumActive: premiumActiveForStatus(subscription?.status),
            ...extractBillingMetadata(subscription?.metadata, session.metadata || {}),
            sourceEvent: event.type,
          });
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.trial_will_end': {
          syncResult = await handleSubscriptionSync(repo, event.data.object, event.type);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const current =
            (await repo.findBySubscriptionId(subscription?.id)) ||
            (await repo.findByCustomerId(subscription?.customer));
          syncResult = await repo.syncSubscription({
            userId: current?.user_id || subscription?.metadata?.user_id || null,
            stripeCustomerId: subscription?.customer || current?.stripe_customer_id || null,
            stripeSubscriptionId: subscription?.id || current?.stripe_subscription_id || null,
            stripePriceId:
              extractSubscriptionPriceId(subscription) || current?.stripe_price_id || null,
            subscriptionStatus: subscription?.status || 'canceled',
            currentPeriodEnd: normalizePeriodEnd(subscription?.current_period_end),
            premiumActive: false,
            ...extractBillingMetadata(subscription?.metadata, current || {}),
            sourceEvent: event.type,
          });
          break;
        }
        case 'invoice.paid': {
          syncResult = await syncSubscriptionFromInvoice(
            stripe,
            repo,
            event.data.object,
            event.type,
          );
          break;
        }
        case 'invoice.payment_failed': {
          syncResult = await syncSubscriptionFromInvoice(
            stripe,
            repo,
            event.data.object,
            event.type,
            {
              subscriptionStatus: 'past_due',
              premiumActive: false,
            },
          );
          break;
        }
        case 'charge.refunded': {
          syncResult = await syncSubscriptionFromRefundedCharge(
            stripe,
            repo,
            event.data.object,
            event.type,
          );
          break;
        }
        case 'entitlements.active_entitlement_summary.updated': {
          logBilling('info', 'Stripe entitlement summary updated', {
            objectId: object?.id || null,
          });
          break;
        }
        default:
          logBilling('info', 'Stripe webhook ignored', {
            eventId: event.id,
            type: event.type,
          });
      }

      await repo.markWebhookEventProcessed({
        eventId: event.id,
        result: {
          type: event.type,
          userId: syncResult?.user_id || null,
          subscriptionStatus: syncResult?.subscription_status || null,
        },
      });

      return res.json({ received: true });
    } catch (error) {
      await repo.markWebhookEventFailed({ eventId: event?.id, errorMessage: error.message });
      logBilling('error', 'Stripe webhook processing failed', {
        eventId: event?.id,
        type: event?.type,
        error: error.message,
      });
      return res.status(500).json({ error: 'stripe_webhook_processing_failed' });
    }
  };

  app.post('/webhook', stripeWebhookHandler);
  app.post('/webhooks/stripe', stripeWebhookHandler);

  mountBillingFrontend(app);
};

module.exports = {
  registerStripeBilling,
  wantsRedirectResponse,
  buildMobilePaymentSheetResponse,
  resolveMobileMerchantCountryCode,
  resolveMobileCurrencyCode,
};
