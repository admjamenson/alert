const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMobilePaymentSheetResponse,
  resolveMobileCurrencyCode,
  resolveMobileMerchantCountryCode,
  wantsRedirectResponse,
} = require('./registerStripeBilling');

test('mobile billing form request with JSON accept does not redirect', () => {
  const req = {
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json',
      'x-alert-mobile-billing': '1',
    },
    body: {
      mobile_billing: '1',
    },
  };

  assert.equal(wantsRedirectResponse(req), false);
});

test('browser billing form request still redirects', () => {
  const req = {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html,application/xhtml+xml',
    },
    body: {},
  };

  assert.equal(wantsRedirectResponse(req), true);
});

test('mobile payment sheet response contains normalized customer and payment intent data', () => {
  const response = buildMobilePaymentSheetResponse({
    config: {
      publishableKey: 'pk_test_sheet',
      market: {
        countryCode: 'br',
        currency: 'brl',
      },
    },
    customerId: 'cus_sheet_123',
    ephemeralKeySecret: 'ek_test_123',
    subscription: {
      id: 'sub_sheet_123',
      latest_invoice: {
        payment_intent: {
          id: 'pi_sheet_123',
          client_secret: 'pi_sheet_secret_123',
        },
      },
    },
  });

  assert.equal(response.publishableKey, 'pk_test_sheet');
  assert.equal(response.customerId, 'cus_sheet_123');
  assert.equal(response.customerEphemeralKeySecret, 'ek_test_123');
  assert.equal(response.paymentIntentClientSecret, 'pi_sheet_secret_123');
  assert.equal(response.paymentIntentId, 'pi_sheet_123');
  assert.equal(response.subscriptionId, 'sub_sheet_123');
  assert.equal(response.merchantCountryCode, 'BR');
  assert.equal(response.currencyCode, 'BRL');
  assert.equal(response.returnURL, 'alertapp://billing-return');
});

test('mobile payment sheet response fails fast when client secret is missing', () => {
  assert.throws(
    () =>
      buildMobilePaymentSheetResponse({
        config: {
          publishableKey: 'pk_test_sheet',
          market: {
            countryCode: 'US',
            currency: 'USD',
          },
        },
        customerId: 'cus_sheet_123',
        ephemeralKeySecret: 'ek_test_123',
        subscription: {
          id: 'sub_sheet_123',
          latest_invoice: {
            payment_intent: {
              id: 'pi_sheet_123',
            },
          },
        },
      }),
    /stripe_payment_missing_client_secret/,
  );
});

test('mobile payment sheet helpers normalize fallback country and currency', () => {
  assert.equal(
    resolveMobileMerchantCountryCode({
      market: {
        countryCode: '',
      },
      defaultCountryCode: 'de',
    }),
    'DE',
  );
  assert.equal(
    resolveMobileCurrencyCode({
      market: {
        currency: '',
      },
      defaultCurrency: 'eur',
    }),
    'EUR',
  );
});
