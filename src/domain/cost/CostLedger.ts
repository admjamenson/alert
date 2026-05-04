import { CostRecord, CostWindow, UserTier } from './CostTypes';

export type CostLedgerSnapshot = {
  version: number;
  days: Record<string, CostWindow>;
};

export type CostLedger = {
  record: (entry: CostRecord) => Promise<void>;
  getRollingCost: (days: number, tier?: UserTier) => Promise<CostWindow>;
};

export const emptyCostWindow = (): CostWindow => ({
  totalUsd: 0,
  byFeature: {},
  byProvider: {},
  byTier: { free: 0, premium: 0 },
});
