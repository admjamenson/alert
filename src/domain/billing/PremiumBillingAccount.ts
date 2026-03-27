export interface PremiumBillingStatus {
  premium_active?: boolean;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  billing_currency?: string | null;
  billing_country_code?: string | null;
  billing_city_name?: string | null;
  current_period_end?: string | null;
}

export interface PremiumCustomer {
  id?: string | null;
  email?: string | null;
}

export interface PremiumPaymentMethod {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
}

export interface PremiumInvoice {
  id: string;
  number?: string | null;
  status?: string | null;
  createdAt?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
}

export interface PremiumBillingAccount {
  userId: string;
  billing: PremiumBillingStatus | null;
  customer: PremiumCustomer | null;
  paymentMethod: PremiumPaymentMethod | null;
  invoices: PremiumInvoice[];
  portalAvailable: boolean;
  checkoutAvailable: boolean;
}
