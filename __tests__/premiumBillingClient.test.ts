jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => [{ languageTag: 'pt-BR', countryCode: 'BR' }],
  }),
  { virtual: true },
);

jest.mock('../src/services/UserIdentityService', () => ({
  UserIdentityService: {
    getUserPhone: jest.fn(async () => '+5511999999999'),
    getDeviceId: jest.fn(async () => 'device-123'),
  },
}));

const okResponse = <T,>(body: T) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

describe('PremiumBillingApiAdapter', () => {
  const loadAdapter = () =>
    require('../src/infrastructure/adapters/PremiumBillingApiAdapter') as typeof import(
      '../src/infrastructure/adapters/PremiumBillingApiAdapter'
    );

  beforeEach(() => {
    jest.resetModules();
    process.env.ALERT_API_URL = '';
    (global as any).__DEV__ = false;
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('reports missing base url when ALERT_API_URL is not configured', async () => {
    const { PremiumBillingApiAdapter } = loadAdapter();

    expect(PremiumBillingApiAdapter.getDiagnostics()).toEqual({
      baseUrl: '',
      baseUrlSource: 'missing',
    });
  });

  it('uses the configured billing host from ALERT_API_URL', async () => {
    process.env.ALERT_API_URL = 'https://api.alert.app';

    const { PremiumBillingApiAdapter } = loadAdapter();

    expect(PremiumBillingApiAdapter.getDiagnostics()).toEqual({
      baseUrl: 'https://api.alert.app',
      baseUrlSource: 'config',
    });
  });

  it('loads the canonical premium offer from billing/config', async () => {
    process.env.ALERT_API_URL = 'https://api.alert.app';
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(
      okResponse({
        publishableKey: 'pk_test_123',
        appUrl: 'https://api.alert.app',
        successUrl: 'https://api.alert.app/success',
        cancelUrl: 'https://api.alert.app/cancel',
        portalReturnUrl: 'https://api.alert.app/account/billing',
        priceId: 'price_123',
        priceSelection: 'default',
        market: {
          countryCode: 'BR',
          currency: 'BRL',
          locale: 'pt-BR',
        },
        offer: {
          available: true,
          priceId: 'price_123',
          productId: 'prod_123',
          productName: 'Alert Premium',
          unitAmount: 1490,
          currency: 'brl',
          interval: 'month',
          intervalCount: 1,
          livemode: false,
        },
      }),
    );

    const { PremiumBillingApiAdapter } = loadAdapter();
    const result = await PremiumBillingApiAdapter.getBillingConfig();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.alert.app/billing/config',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Alert-User-Id': '+5511999999999',
          'X-Alert-Country-Code': 'BR',
        }),
      }),
    );
    expect(result.offer.available).toBe(true);
    expect(result.offer.productName).toBe('Alert Premium');
    expect(result.offer.currency).toBe('BRL');
    expect(result.offer.interval).toBe('month');
  });

  it('requests a billing token first and returns the full PaymentSheet payload', async () => {
    process.env.ALERT_API_URL = 'https://api.alert.app';
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(okResponse({ token: 'billing-token' }))
      .mockResolvedValueOnce(
        okResponse({
          publishableKey: 'pk_test_123',
          customerId: 'cus_123',
          customerEphemeralKeySecret: 'ephkey_123',
          paymentIntentClientSecret: 'pi_secret_123',
          paymentIntentId: 'pi_123',
          subscriptionId: 'sub_123',
          merchantCountryCode: 'BR',
          currencyCode: 'BRL',
          returnURL: 'alertapp://billing-return',
        }),
      );

    const { PremiumBillingApiAdapter } = loadAdapter();

    const result = await PremiumBillingApiAdapter.createPaymentIntent();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.alert.app/billing/auth-token',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.alert.app/create-payment-intent',
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Alert-Billing-Token': 'billing-token',
          'X-Alert-User-Id': '+5511999999999',
          'X-Alert-Country-Code': 'BR',
          'X-Alert-User-Locale': 'pt-BR',
        }),
      }),
    );
    expect(result).toEqual({
      publishableKey: 'pk_test_123',
      customerId: 'cus_123',
      customerEphemeralKeySecret: 'ephkey_123',
      paymentIntentClientSecret: 'pi_secret_123',
      paymentIntentId: 'pi_123',
      subscriptionId: 'sub_123',
      merchantCountryCode: 'BR',
      currencyCode: 'BRL',
      returnURL: 'alertapp://billing-return',
    });
  });

  it('refreshes the billing token when the cached token is rejected', async () => {
    process.env.ALERT_API_URL = 'https://api.alert.app';
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(okResponse({ token: 'stale-token' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'billing_token_expired' }),
      } as Response)
      .mockResolvedValueOnce(okResponse({ token: 'fresh-token' }))
      .mockResolvedValueOnce(
        okResponse({
          publishableKey: 'pk_test_123',
          customerId: 'cus_123',
          customerEphemeralKeySecret: 'ephkey_123',
          paymentIntentClientSecret: 'pi_secret_123',
          paymentIntentId: 'pi_123',
          returnURL: 'alertapp://billing-return',
        }),
      );

    const { PremiumBillingApiAdapter } = loadAdapter();

    const result = await PremiumBillingApiAdapter.createPaymentIntent();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.alert.app/billing/auth-token',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.alert.app/create-payment-intent',
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.alert.app/billing/auth-token',
    );
    expect(fetchMock.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Alert-Billing-Token': 'fresh-token',
        }),
      }),
    );
    expect(result.paymentIntentClientSecret).toBe('pi_secret_123');
  });

  it('confirms a payment intent through the canonical backend endpoint', async () => {
    process.env.ALERT_API_URL = 'https://api.alert.app';
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(okResponse({ token: 'billing-token' }))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          paymentIntentId: 'pi_123',
          paymentIntentStatus: 'succeeded',
          subscriptionId: 'sub_123',
          subscriptionStatus: 'active',
          customerId: 'cus_123',
          priceId: 'price_123',
          premiumActive: true,
          currentPeriodEnd: '2026-05-29T00:00:00.000Z',
          sourceEvent: 'mobile_payment_confirmation',
        }),
      );

    const { PremiumBillingApiAdapter } = loadAdapter();
    const result = await PremiumBillingApiAdapter.confirmPaymentIntent({
      paymentIntentId: 'pi_123',
      subscriptionId: 'sub_123',
    });

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.alert.app/confirm-payment-intent',
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Alert-Billing-Token': 'billing-token',
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      livemode: false,
      paymentIntentId: 'pi_123',
      paymentIntentStatus: 'succeeded',
      subscriptionId: 'sub_123',
      subscriptionStatus: 'active',
      customerId: 'cus_123',
      priceId: 'price_123',
      premiumActive: true,
      currentPeriodEnd: '2026-05-29T00:00:00.000Z',
      sourceEvent: 'mobile_payment_confirmation',
    });
  });
});
