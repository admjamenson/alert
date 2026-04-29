import * as RNLocalize from 'react-native-localize';
import { getAlertApiBaseUrl } from '../../core/config';
import { PremiumBillingAccount } from '../../domain/billing/PremiumBillingAccount';
import {
  PremiumBillingConfig,
  PremiumBillingOfferInterval,
  PremiumPaymentConfirmation,
} from '../../domain/billing/PremiumBillingConfig';
import { UserIdentityService } from '../../services/UserIdentityService';

const CANONICAL_BILLING_API_ORIGIN = getAlertApiBaseUrl();
const LEGACY_BILLING_API_HOSTS = new Set(['api.alertpremium.com']);
const HTTP_URL_PATTERN =
  /^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i;
const BILLING_REQUEST_TIMEOUT_MS = 8000;

type ParsedHttpUrl = {
  protocol: string;
  host: string;
  hostname: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  href: string;
};

const parseHttpUrl = (value: string): ParsedHttpUrl | null => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(HTTP_URL_PATTERN);
  if (!match) {
    return null;
  }

  const protocol = `${String(match[1] || '').toLowerCase()}:`;
  const host = String(match[2] || '').trim();
  if (!host) {
    return null;
  }

  const hostname = host.split(':')[0]?.toLowerCase() || '';
  const pathname = String(match[3] || '');
  const search = String(match[4] || '');
  const hash = String(match[5] || '');
  const origin = `${protocol}//${host}`;

  return {
    protocol,
    host,
    hostname,
    origin,
    pathname,
    search,
    hash,
    href: `${origin}${pathname}${search}${hash}`,
  };
};

const migrateLegacyBillingBaseUrl = (value: string) => {
  if (!value) {
    return value;
  }

  const parsed = parseHttpUrl(value);
  const canonical = parseHttpUrl(CANONICAL_BILLING_API_ORIGIN);
  if (!parsed || !canonical) {
    return value;
  }

  if (!LEGACY_BILLING_API_HOSTS.has(parsed.hostname)) {
    return value;
  }

  return `${canonical.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
    .replace(/\/+$/, '');
};

const normalizeBaseUrl = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  if (lower === 'undefined' || lower === 'null') {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return migrateLegacyBillingBaseUrl(normalized.replace(/\/+$/, ''));
  }

  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(normalized)) {
    return migrateLegacyBillingBaseUrl(
      `https://${normalized.replace(/\/+$/, '')}`,
    );
  }

  return '';
};

const getApiBaseUrl = () => {
  return normalizeBaseUrl(getAlertApiBaseUrl());
};

const getApiBaseUrlSource = (): 'config' | 'missing' =>
  getApiBaseUrl() ? 'config' : 'missing';

const debugLog = (
  label: string,
  payload?: Record<string, unknown>,
) => {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  if (payload) {
    console.log(`[premium/billing] ${label}`, payload);
    return;
  }

  console.log(`[premium/billing] ${label}`);
};

const getLocaleContext = async () => {
  const locales = RNLocalize.getLocales();
  const primaryLocale = locales[0]?.languageTag || 'en-US';
  const countryCode = (locales[0]?.countryCode || 'US').toUpperCase();
  const userId =
    (await UserIdentityService.getUserPhone()) ||
    (await UserIdentityService.getDeviceId());

  return {
    userId,
    locale: primaryLocale,
    countryCode,
  };
};

const createFallbackBillingAccount =
  async (): Promise<PremiumBillingAccount> => {
    const context = await getLocaleContext();
    return {
      userId: context.userId,
      billing: null,
      customer: null,
      paymentMethod: null,
      invoices: [],
      portalAvailable: true,
      checkoutAvailable: true,
    };
  };

const BILLING_TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;
const shouldCacheBillingToken = () => process.env.NODE_ENV !== 'test';

let cachedBillingToken: {
  token: string;
  expiresAt: number;
} | null = null;

type FetchBillingTokenOptions = {
  forceFresh?: boolean;
};

const buildIdentityHeaders = async (contentType = 'application/json') => {
  const context = await getLocaleContext();
  return {
    'Content-Type': contentType,
    Accept: 'application/json',
    'X-Alert-Mobile-Billing': '1',
    'X-Alert-User-Id': context.userId,
    'X-Alert-User-Locale': context.locale,
    'X-Alert-Country-Code': context.countryCode,
  };
};

const buildIdentityPayload = async () => {
  const context = await getLocaleContext();
  return {
    mobile_billing: '1',
    mobileBilling: '1',
    user_id: context.userId,
    userId: context.userId,
    user_locale: context.locale,
    userLocale: context.locale,
    country_code: context.countryCode,
    countryCode: context.countryCode,
  };
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const json = (await response
    .json()
    .catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(String(json?.error || '').trim() || `http_${response.status}`);
  }
  return json as T;
};

const normalizeBillingTransportError = (value: unknown): string | null => {
  const message = String(
    value instanceof Error ? value.message || '' : value || '',
  )
    .trim()
    .toLowerCase();

  if (!message) {
    return null;
  }

  if (
    message === 'billing_request_timeout' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('abort') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('dns') ||
    message.includes('ssl') ||
    message.includes('tls') ||
    message.includes('certificate') ||
    message.includes('secure channel')
  ) {
    return 'billing_service_unavailable';
  }

  return null;
};

const fetchWithTimeout = async (
  requestUrl: string,
  init: RequestInit,
): Promise<Response> => {
  if (typeof AbortController === 'undefined') {
    return fetch(requestUrl, init);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, BILLING_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(requestUrl, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const message = String(
      error instanceof Error ? error.message || '' : error || '',
    )
      .trim()
      .toLowerCase();

    if (message.includes('abort') || message.includes('timeout')) {
      throw new Error('billing_request_timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeBillingAuthError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'billing_auth_missing';
  }

  const message = String(error.message || '').trim();
  if (!message) {
    return 'billing_auth_missing';
  }

  const transportError = normalizeBillingTransportError(message);
  if (transportError) {
    return transportError;
  }

  if (
    message === 'missing_api_base_url' ||
    message === 'billing_auth_missing' ||
    message === 'billing_identity_invalid' ||
    message === 'billing_configuration_invalid' ||
    message === 'billing_service_unavailable'
  ) {
    return message;
  }

  if (message === 'missing_authenticated_user' || message === 'http_401') {
    return 'billing_auth_missing';
  }

  if (
    message === 'invalid_billing_token_format' ||
    message === 'invalid_billing_token_signature' ||
    message === 'billing_token_expired' ||
    message === 'http_403'
  ) {
    return 'billing_identity_invalid';
  }

  if (
    message === 'missing_env_alert_billing_session_secret' ||
    message === 'invalid_json_env_shape' ||
    message === 'invalid_env_stripe_default_country' ||
    message.startsWith('missing_env_') ||
    message.startsWith('invalid_env_')
  ) {
    return 'billing_configuration_invalid';
  }

  return 'billing_auth_missing';
};

const fetchBillingToken = async (
  baseUrl: string,
  options: FetchBillingTokenOptions = {},
): Promise<string> => {
  if (options.forceFresh) {
    cachedBillingToken = null;
  }

  const now = Date.now();
  if (
    shouldCacheBillingToken() &&
    cachedBillingToken &&
    !options.forceFresh &&
    cachedBillingToken.expiresAt > now
  ) {
    return cachedBillingToken.token;
  }

  const requestUrl = buildAbsoluteUrl(baseUrl, 'billing/auth-token');
  const payload = await buildIdentityPayload();
  const attemptEncodings: Array<'json' | 'form'> = ['json', 'form'];
  let lastError: Error | null = null;

  debugLog('auth-token.request', {
    baseUrl,
    requestUrl,
    userId: payload.user_id,
    locale: payload.user_locale,
    countryCode: payload.country_code,
  });

  for (const encoding of attemptEncodings) {
    try {
      const isForm = encoding === 'form';
      const response = await fetchWithTimeout(requestUrl, {
        method: 'POST',
        headers: await buildIdentityHeaders(
          isForm
            ? 'application/x-www-form-urlencoded; charset=UTF-8'
            : 'application/json',
        ),
        body: isForm ? buildFormEncodedBody(payload) : JSON.stringify(payload),
      });
      const parsed = await parseJson<{ token?: string }>(response);
      const token = String(parsed?.token || '').trim();
      if (!token) {
        throw new Error('billing_auth_missing');
      }

      debugLog('auth-token.success', {
        requestUrl,
        encoding,
        status: response.status,
      });

      if (shouldCacheBillingToken()) {
        cachedBillingToken = {
          token,
          expiresAt: now + BILLING_TOKEN_CACHE_TTL_MS,
        };
      }
      return token;
    } catch (error) {
      const normalized = new Error(normalizeBillingAuthError(error));
      lastError = normalized;
      debugLog('auth-token.failure', {
        requestUrl,
        encoding,
        error: normalized.message,
      });
      if (
        encoding === 'json' &&
        (normalized.message === 'billing_auth_missing' ||
          normalized.message === 'billing_identity_invalid' ||
          normalized.message === 'billing_service_unavailable')
      ) {
        continue;
      }
      throw normalized;
    }
  }

  throw lastError || new Error('billing_auth_missing');
};

const canFallbackToUnsignedHeaders = (errorCode: string) =>
  errorCode === 'billing_auth_missing' ||
  errorCode === 'billing_identity_invalid' ||
  errorCode === 'billing_configuration_invalid' ||
  errorCode === 'billing_service_unavailable';

const buildUnsignedHeaders = async (contentType = 'application/json') =>
  buildIdentityHeaders(contentType);

const buildBillingRequestPayload = async (
  options: {
    billingToken?: string;
    extraPayload?: Record<string, unknown>;
  } = {},
) => {
  const identity = await buildIdentityPayload();
  const billingToken = String(options.billingToken || '').trim();
  const extraPayload = options.extraPayload || {};

  if (!billingToken) {
    return {
      ...identity,
      ...extraPayload,
    };
  }

  return {
    ...identity,
    ...extraPayload,
    billing_token: billingToken,
    billingToken,
  };
};

const buildFormEncodedBody = (payload: Record<string, unknown>) => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'undefined' || value === null) {
      continue;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }
    form.append(key, normalized);
  }
  return form.toString();
};

const postBillingEndpoint = async (
  requestUrl: string,
  options: {
    billingToken?: string;
    encoding?: 'json' | 'form';
    extraPayload?: Record<string, unknown>;
  } = {},
) => {
  const billingToken = String(options.billingToken || '').trim();
  const encoding = options.encoding || 'json';
  const payload = await buildBillingRequestPayload({
    billingToken,
    extraPayload: options.extraPayload,
  });
  const isForm = encoding === 'form';
  const headers = billingToken
    ? {
        ...(await buildIdentityHeaders(
          isForm
            ? 'application/x-www-form-urlencoded; charset=UTF-8'
            : 'application/json',
        )),
        'X-Alert-Billing-Token': billingToken,
      }
    : await buildUnsignedHeaders(
        isForm
          ? 'application/x-www-form-urlencoded; charset=UTF-8'
          : 'application/json',
      );

  return fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers,
    body: isForm ? buildFormEncodedBody(payload) : JSON.stringify(payload),
  });
};

const buildAbsoluteUrl = (baseUrl: string, pathname: string) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(pathname || '')
    .trim()
    .replace(/^\/+/, '');

  if (!normalizedBase) {
    throw new Error('missing_api_base_url');
  }

  return `${normalizedBase}/${normalizedPath}`;
};

const getApiOrigin = (baseUrl: string) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) {
    throw new Error('missing_api_base_url');
  }
  const parsed = parseHttpUrl(normalizedBase);
  if (!parsed) {
    throw new Error('missing_api_base_url');
  }
  return parsed.origin;
};

const normalizeMobileBillingUrl = async (
  value: unknown,
  intent: 'checkout' | 'portal',
): Promise<string> => {
  const raw = String(value || '').trim();
  const invalidError =
    intent === 'checkout' ? 'invalid_checkout_url' : 'invalid_portal_url';
  const unavailableError =
    intent === 'checkout'
      ? 'checkout_session_unavailable'
      : 'portal_session_unavailable';

  if (!raw) {
    throw new Error(unavailableError);
  }

  const apiBaseUrl = getApiBaseUrl();
  const apiOrigin = getApiOrigin(apiBaseUrl).toLowerCase();
  const parsed = parseHttpUrl(raw);
  if (!parsed) {
    throw new Error(invalidError);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(invalidError);
  }

  const pathname = parsed.pathname.toLowerCase() || '/';
  const sameApiOrigin = parsed.origin.toLowerCase() === apiOrigin;
  const isHostedCheckout = pathname === '/checkout';
  const isHostedPortal = pathname === '/account/billing';

  if (sameApiOrigin && (isHostedCheckout || isHostedPortal)) {
    throw new Error(invalidError);
  }

  if (sameApiOrigin) {
    throw new Error(invalidError);
  }

  return parsed.href;
};

const CHECKOUT_FALLBACK_ERROR = 'checkout_session_unavailable';
const PORTAL_FALLBACK_ERROR = 'portal_session_unavailable';

const canRetryBillingSessionRequest = (
  errorCode: string,
  intent: 'checkout' | 'portal',
) => {
  const fallbackError =
    intent === 'checkout' ? CHECKOUT_FALLBACK_ERROR : PORTAL_FALLBACK_ERROR;
  return (
    errorCode === 'billing_auth_missing' ||
    errorCode === 'billing_identity_invalid' ||
    errorCode === fallbackError
  );
};

const parseBillingEndpointWithFallbacks = async <T>(
  requestUrl: string,
  intent: 'checkout' | 'portal',
  billingToken: string,
  options: {
    extraPayload?: Record<string, unknown>;
  } = {},
): Promise<T> => {
  const attempts: Array<{ billingToken?: string; encoding: 'json' | 'form' }> =
    billingToken
      ? [
          { billingToken, encoding: 'json' },
          { billingToken, encoding: 'form' },
          { encoding: 'json' },
          { encoding: 'form' },
        ]
      : [{ encoding: 'json' }, { encoding: 'form' }];

  let lastError: Error | null = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const response = await postBillingEndpoint(requestUrl, {
        ...attempt,
        extraPayload: options.extraPayload,
      });
      return await parseJson<T>(response);
    } catch (error) {
      const normalized = new Error(normalizeBillingSessionError(error, intent));
      lastError = normalized;
      const tokenAuthFailure =
        Boolean(attempt.billingToken) &&
        canRetryWithFreshBillingToken(normalized.message);
      if (tokenAuthFailure) {
        throw normalized;
      }
      const hasMoreAttempts = index < attempts.length - 1;
      if (
        !hasMoreAttempts ||
        !canRetryBillingSessionRequest(normalized.message, intent)
      ) {
        throw normalized;
      }
      if (attempt.billingToken) {
        cachedBillingToken = null;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      intent === 'checkout' ? CHECKOUT_FALLBACK_ERROR : PORTAL_FALLBACK_ERROR,
    )
  );
};

const normalizeBillingSessionError = (
  error: unknown,
  intent: 'checkout' | 'portal',
): string => {
  const fallbackError =
    intent === 'checkout' ? CHECKOUT_FALLBACK_ERROR : PORTAL_FALLBACK_ERROR;
  const invalidUrlError =
    intent === 'checkout' ? 'invalid_checkout_url' : 'invalid_portal_url';
  const missingUrlError =
    intent === 'checkout'
      ? 'stripe_checkout_missing_url'
      : 'stripe_portal_missing_url';

  if (!(error instanceof Error)) {
    return fallbackError;
  }

  const message = String(error.message || '').trim();
  if (!message) {
    return fallbackError;
  }

  const transportError = normalizeBillingTransportError(message);
  if (transportError) {
    return transportError;
  }

  if (
    message === 'missing_api_base_url' ||
    message === invalidUrlError ||
    message === missingUrlError ||
    message === 'stripe_payment_missing_client_secret' ||
    message === 'billing_auth_missing' ||
    message === 'billing_identity_invalid' ||
    message === 'billing_configuration_invalid' ||
    message === 'billing_service_unavailable' ||
    message === 'missing_stripe_customer_id' ||
    message === 'payment_intent_unavailable' ||
    message === CHECKOUT_FALLBACK_ERROR ||
    message === PORTAL_FALLBACK_ERROR
  ) {
    return message;
  }

  if (message === 'missing_authenticated_user' || message === 'http_401') {
    return 'billing_auth_missing';
  }

  if (
    message === 'invalid_billing_token_format' ||
    message === 'invalid_billing_token_signature' ||
    message === 'billing_token_expired' ||
    message === 'http_403'
  ) {
    return 'billing_identity_invalid';
  }

  if (
    message === 'missing_env_alert_billing_session_secret' ||
    message === 'invalid_json_env_shape' ||
    message === 'invalid_env_stripe_default_country' ||
    message.startsWith('missing_env_') ||
    message.startsWith('invalid_env_')
  ) {
    return 'billing_configuration_invalid';
  }

  return fallbackError;
};

const normalizePaymentIntentError = (error: unknown): string => {
  const normalized = normalizeBillingSessionError(error, 'checkout');
  if (normalized === CHECKOUT_FALLBACK_ERROR) {
    return 'payment_intent_unavailable';
  }
  return normalized;
};

const canRetryWithFreshBillingToken = (errorCode: string) =>
  errorCode === 'billing_auth_missing' ||
  errorCode === 'billing_identity_invalid';

const runBillingSessionRequest = async <T>(
  baseUrl: string,
  requestUrl: string,
  intent: 'checkout' | 'portal',
  options: {
    extraPayload?: Record<string, unknown>;
  } = {},
): Promise<T> => {
  let billingToken = '';
  try {
    billingToken = await fetchBillingToken(baseUrl);
  } catch (error) {
    const normalized = normalizeBillingAuthError(error);
    if (!canFallbackToUnsignedHeaders(normalized)) {
      throw new Error(normalized);
    }
  }

  try {
    return await parseBillingEndpointWithFallbacks<T>(
      requestUrl,
      intent,
      billingToken,
      options,
    );
  } catch (error) {
    const normalized = normalizeBillingSessionError(error, intent);
    if (!billingToken || !canRetryWithFreshBillingToken(normalized)) {
      throw new Error(normalized);
    }

    cachedBillingToken = null;

    let refreshedToken = '';
    try {
      refreshedToken = await fetchBillingToken(baseUrl, { forceFresh: true });
    } catch (refreshError) {
      const refreshNormalized = normalizeBillingAuthError(refreshError);
      if (!canFallbackToUnsignedHeaders(refreshNormalized)) {
        throw new Error(refreshNormalized);
      }
    }

    return parseBillingEndpointWithFallbacks<T>(
      requestUrl,
      intent,
      refreshedToken,
      options,
    );
  }
};

const getBillingConfigHeaders = async () => ({
  ...(await buildUnsignedHeaders()),
});

/**
 * URL da página de checkout (billing-web) para fallback quando a API não retorna sessão.
 * A página aceita user_id (e opcionalmente locale, country_code) na query, como no alert-premium-billing.
 * Sempre retorna uma URL se houver baseUrl, mesmo que getLocaleContext falhe.
 */
export const getCheckoutFallbackUrl = async (): Promise<string | null> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return null;
  }
  const path = '/checkout';
  let url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  try {
    const context = await getLocaleContext();
    const params = new URLSearchParams();
    if (context.userId) {
      params.set('user_id', context.userId);
    }
    if (context.locale) {
      params.set('user_locale', context.locale);
    }
    if (context.countryCode) {
      params.set('country_code', context.countryCode);
    }
    const query = params.toString();
    if (query) {
      url += `?${query}`;
    }
  } catch {
    // mantém url sem query; a página de checkout ainda pode carregar
  }
  return url;
};

/**
 * URL da página do portal de cobrança (billing-web) para fallback quando a API não retorna sessão.
 */
export const getPortalFallbackUrl = async (): Promise<string | null> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return null;
  }
  const path = '/account/billing';
  let url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  try {
    const context = await getLocaleContext();
    const params = new URLSearchParams();
    if (context.userId) {
      params.set('user_id', context.userId);
    }
    if (context.locale) {
      params.set('user_locale', context.locale);
    }
    if (context.countryCode) {
      params.set('country_code', context.countryCode);
    }
    const query = params.toString();
    if (query) {
      url += `?${query}`;
    }
  } catch {
    // mantém url sem query
  }
  return url;
};

export const PremiumBillingApiAdapter = {
  getCheckoutFallbackUrl,
  getPortalFallbackUrl,

  getDiagnostics() {
    return {
      baseUrl: getApiBaseUrl(),
      baseUrlSource: getApiBaseUrlSource(),
    };
  },

  async getBillingAccount(): Promise<PremiumBillingAccount> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    try {
      return await runBillingSessionRequest<PremiumBillingAccount>(
        baseUrl,
        `${baseUrl}/account/billing.json`,
        'portal',
      );
    } catch {
      return createFallbackBillingAccount();
    }
  },

  async getBillingConfig(): Promise<PremiumBillingConfig> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    try {
      const requestUrl = buildAbsoluteUrl(baseUrl, 'billing/config');
      const response = await fetchWithTimeout(requestUrl, {
        method: 'GET',
        headers: await getBillingConfigHeaders(),
      });
      const payload = await parseJson<Partial<PremiumBillingConfig>>(response);

      const publishableKey = String(payload?.publishableKey || '').trim();
      const priceId = String(payload?.priceId || '').trim();

      if (!publishableKey || !priceId) {
        throw new Error('billing_configuration_invalid');
      }

      return {
        publishableKey,
        appUrl: String(payload?.appUrl || '').trim(),
        successUrl: String(payload?.successUrl || '').trim(),
        cancelUrl: String(payload?.cancelUrl || '').trim(),
        portalReturnUrl: String(payload?.portalReturnUrl || '').trim(),
        priceId,
        priceSelection: String(payload?.priceSelection || '').trim() || null,
        market: payload?.market || null,
        checkoutLocale: String(payload?.checkoutLocale || '').trim() || null,
        automaticTaxEnabled: Boolean(payload?.automaticTaxEnabled),
        billingAddressCollection:
          String(payload?.billingAddressCollection || '').trim() || null,
        taxIdCollectionEnabled: Boolean(payload?.taxIdCollectionEnabled),
        queryAuthAllowed: Boolean(payload?.queryAuthAllowed),
        offer: {
          available: Boolean(payload?.offer?.available),
          reasonCode:
            String(payload?.offer?.reasonCode || '').trim() || null,
          source: String(payload?.offer?.source || '').trim() || null,
          priceId: String(payload?.offer?.priceId || priceId).trim() || null,
          productId:
            String(payload?.offer?.productId || '').trim() || null,
          productName:
            String(payload?.offer?.productName || '').trim() || null,
          productDescription:
            String(payload?.offer?.productDescription || '').trim() || null,
          unitAmount:
            typeof payload?.offer?.unitAmount === 'number'
              ? payload.offer.unitAmount
              : null,
          currency:
            String(payload?.offer?.currency || '').trim().toUpperCase() ||
            null,
          interval: ((() => {
            const normalizedInterval = String(payload?.offer?.interval || '')
              .trim()
              .toLowerCase();
            if (
              normalizedInterval === 'day' ||
              normalizedInterval === 'week' ||
              normalizedInterval === 'month' ||
              normalizedInterval === 'year'
            ) {
              return normalizedInterval as PremiumBillingOfferInterval;
            }
            return null;
          })()),
          intervalCount:
            typeof payload?.offer?.intervalCount === 'number'
              ? payload.offer.intervalCount
              : null,
          livemode: Boolean(payload?.offer?.livemode),
        },
      };
    } catch (error) {
      const normalized = normalizeBillingSessionError(error, 'checkout');
      throw new Error(normalized);
    }
  },

  async createCheckoutSession(): Promise<{ url: string; sessionId?: string }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    try {
      const requestUrl = buildAbsoluteUrl(baseUrl, 'create-checkout-session');
      const responsePayload = await runBillingSessionRequest<{
        url: string;
        sessionId?: string;
      }>(baseUrl, requestUrl, 'checkout');
      return {
        url: await normalizeMobileBillingUrl(responsePayload?.url, 'checkout'),
        sessionId: String(responsePayload?.sessionId || '').trim() || undefined,
      };
    } catch (error) {
      const normalized = normalizeBillingSessionError(error, 'checkout');
      if (
        normalized === 'billing_auth_missing' ||
        normalized === 'billing_identity_invalid'
      ) {
        cachedBillingToken = null;
      }
      throw new Error(normalized);
    }
  },

  async createPortalSession(): Promise<{ url: string }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    try {
      const requestUrl = buildAbsoluteUrl(baseUrl, 'create-portal-session');
      const responsePayload = await runBillingSessionRequest<{
        url: string;
      }>(baseUrl, requestUrl, 'portal');
      return {
        url: await normalizeMobileBillingUrl(responsePayload?.url, 'portal'),
      };
    } catch (error) {
      const normalized = normalizeBillingSessionError(error, 'portal');
      if (
        normalized === 'billing_auth_missing' ||
        normalized === 'billing_identity_invalid'
      ) {
        cachedBillingToken = null;
      }
      throw new Error(normalized);
    }
  },

  async createPaymentIntent(): Promise<{
    publishableKey: string;
    customerId: string;
    customerEphemeralKeySecret: string;
    paymentIntentClientSecret: string;
    paymentIntentId: string;
    subscriptionId?: string | null;
    merchantCountryCode?: string;
    currencyCode?: string;
    returnURL?: string;
  }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    try {
      const requestUrl = buildAbsoluteUrl(baseUrl, 'create-payment-intent');
      debugLog('payment-intent.request', {
        baseUrl,
        requestUrl,
        baseUrlSource: getApiBaseUrlSource(),
      });
      const responsePayload = await runBillingSessionRequest<{
        publishableKey: string;
        customerId: string;
        customerEphemeralKeySecret: string;
        paymentIntentClientSecret: string;
        paymentIntentId: string;
        subscriptionId?: string | null;
        merchantCountryCode?: string;
        currencyCode?: string;
        returnURL?: string;
      }>(baseUrl, requestUrl, 'checkout');

      const publishableKey = String(responsePayload?.publishableKey || '').trim();
      const customerId = String(responsePayload?.customerId || '').trim();
      const customerEphemeralKeySecret = String(
        responsePayload?.customerEphemeralKeySecret || '',
      ).trim();
      const paymentIntentClientSecret = String(
        responsePayload?.paymentIntentClientSecret || '',
      ).trim();
      const paymentIntentId = String(responsePayload?.paymentIntentId || '').trim();

      if (
        !publishableKey ||
        !customerId ||
        !customerEphemeralKeySecret ||
        !paymentIntentClientSecret ||
        !paymentIntentId
      ) {
        throw new Error('stripe_payment_missing_client_secret');
      }

      debugLog('payment-intent.success', {
        requestUrl,
        hasPublishableKey: Boolean(publishableKey),
        hasCustomerId: Boolean(customerId),
        hasEphemeralKey: Boolean(customerEphemeralKeySecret),
        hasClientSecret: Boolean(paymentIntentClientSecret),
        hasReturnUrl: Boolean(
          String(responsePayload?.returnURL || '').trim(),
        ),
      });

      return {
        publishableKey,
        customerId,
        customerEphemeralKeySecret,
        paymentIntentClientSecret,
        paymentIntentId,
        subscriptionId: String(responsePayload?.subscriptionId || '').trim() || null,
        merchantCountryCode:
          String(responsePayload?.merchantCountryCode || '').trim() || undefined,
        currencyCode: String(responsePayload?.currencyCode || '').trim() || undefined,
        returnURL: String(responsePayload?.returnURL || '').trim() || undefined,
      };
    } catch (error) {
      const normalized = normalizePaymentIntentError(error);
      debugLog('payment-intent.failure', {
        requestUrl: buildAbsoluteUrl(baseUrl, 'create-payment-intent'),
        error: normalized,
      });
      if (
        normalized === 'billing_auth_missing' ||
        normalized === 'billing_identity_invalid'
      ) {
        cachedBillingToken = null;
      }
      throw new Error(normalized);
    }
  },

  async confirmPaymentIntent(options: {
    paymentIntentId: string;
    subscriptionId?: string | null;
  }): Promise<PremiumPaymentConfirmation> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new Error('missing_api_base_url');
    }

    const paymentIntentId = String(options.paymentIntentId || '').trim();
    if (!paymentIntentId) {
      throw new Error('payment_intent_unavailable');
    }

    try {
      const requestUrl = buildAbsoluteUrl(baseUrl, 'confirm-payment-intent');
      const responsePayload = await runBillingSessionRequest<
        Partial<PremiumPaymentConfirmation>
      >(baseUrl, requestUrl, 'checkout', {
        extraPayload: {
          payment_intent_id: paymentIntentId,
          paymentIntentId,
          subscription_id:
            String(options.subscriptionId || '').trim() || undefined,
          subscriptionId:
            String(options.subscriptionId || '').trim() || undefined,
        },
      });

      return {
        ok: Boolean(responsePayload?.ok),
        livemode: Boolean(responsePayload?.livemode),
        paymentIntentId:
          String(responsePayload?.paymentIntentId || paymentIntentId).trim(),
        paymentIntentStatus:
          String(responsePayload?.paymentIntentStatus || '').trim() || null,
        subscriptionId:
          String(
            responsePayload?.subscriptionId || options.subscriptionId || '',
          ).trim() || null,
        subscriptionStatus:
          String(responsePayload?.subscriptionStatus || '').trim() || null,
        customerId:
          String(responsePayload?.customerId || '').trim() || null,
        priceId: String(responsePayload?.priceId || '').trim() || null,
        premiumActive: Boolean(responsePayload?.premiumActive),
        currentPeriodEnd:
          String(responsePayload?.currentPeriodEnd || '').trim() || null,
        sourceEvent:
          String(responsePayload?.sourceEvent || '').trim() || null,
      };
    } catch (error) {
      const normalized = normalizePaymentIntentError(error);
      throw new Error(normalized);
    }
  },
};
