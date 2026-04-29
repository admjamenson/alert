import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const GetPremiumBillingConfigQuery = {
  async execute(): Promise<
    Awaited<ReturnType<typeof PremiumBillingApiAdapter.getBillingConfig>>
  > {
    return PremiumBillingApiAdapter.getBillingConfig();
  },
};
