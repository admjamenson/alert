import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const CreatePremiumPaymentIntentCommand = {
  async execute(): Promise<{
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
    return PremiumBillingApiAdapter.createPaymentIntent();
  },
};
