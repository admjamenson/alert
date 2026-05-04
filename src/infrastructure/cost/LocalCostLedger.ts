import AsyncStorage from '@react-native-async-storage/async-storage';
import { CostLedger, CostLedgerSnapshot, emptyCostWindow } from '../../domain/cost/CostLedger';
import { CostRecord, CostWindow, UserTier } from '../../domain/cost/CostTypes';
import { TelemetryService } from '../../services/TelemetryService';

const COST_LEDGER_KEY = '@Alert:CostLedgerV1';
const MAX_DAYS = 35;

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const sanitizeWindow = (value?: CostWindow | null): CostWindow => {
  if (!value) return emptyCostWindow();
  return {
    totalUsd: Number(value.totalUsd) || 0,
    byFeature: value.byFeature || {},
    byProvider: value.byProvider || {},
    byTier: value.byTier || { free: 0, premium: 0 },
  };
};

const loadSnapshot = async (): Promise<CostLedgerSnapshot> => {
  try {
    const raw = await AsyncStorage.getItem(COST_LEDGER_KEY);
    if (!raw) return { version: 1, days: {} };
    const parsed = JSON.parse(raw) as CostLedgerSnapshot;
    if (!parsed || typeof parsed !== 'object') return { version: 1, days: {} };
    return {
      version: 1,
      days: parsed.days || {},
    };
  } catch {
    return { version: 1, days: {} };
  }
};

const persistSnapshot = async (snapshot: CostLedgerSnapshot) => {
  try {
    await AsyncStorage.setItem(COST_LEDGER_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore persistence errors
  }
};

const pruneDays = (snapshot: CostLedgerSnapshot): CostLedgerSnapshot => {
  const keys = Object.keys(snapshot.days).sort().slice(-MAX_DAYS);
  const next: CostLedgerSnapshot = { version: snapshot.version, days: {} };
  keys.forEach(key => {
    next.days[key] = snapshot.days[key];
  });
  return next;
};

export class LocalCostLedger implements CostLedger {
  async record(entry: CostRecord): Promise<void> {
    const snapshot = await loadSnapshot();
    const key = dayKey(entry.ts);
    const window = sanitizeWindow(snapshot.days[key]);
    window.totalUsd += entry.costUsd;
    window.byFeature[entry.feature] = (window.byFeature[entry.feature] || 0) + entry.costUsd;
    window.byProvider[entry.provider] = (window.byProvider[entry.provider] || 0) + entry.costUsd;
    window.byTier[entry.tier] = (window.byTier[entry.tier] || 0) + entry.costUsd;
    snapshot.days[key] = window;

    TelemetryService.trackEvent('cost_recorded', {
      feature: entry.feature,
      provider: entry.provider,
      costUsd: entry.costUsd,
      tier: entry.tier,
      region: entry.region,
      cacheHit: Boolean(entry.cacheHit),
    });

    await persistSnapshot(pruneDays(snapshot));
  }

  async getRollingCost(days: number, tier?: UserTier): Promise<CostWindow> {
    const snapshot = await loadSnapshot();
    const keys = Object.keys(snapshot.days).sort().slice(-Math.max(1, days));
    const window: CostWindow = emptyCostWindow();
    keys.forEach(key => {
      const day = sanitizeWindow(snapshot.days[key]);
      window.totalUsd += day.totalUsd;
      Object.entries(day.byFeature).forEach(([feature, cost]) => {
        window.byFeature[feature] = (window.byFeature[feature] || 0) + Number(cost || 0);
      });
      Object.entries(day.byProvider).forEach(([provider, cost]) => {
        window.byProvider[provider] = (window.byProvider[provider] || 0) + Number(cost || 0);
      });
      Object.entries(day.byTier).forEach(([tierKey, cost]) => {
        const normalized = tierKey === 'premium' ? 'premium' : 'free';
        window.byTier[normalized] = (window.byTier[normalized] || 0) + Number(cost || 0);
      });
    });

    if (tier) {
      return {
        ...window,
        totalUsd: window.byTier[tier] || 0,
      };
    }
    return window;
  }
}

export default LocalCostLedger;
