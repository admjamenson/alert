import { OperationalSnapshotReadModel } from './OperationalSnapshot';
import { AlertSignalSource } from '../../types/alertIntelligence';

export type AlertBrainBriefingState = 'loading' | 'fresh' | 'stale' | 'error';

export type AlertBrainTrustStatus = 'online' | 'stale' | 'offline' | 'unavailable';

export type AlertBrainBriefingReadModel = {
  state: AlertBrainBriefingState;
  stale: boolean;
  headline: string;
  summary: string;
  action: string;
  bullets: string[];
  signalCount: number;
  severeSignalCount: number;
  sourceCount: number;
  trustStatus: AlertBrainTrustStatus;
  updatedAt?: string;
  sources: AlertSignalSource[];
  conflict: boolean;
  recommendedCategory?: string;
  operational: OperationalSnapshotReadModel;
  errorCode?: string;
};

export const createInitialAlertBrainBriefingReadModel =
  (): AlertBrainBriefingReadModel => ({
    state: 'loading',
    stale: true,
    headline: '',
    summary: '',
    action: '',
    bullets: [],
    signalCount: 0,
    severeSignalCount: 0,
    sourceCount: 0,
    trustStatus: 'unavailable',
    updatedAt: undefined,
    sources: [],
    conflict: false,
    recommendedCategory: undefined,
    operational: {
      snapshot: null,
      state: 'loading',
      stale: true,
      errorCode: 'initial',
    },
    errorCode: undefined,
  });
