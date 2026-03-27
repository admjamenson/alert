import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const CreatePremiumCheckoutSessionCommand = {
  async execute(): Promise<{ url: string; sessionId?: string }> {
    return PremiumBillingApiAdapter.createCheckoutSession();
  },
};
