export type CostClass = 'free' | 'low' | 'medium' | 'high';
export type UserTier = 'free' | 'premium';
export type FeatureKey = string;
export type ProviderKey = string;

export type CostRecord = {
  feature: FeatureKey;
  provider: ProviderKey;
  tier: UserTier;
  region?: string;
  costUsd: number;
  ts: number;
  cacheHit?: boolean;
};

export type CostWindow = {
  totalUsd: number;
  byFeature: Record<string, number>;
  byProvider: Record<string, number>;
  byTier: Record<UserTier, number>;
};

export type BudgetMode = 'normal' | 'containment' | 'blocked';

export type BudgetDecision = {
  allow: boolean;
  mode: BudgetMode;
  reason: string;
  cacheTtlMultiplier: number;
};
