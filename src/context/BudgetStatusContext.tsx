import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { BudgetMode, UserTier } from '../domain/cost/CostTypes';
import { BudgetGuard } from '../application/cost/BudgetGuard';
import LocalCostLedger from '../infrastructure/cost/LocalCostLedger';
import { LocalUsageCounter } from '../infrastructure/cost/LocalUsageCounter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordOperationalMetric } from '../observability/OperationalMetrics';

/**
 * BUDGET STATUS CONTEXT
 * Provides real-time visibility into the current cost-gating state.
 * Allows UI components to show "Stale Data" indicators when in containment/blocked mode.
 */

interface BudgetStatusContextData {
  budgetMode: BudgetMode;
  isUsingCache: boolean;
  refreshStatus: () => Promise<void>;
}

export const BudgetStatusContext = createContext<BudgetStatusContextData>(
  {} as BudgetStatusContextData,
);

const ledger = new LocalCostLedger();
const usageCounter = new LocalUsageCounter();
const guard = new BudgetGuard({ ledger, usageCounter });

export const BudgetStatusProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('normal');

  const refreshStatus = useCallback(async () => {
    const startedAt = Date.now();
    try {
      // 1. Identify current user tier
      const isPremium = await AsyncStorage.getItem('@Alert:IsPremium');
      const tier: UserTier = isPremium === 'true' ? 'premium' : 'free';

      // 2. Evaluate a representative feature for global budget state
      // We use monitoring signals as the proxy for application-wide containment
      const decision = await guard.evaluate({
        feature: 'eventhub.monitoring',
        provider: 'generic',
        tier,
        estimatedCostUsd: 0.0001,
      });

      setBudgetMode(decision.mode);
      recordOperationalMetric('budget_probe_ms', Date.now() - startedAt, {
        mode: decision.mode,
        tier,
      });
    } catch (error) {
      console.error('[BudgetStatusContext] Failed to probe budget status:', error);
      setBudgetMode('normal');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let delayId: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      delayId = setTimeout(() => {
        if (!cancelled) {
          void refreshStatus();
        }
      }, 1200);
    });
    // Re-check periodically to sync UI with rolling cost windows
    const interval = setInterval(refreshStatus, 3 * 60 * 1000); // 3 mins
    return () => {
      cancelled = true;
      if (typeof task.cancel === 'function') {
        task.cancel();
      }
      if (delayId) {
        clearTimeout(delayId);
      }
      clearInterval(interval);
    };
  }, [refreshStatus]);

  const value = {
    budgetMode,
    isUsingCache: budgetMode !== 'normal',
    refreshStatus,
  };

  return (
    <BudgetStatusContext.Provider value={value}>
      {children}
    </BudgetStatusContext.Provider>
  );
};

export const useBudgetStatus = () => {
  const context = useContext(BudgetStatusContext);
  if (!context) {
    throw new Error('useBudgetStatus must be used within BudgetStatusProvider');
  }
  return context;
};
