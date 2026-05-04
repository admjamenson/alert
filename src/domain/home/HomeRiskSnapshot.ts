import { AlertBrainBriefingReadModel } from '../trust/AlertBrainBriefing';
import { OperationalSnapshotReadModel } from '../trust/OperationalSnapshot';
import { AlertNotification } from '../../types/notifications';
import { EpidemicSnapshot } from '../../services/EpidemicService';

export type HomeSafetyState = 'ok' | 'warning' | 'critical';
export type HomeRiskNature = 'observed' | 'forecast';

export type HomeRankedRisk = {
  categoryId: string;
  nature: HomeRiskNature;
  score: number;
  title?: string;
  summary?: string;
  timestamp?: string;
};

export type HomeRiskSnapshotReadModel = {
  alerts: AlertNotification[];
  activeCategoryIds: Set<string>;
  pandemicSnapshot: EpidemicSnapshot | null;
  epidemicSnapshot: EpidemicSnapshot | null;
  briefing: AlertBrainBriefingReadModel;
  operational: OperationalSnapshotReadModel;
  prioritizedRisks: HomeRankedRisk[];
  safetyCTAState: HomeSafetyState;
  statusBarState: HomeSafetyState;
  hasUnavailableMonitoringData: boolean;
};
