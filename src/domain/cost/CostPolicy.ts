import { CostClass, FeatureKey, ProviderKey, UserTier } from './CostTypes';

type FeatureCostSpec = {
  costClass: CostClass;
  estimatedCostUsd: number;
  usageCapPerHour: number;
  fallbackProvider?: ProviderKey;
};

const FEATURE_COSTS: Record<FeatureKey, FeatureCostSpec> = {
  'weather.current': {
    costClass: 'low',
    estimatedCostUsd: 0.0012,
    usageCapPerHour: 30,
    fallbackProvider: 'open-meteo-legacy',
  },
  'weather.alerts': {
    costClass: 'low',
    estimatedCostUsd: 0.0018,
    usageCapPerHour: 10,
    fallbackProvider: 'open-meteo',
  },
  'eventhub.monitoring': {
    costClass: 'medium',
    estimatedCostUsd: 0.006,
    usageCapPerHour: 6,
    fallbackProvider: 'eventhub-cache',
  },
};

const FREEMIUM_CAP_MONTHLY_USD = 0.2;
const FREEMIUM_TARGET_MONTHLY_USD = 0.15;
const PREMIUM_COST_RATIO_CAP = 0.3;

const containmentThreshold = (cap: number) => cap * 0.8;

export const CostPolicy = {
  getFeatureSpec(feature: FeatureKey): FeatureCostSpec {
    return (
      FEATURE_COSTS[feature] || {
        costClass: 'medium',
        estimatedCostUsd: 0.004,
        usageCapPerHour: 4,
        fallbackProvider: undefined,
      }
    );
  },

  estimateCost(feature: FeatureKey): number {
    return this.getFeatureSpec(feature).estimatedCostUsd;
  },

  usageCapPerHour(feature: FeatureKey): number {
    return this.getFeatureSpec(feature).usageCapPerHour;
  },

  fallbackProvider(feature: FeatureKey): ProviderKey | undefined {
    return this.getFeatureSpec(feature).fallbackProvider;
  },

  monthlyCapForTier(tier: UserTier): number {
    if (tier === 'premium') {
      return Math.max(FREEMIUM_CAP_MONTHLY_USD * 1.5, 0.3);
    }
    return FREEMIUM_CAP_MONTHLY_USD;
  },

  containmentThresholdForTier(tier: UserTier): number {
    return containmentThreshold(this.monthlyCapForTier(tier));
  },

  targetCostForTier(tier: UserTier): number {
    return tier === 'premium' ? FREEMIUM_TARGET_MONTHLY_USD * 1.5 : FREEMIUM_TARGET_MONTHLY_USD;
  },

  premiumCostRatioCap(): number {
    return PREMIUM_COST_RATIO_CAP;
  },
};

export default CostPolicy;
