import { FeatureKey } from './CostTypes';

export type UsageCounter = {
  increment: (feature: FeatureKey) => Promise<number>;
  getCount: (feature: FeatureKey) => Promise<number>;
};
