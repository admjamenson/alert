const {
  StripeBillingRepository,
  premiumActiveForStatus,
} = require('./stripeBillingRepository');
const { resolveBillingRuntimeConfig } = require('./billingConfig');
const {
  buildBillingAuthToken,
  getAuthenticatedBillingIdentity,
} = require('./billingAuth');

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
    service: 'alert-stripe-checkout',
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

const safeRequestId = value =>
  String(value || '')
    .trim()
    .slice(0, 120) || null;

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

const toCurrencyCode = value =>
  String(value || '')
    .trim()
    .toUpperCase() || null;

const buildInvoiceSummary = invoice => ({
  id: invoice?.id || '',
  number: invoice?.number || null,
  status: invoice?.status || null,
  currency: toCurrencyCode(invoice?.currency),
  amountPaid:
    typeof invoice?.amount_paid === 'number' ? invoice.amount_paid : null,
  amountDue:
    typeof invoice?.amount_due === 'number' ? invoice.amount_due : null,
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
  if (
    subscriptionPaymentMethod &&
    typeof subscriptionPaymentMethod === 'object'
  ) {
    return subscriptionPaymentMethod;
  }

  const customerPaymentMethod =
    customer?.invoice_settings?.default_payment_method;
  if (customerPaymentMethod && typeof customerPaymentMethod === 'object') {
    return customerPaymentMethod;
  }

  return null;
};

const buildSuccessUrl = appUrl =>
  `${appUrl}/success?payment_intent={PAYMENT_INTENT_ID}`;

const buildCancelUrl = appUrl => `${appUrl}/cancel`;

const buildPortalReturnUrl = appUrl => `${appUrl}/account/billing`;

const wantsRedirectResponse = req => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const accept = String(req.headers.accept || '').toLowerCase();
  const mobileBillingHeader = String(
    req.headers['x-alert-mobile-billing'] || '',
  ).trim();
  const mobileBillingBody = String(
    req.body?.mobile_billing || req.body?.mobileBilling || '',
  ).trim();

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
    if (typeof headerValue === 'string' && headerValue.trim())
      return headerValue.trim();

    const bodyValue = req?.body?.[key];
    if (typeof bodyValue === 'string' && bodyValue.trim())
      return bodyValue.trim();

    const queryValue = req?.query?.[key];
    if (typeof queryValue === 'string' && queryValue.trim())
      return queryValue.trim();
  }
  return '';
};

const extractBillingMarketInput = req => ({
  locale: readRequestValue(
    req,
    'x-alert-user-locale',
    'user_locale',
    'userLocale',
    'locale',
  ),
  countryCode: readRequestValue(
    req,
    'x-alert-country-code',
    'country_code',
    'countryCode',
    'country',
    'cc',
  ),
  cityName: readRequestValue(
    req,
    'x-alert-city-name',
    'city_name',
    'cityName',
    'city',
  ),
});

const getBillingConfig = req =>
  resolveBillingRuntimeConfig(extractBillingMarketInput(req), process.env);

const mapMobileBillingError = (error, intent) => {
  const fallbackError =
    intent === 'payment'
      ? 'payment_intent_unavailable'
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
    message === 'stripe_payment_missing_url' ||
    message === 'stripe_portal_missing_url' ||
    message === 'missing_stripe_customer_id' ||
    message === 'payment_intent_unavailable' ||
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
  return Array.from(new Set([normalized, languageOnly].filter(Boolean))).slice(
    0,
    2,
  );
};

const ensureStripeCustomer = async ({
  stripe,
  repo,
  auth,
  current,
  config,
  requestId,
}) => {
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
      sourceEvent: 'payment_customer_existing',
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
        sourceEvent: 'payment_customer_reuse',
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
    sourceEvent: 'payment_customer_created',
  });

  return customer.id;
};

const extractBillingMetadata = (primary = {}, fallback = {}) => ({
  billingCurrency:
    primary?.billing_currency || fallback?.billing_currency || null,
  billingCountryCode:
    primary?.billing_country_code || fallback?.billing_country_code || null,
  billingLocale: primary?.billing_locale || fallback?.billing_locale || null,
  billingCityName:
    primary?.billing_city_name || fallback?.billing_city_name || null,
  billingMarketTier:
    primary?.billing_market_tier || fallback?.billing_market_tier || null,
  billingMarketKey:
    primary?.billing_market_key || fallback?.billing_market_key || null,
});

const handleSubscriptionSync = async (repo, subscription, sourceEvent) => {
  const existingBySubscription = await repo.findBySubscriptionId(
    subscription?.id,
  );
  const existingByCustomer = await repo.findByCustomerId(
    subscription?.customer,
  );
  const existing = existingBySubscription || existingByCustomer;
  const userId =
    subscription?.metadata?.user_id ||
    subscription?.metadata?.userId ||
    existing?.user_id ||
    null;

  return repo.syncSubscription({
    userId,
    stripeCustomerId:
      subscription?.customer || existing?.stripe_customer_id || null,
    stripeSubscriptionId:
      subscription?.id || existing?.stripe_subscription_id || null,
    stripePriceId:
      extractSubscriptionPriceId(subscription) ||
      existing?.stripe_price_id ||
      null,
    subscriptionStatus:
      subscription?.status || existing?.subscription_status || 'inactive',
    currentPeriodEnd: normalizePeriodEnd(
      subscription?.current_period_end || existing?.current_period_end,
    ),
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
  const metadata = extractBillingMetadata(
    subscription?.metadata,
    current || {},
  );
  const subscriptionStatus =
    options.subscriptionStatus ||
    subscription?.status ||
    current?.subscription_status ||
    'inactive';
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
    stripeCustomerId:
      invoice?.customer ||
      subscription?.customer ||
      current?.stripe_customer_id ||
      null,
    stripeSubscriptionId:
      invoice?.subscription ||
      subscription?.id ||
      current?.stripe_subscription_id ||
      null,
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

const syncSubscriptionFromRefundedCharge = async (
  stripe,
  repo,
  charge,
  sourceEvent,
) => {
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
  let customerId =
    current?.stripe_customer_id || auth?.stripeCustomerId || null;

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

const registerStripeCheckout = app => {
  const repo = new StripeBillingRepository(app.locals.db);

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

      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: 999, // $9.99
          currency: config.market.currency || 'USD',
          customer: customerId,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never', // Important: disable redirects for PaymentSheet
          },
          metadata,
        },
        {
          idempotencyKey: buildStripeIdempotencyKey('payment_intent', {
            userId: auth.userId,
            stripeCustomerId: customerId,
            priceId: config.priceId,
            marketKey: config.market.marketKey,
            requestId,
          }),
        },
      );

      logBilling('info', 'Stripe payment intent created', {
        route: '/create-payment-intent',
        requestId: safeRequestId(requestId),
        marketKey: config.market.marketKey,
        hasClientSecret: Boolean(paymentIntent?.client_secret),
      });

      if (!paymentIntent?.client_secret) {
        logBilling('error', 'Stripe payment intent missing client secret', {
          route: '/create-payment-intent',
          requestId: safeRequestId(requestId),
          hasClientSecret: false,
        });
        return res
          .status(502)
          .json({ error: 'stripe_payment_missing_client_secret' });
      }

      return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
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
      logBilling('error', 'Stripe payment intent failed', {
        route: '/create-payment-intent',
        requestId,
        error: error.message,
      });
      const normalized = mapMobileBillingError(error, 'payment');
      return res
        .status(normalized.statusCode)
        .json({ error: normalized.error });
    }
  });

  app.post('/create-portal-session', async (req, res) => {
    try {
      const stripe = getStripeClient();
      const config = getBillingConfig(req);
      const sessionId = String(
        req.body?.session_id || req.body?.sessionId || '',
      ).trim();
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

      const requestId = extractRequestId(
        req,
        auth || { userId, billingTokenId: sessionId },
      );
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
      return res
        .status(normalized.statusCode)
        .json({ error: normalized.error });
    }
  });
};

module.exports = {
  registerStripeCheckout,
  wantsRedirectResponse,
};
