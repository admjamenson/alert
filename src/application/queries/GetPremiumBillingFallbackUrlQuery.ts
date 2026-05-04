import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const GetPremiumBillingFallbackUrlQuery = {
  async checkout(): Promise<string | null> {
    return PremiumBillingApiAdapter.getCheckoutFallbackUrl();
  },

  async portal(): Promise<string | null> {
    return PremiumBillingApiAdapter.getPortalFallbackUrl();
  },
};

