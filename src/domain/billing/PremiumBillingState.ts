import { PremiumBillingAccount } from './PremiumBillingAccount';
import type { EntitlementSnapshot } from '../../services/EntitlementService';

export type PremiumBillingAuthority = 'backend_entitlement' | 'fallback_free';

export type PremiumBillingState = {
  account: PremiumBillingAccount;
  entitlement: EntitlementSnapshot | null;
  premium: boolean;
  authority: PremiumBillingAuthority;
  degraded: boolean;
  reasonCodes: string[];
  hasOperationalBillingState: boolean;
};

export const emptyPremiumBillingAccount = (): PremiumBillingAccount => ({
  userId: '',
  billing: null,
  customer: null,
  paymentMethod: null,
  invoices: [],
  portalAvailable: true,
  checkoutAvailable: true,
});

export const derivePremiumBillingState = ({
  account,
  entitlement,
  hasOperationalBillingState,
}: {
  account: PremiumBillingAccount | null;
  entitlement: EntitlementSnapshot | null;
  hasOperationalBillingState: boolean;
}): PremiumBillingState => {
  const resolvedAccount = account || emptyPremiumBillingAccount();
  const hasAuthoritativeEntitlement =
    entitlement?.source === 'network' || entitlement?.source === 'cache';
  const premium = hasAuthoritativeEntitlement
    ? Boolean(entitlement?.isPremium)
    : false;

  return {
    account: resolvedAccount,
    entitlement,
    premium,
    authority: hasAuthoritativeEntitlement
      ? 'backend_entitlement'
      : 'fallback_free',
    degraded:
      Boolean(entitlement?.degradedMode) ||
      !hasAuthoritativeEntitlement ||
      !hasOperationalBillingState,
    reasonCodes: Array.isArray(entitlement?.reasonCodes)
      ? entitlement.reasonCodes
      : [],
    hasOperationalBillingState,
  };
};
