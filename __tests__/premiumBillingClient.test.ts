jest.mock('react-native-localize', () => ({
  getLocales: () => [{ languageTag: 'pt-BR', countryCode: 'BR' }],
}), { virtual: true });

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
    (global as any).ALERT_API_URL = undefined;
    (global as any).__ALERT_API_URL__ = undefined;
    (global as any).__DEV__ = false;
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as any).ALERT_API_URL;
    delete (global as any).__ALERT_API_URL__;
    delete (global as any).fetch;
  });

  it('uses the live Render billing host by default', async () => {
    const { PremiumBillingApiAdapter } = loadAdapter();

    expect(PremiumBillingApiAdapter.getDiagnostics().baseUrl).toBe(
      'https://alert-vmpj.onrender.com',
    );
  });

  it('migrates the legacy mobile host to the live Render billing host', async () => {
    process.env.ALERT_API_URL = 'https://api.alertpremium.com';

    const { PremiumBillingApiAdapter } = loadAdapter();

    expect(PremiumBillingApiAdapter.getDiagnostics().baseUrl).toBe(
      'https://alert-vmpj.onrender.com',
    );
  });

  it('prefers the runtime global billing host override when present', async () => {
    (global as any).ALERT_API_URL = 'https://alert-vmpj.onrender.com';
    process.env.ALERT_API_URL = 'https://api.alertpremium.com';

    const { PremiumBillingApiAdapter } = loadAdapter();

    expect(PremiumBillingApiAdapter.getDiagnostics()).toEqual({
      baseUrl: 'https://alert-vmpj.onrender.com',
      baseUrlSource: 'global',
    });
  });

  it('requests a billing token first and returns the full PaymentSheet payload', async () => {
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
      'https://alert-vmpj.onrender.com/billing/auth-token',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://alert-vmpj.onrender.com/create-payment-intent',
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
      'https://alert-vmpj.onrender.com/billing/auth-token',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://alert-vmpj.onrender.com/create-payment-intent',
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://alert-vmpj.onrender.com/billing/auth-token',
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
});
