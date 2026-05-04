export type PremiumBillingIntent = 'checkout' | 'portal';

export type PremiumBillingErrorCode =
  | 'billing_auth_missing'
  | 'billing_identity_invalid'
  | 'missing_stripe_customer_id'
  | 'missing_api_base_url'
  | 'billing_configuration_invalid'
  | 'billing_service_unavailable'
  | 'billing_browser_unavailable'
  | 'stripe_checkout_missing_url'
  | 'stripe_portal_missing_url'
  | 'stripe_payment_missing_client_secret'
  | 'payment_intent_unavailable'
  | 'invalid_checkout_url'
  | 'invalid_portal_url'
  | 'premium_error_payment_canceled'
  | 'unknown_billing_error';

export type PremiumBillingErrorCategory =
  | 'identity'
  | 'service'
  | 'canceled'
  | 'unknown';

const IDENTITY_CODES = new Set<PremiumBillingErrorCode>([
  'billing_auth_missing',
  'billing_identity_invalid',
  'missing_stripe_customer_id',
]);

const SERVICE_CODES = new Set<PremiumBillingErrorCode>([
  'missing_api_base_url',
  'billing_configuration_invalid',
  'billing_service_unavailable',
  'billing_browser_unavailable',
  'stripe_checkout_missing_url',
  'stripe_portal_missing_url',
  'stripe_payment_missing_client_secret',
  'payment_intent_unavailable',
  'invalid_checkout_url',
  'invalid_portal_url',
]);

export const getPremiumBillingErrorCode = (
  error: unknown,
): PremiumBillingErrorCode => {
  const raw =
    error instanceof Error
      ? String(error.message || '').trim()
      : String(error || '').trim();
  return (raw || 'unknown_billing_error') as PremiumBillingErrorCode;
};

export const getPremiumBillingErrorCategory = (
  error: unknown,
): PremiumBillingErrorCategory => {
  const code = getPremiumBillingErrorCode(error);
  if (code === 'premium_error_payment_canceled') return 'canceled';
  if (IDENTITY_CODES.has(code)) return 'identity';
  if (SERVICE_CODES.has(code)) return 'service';
  return 'unknown';
};

export const shouldOfferHostedBillingFallback = (error: unknown): boolean =>
  getPremiumBillingErrorCode(error) !== 'billing_service_unavailable';

