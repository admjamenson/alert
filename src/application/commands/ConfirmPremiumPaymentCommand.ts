import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const ConfirmPremiumPaymentCommand = {
  async execute(options: {
    paymentIntentId: string;
    subscriptionId?: string | null;
  }): Promise<
    Awaited<ReturnType<typeof PremiumBillingApiAdapter.confirmPaymentIntent>>
  > {
    return PremiumBillingApiAdapter.confirmPaymentIntent(options);
  },
};
