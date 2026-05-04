import {
  derivePremiumBillingState,
  emptyPremiumBillingAccount,
} from '../src/domain/billing/PremiumBillingState';
import type { EntitlementSnapshot } from '../src/services/EntitlementService';

const entitlement = (
  overrides: Partial<EntitlementSnapshot> = {},
): EntitlementSnapshot => ({
  userId: 'user-1',
  plan: 'free',
  isPremium: false,
  premium: false,
  featureFlags: {
    starlinkConnectEnabled: false,
    starlinkTunnelBetaEnabled: false,
    starlinkExclusiveEnabled: false,
  },
  limits: {
    monitoring: {
      maxRadiusKm: 35,
      maxItems: 90,
      refreshFloorSec: 60,
    },
    epidemic: {
      maxWindow: '7d',
    },
    weather: {
      minRefreshSec: 120,
    },
  },
  costGates: {
    realtimeRiskFeed: true,
    extendedMonitoring: false,
    epidemicAllWindow: false,
    highFrequencyPolling: false,
  },
  degradedMode: false,
  reasonCodes: [],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  source: 'network',
  ...overrides,
});

describe('derivePremiumBillingState', () => {
  it('uses backend entitlement as the premium authority', () => {
    const state = derivePremiumBillingState({
      account: {
        ...emptyPremiumBillingAccount(),
        billing: { premium_active: false },
      },
      entitlement: entitlement({
        plan: 'premium',
        isPremium: true,
        premium: true,
      }),
      hasOperationalBillingState: true,
    });

    expect(state.premium).toBe(true);
    expect(state.authority).toBe('backend_entitlement');
    expect(state.degraded).toBe(false);
  });

  it('fails closed when only local billing account suggests premium', () => {
    const state = derivePremiumBillingState({
      account: {
        ...emptyPremiumBillingAccount(),
        billing: { premium_active: true },
      },
      entitlement: entitlement({
        isPremium: false,
        premium: false,
        source: 'fallback',
        degradedMode: true,
      }),
      hasOperationalBillingState: true,
    });

    expect(state.premium).toBe(false);
    expect(state.authority).toBe('fallback_free');
    expect(state.degraded).toBe(true);
  });
});
