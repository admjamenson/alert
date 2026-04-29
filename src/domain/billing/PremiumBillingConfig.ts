export type PremiumBillingOfferInterval = 'day' | 'week' | 'month' | 'year';

export interface PremiumBillingMarket {
  countryCode?: string | null;
  currency?: string | null;
  locale?: string | null;
  cityName?: string | null;
  marketTier?: string | null;
  marketKey?: string | null;
  priorityCity?: string | null;
}

export interface PremiumBillingOffer {
  available: boolean;
  reasonCode?: string | null;
  source?: string | null;
  priceId?: string | null;
  productId?: string | null;
  productName?: string | null;
  productDescription?: string | null;
  unitAmount?: number | null;
  currency?: string | null;
  interval?: PremiumBillingOfferInterval | null;
  intervalCount?: number | null;
  livemode?: boolean;
}

export interface PremiumBillingConfig {
  publishableKey: string;
  appUrl: string;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  priceId: string;
  priceSelection?: string | null;
  market?: PremiumBillingMarket | null;
  checkoutLocale?: string | null;
  automaticTaxEnabled?: boolean;
  billingAddressCollection?: string | null;
  taxIdCollectionEnabled?: boolean;
  queryAuthAllowed?: boolean;
  offer: PremiumBillingOffer;
}

export interface PremiumPaymentConfirmation {
  ok: boolean;
  livemode?: boolean;
  paymentIntentId: string;
  paymentIntentStatus?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  customerId?: string | null;
  priceId?: string | null;
  premiumActive: boolean;
  currentPeriodEnd?: string | null;
  sourceEvent?: string | null;
}
