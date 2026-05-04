import { BudgetGuard } from '../../application/cost/BudgetGuard';
import { CostRecord, FeatureKey, ProviderKey, UserTier } from '../../domain/cost/CostTypes';
import CostPolicy from '../../domain/cost/CostPolicy';
import { LocalCostLedger } from '../../infrastructure/cost/LocalCostLedger';
import { LocalUsageCounter } from '../../infrastructure/cost/LocalUsageCounter';

const ledger = new LocalCostLedger();
const usageCounter = new LocalUsageCounter();
const guard = new BudgetGuard({ ledger, usageCounter });

export const CostGuard = {
  async evaluate(params: {
    feature: FeatureKey;
    provider: ProviderKey;
    tier: UserTier;
    region?: string;
  }) {
    return guard.evaluate({
      ...params,
      estimatedCostUsd: CostPolicy.estimateCost(params.feature),
    });
  },

  async record(entry: CostRecord) {
    await guard.record(entry);
  },
};

export default CostGuard;
