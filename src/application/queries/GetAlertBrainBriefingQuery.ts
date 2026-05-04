import AlertIntelligenceService from '../../services/AlertIntelligenceService';
import {
  AlertSignal,
  AlertSignalFreshness,
  AlertSignalSource,
} from '../../types/alertIntelligence';
import {
  AlertBrainBriefingReadModel,
  AlertBrainTrustStatus,
  createInitialAlertBrainBriefingReadModel,
} from '../../domain/trust/AlertBrainBriefing';
import { GetOperationalSnapshotQuery } from './GetOperationalSnapshotQuery';
import { OperationalSnapshotReadModel } from '../../domain/trust/OperationalSnapshot';

type ExecuteParams = {
  latitude?: number | null;
  longitude?: number | null;
  locale: string;
  timeZone?: string;
  category?: string;
  scope?: 'CITY' | 'STATE' | 'COUNTRY';
  force?: boolean;
  operational?: OperationalSnapshotReadModel;
};

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const severityRank: Record<AlertSignal['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const trustStatusFromFreshness = (
  freshness: AlertSignalFreshness,
): AlertBrainTrustStatus => {
  if (freshness === 'FRESH') return 'online';
  if (freshness === 'STALE') return 'stale';
  return 'unavailable';
};

const getRecommendedCategory = (signals: AlertSignal[]): string | undefined => {
  const sorted = [...signals].sort((left, right) => {
    const severityDiff = severityRank[right.severity] - severityRank[left.severity];
    if (severityDiff !== 0) return severityDiff;
    const freshnessDiff =
      Date.parse(String(right.timestamp || '')) -
      Date.parse(String(left.timestamp || ''));
    if (freshnessDiff !== 0) return freshnessDiff;
    return Number(right.confidence || 0) - Number(left.confidence || 0);
  });
  return sorted[0]?.category;
};

const buildFallbackReadModel = (
  operational: OperationalSnapshotReadModel,
  errorCode?: string,
): AlertBrainBriefingReadModel => {
  const base = createInitialAlertBrainBriefingReadModel();
  return {
    ...base,
    state:
      operational.state === 'error' && !operational.snapshot
        ? 'error'
        : operational.state === 'stale'
          ? 'stale'
          : operational.state === 'loading'
            ? 'loading'
            : 'fresh',
    stale: operational.stale,
    operational,
    errorCode: errorCode || operational.errorCode,
  };
};

export const createOperationalFallbackBriefing = (
  operational: OperationalSnapshotReadModel,
  errorCode?: string,
): AlertBrainBriefingReadModel =>
  buildFallbackReadModel(operational, errorCode);

export const GetAlertBrainBriefingQuery = {
  async execute(params: ExecuteParams): Promise<AlertBrainBriefingReadModel> {
    const operationalPromise = params.operational
      ? Promise.resolve(params.operational)
      : GetOperationalSnapshotQuery.execute({
          latitude: params.latitude,
          longitude: params.longitude,
          force: params.force,
        });

    if (!isFiniteCoord(params.latitude) || !isFiniteCoord(params.longitude)) {
      const operational = await operationalPromise;
      return buildFallbackReadModel(
        operational,
        operational.errorCode || 'location_unavailable',
      );
    }

    try {
      const [operational, signals] = await Promise.all([
        operationalPromise,
        AlertIntelligenceService.fetchRealtimeSignals({
          latitude: params.latitude,
          longitude: params.longitude,
          locale: params.locale,
          timeZone: params.timeZone || 'UTC',
          category: params.category,
          scope: params.scope || 'CITY',
          force: params.force,
        }),
      ]);

      const normalizedSignals = Array.isArray(signals) ? signals : [];
      const aiSummary = AlertIntelligenceService.summarizeForUser(
        normalizedSignals,
        params.locale,
      );
      const trustBundle = AlertIntelligenceService.getTrustBundle(normalizedSignals);
      const bullets = Array.isArray(aiSummary.bullets) ? aiSummary.bullets : [];
      const severeSignalCount = normalizedSignals.filter(
        signal => signal.severity === 'high' || signal.severity === 'critical',
      ).length;
      const summary = bullets[0] || aiSummary.action || aiSummary.headline || '';
      const stale =
        operational.stale ||
        operational.state === 'stale' ||
        (normalizedSignals.length > 0 && trustBundle.status === 'STALE');
      const state =
        operational.state === 'error' && !operational.snapshot && normalizedSignals.length === 0
          ? 'error'
          : stale
            ? 'stale'
            : 'fresh';
      const sources: AlertSignalSource[] = Array.isArray(trustBundle.sources)
        ? trustBundle.sources
        : [];

      return {
        state,
        stale,
        headline: aiSummary.headline || '',
        summary,
        action: aiSummary.action || '',
        bullets,
        signalCount: normalizedSignals.length,
        severeSignalCount,
        sourceCount: sources.length,
        trustStatus:
          normalizedSignals.length > 0
            ? trustStatusFromFreshness(trustBundle.status)
            : operational.stale
              ? 'stale'
              : operational.state === 'error'
                ? 'offline'
                : 'unavailable',
        updatedAt: trustBundle.updatedAt || operational.snapshot?.updatedAt,
        sources,
        conflict: Boolean(trustBundle.conflict),
        recommendedCategory: getRecommendedCategory(normalizedSignals),
        operational,
        errorCode: operational.errorCode,
      };
    } catch (error) {
      const operational = await operationalPromise;
      return buildFallbackReadModel(
        operational,
        typeof (error as any)?.message === 'string'
          ? (error as any).message
          : operational.errorCode || 'alert_brain_fetch_failed',
      );
    }
  },
};
