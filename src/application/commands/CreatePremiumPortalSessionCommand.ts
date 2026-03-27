import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const CreatePremiumPortalSessionCommand = {
  async execute(): Promise<{ url: string }> {
    return PremiumBillingApiAdapter.createPortalSession();
  },
};
