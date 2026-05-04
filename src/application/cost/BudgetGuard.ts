import { BudgetDecision, CostRecord, CostWindow, FeatureKey, ProviderKey, UserTier } from '../../domain/cost/CostTypes';
import CostPolicy from '../../domain/cost/CostPolicy';
import { CostLedger, emptyCostWindow } from '../../domain/cost/CostLedger';
import { UsageCounter } from '../../domain/cost/UsageCounter';

type BudgetGuardDeps = {
  ledger: CostLedger;
  usageCounter: UsageCounter;
};

export type BudgetGuardInput = {
  feature: FeatureKey;
  provider: ProviderKey;
  tier: UserTier;
  region?: string;
  estimatedCostUsd: number;
};

export class BudgetGuard {
  private ledger: CostLedger;
  private usageCounter: UsageCounter;

  constructor(deps: BudgetGuardDeps) {
    this.ledger = deps.ledger;
    this.usageCounter = deps.usageCounter;
  }

  async evaluate(input: BudgetGuardInput): Promise<BudgetDecision> {
    const cap = CostPolicy.monthlyCapForTier(input.tier);
    const containment = CostPolicy.containmentThresholdForTier(input.tier);
    const rolling = await this.ledger.getRollingCost(30, input.tier);
    const total = rolling?.totalUsd ?? 0;
    const predicted = total + input.estimatedCostUsd;
    const usageCount = await this.usageCounter.getCount(input.feature);
    const capPerHour = CostPolicy.usageCapPerHour(input.feature);

    if (usageCount >= capPerHour) {
      return { allow: false, mode: 'blocked', reason: 'usage_cap', cacheTtlMultiplier: 4 };
    }

    if (predicted >= cap) {
      return { allow: false, mode: 'blocked', reason: 'budget_exceeded', cacheTtlMultiplier: 6 };
    }

    if (predicted >= containment) {
      return { allow: true, mode: 'containment', reason: 'budget_containment', cacheTtlMultiplier: 4 };
    }

    return { allow: true, mode: 'normal', reason: 'budget_ok', cacheTtlMultiplier: 1 };
  }

  async record(entry: CostRecord): Promise<void> {
    await this.usageCounter.increment(entry.feature);
    await this.ledger.record(entry);
  }

  static emptyRolling(): CostWindow {
    return emptyCostWindow();
  }
}
