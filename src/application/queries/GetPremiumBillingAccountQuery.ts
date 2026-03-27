import { PremiumBillingAccount } from '../../domain/billing/PremiumBillingAccount';
import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const GetPremiumBillingAccountQuery = {
  async execute(): Promise<PremiumBillingAccount> {
    return PremiumBillingApiAdapter.getBillingAccount();
  },
};
