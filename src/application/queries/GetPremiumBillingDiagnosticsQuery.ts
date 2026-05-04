import { PremiumBillingApiAdapter } from '../../infrastructure/adapters/PremiumBillingApiAdapter';

export const GetPremiumBillingDiagnosticsQuery = {
  execute(): ReturnType<typeof PremiumBillingApiAdapter.getDiagnostics> {
    return PremiumBillingApiAdapter.getDiagnostics();
  },
};
