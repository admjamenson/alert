import { EntitlementService } from '../../services/EntitlementService';
import {
  derivePremiumBillingState,
  PremiumBillingState,
} from '../../domain/billing/PremiumBillingState';
import { GetPremiumBillingAccountQuery } from './GetPremiumBillingAccountQuery';

export const GetPremiumBillingStateQuery = {
  async execute(options?: { forceRefresh?: boolean }): Promise<PremiumBillingState> {
    const [accountResult, entitlementResult] = await Promise.allSettled([
      GetPremiumBillingAccountQuery.execute(),
      EntitlementService.getEntitlements({
        forceRefresh: Boolean(options?.forceRefresh),
      }),
    ]);

    return derivePremiumBillingState({
      account:
        accountResult.status === 'fulfilled' ? accountResult.value : null,
      entitlement:
        entitlementResult.status === 'fulfilled'
          ? entitlementResult.value
          : null,
      hasOperationalBillingState: accountResult.status === 'fulfilled',
    });
  },
};

