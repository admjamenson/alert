const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBillingOfferFromStripePrice,
  buildUnavailableBillingOffer,
  buildMobilePaymentSheetResponse,
  resolveStripeBillingCurrency,
  extractSubscriptionCurrency,
  extractInvoiceLineCurrency,
} = require('./registerStripeBilling');

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
