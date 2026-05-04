import { GetEpidemicFeedQuery } from './GetEpidemicFeedQuery';
import { AlertIntelligenceService } from '../../services/AlertIntelligenceService';
import { EventHubService, HealthTopItem } from '../../services/EventHubService';
import { MonitoringService } from '../../services/MonitoringService';
import { RiskReportService } from '../../services/RiskReportService';
import {
  AlertAiSummary,
  AlertSignal,
  AlertTrustMeta,
} from '../../types/alertIntelligence';

const isEpidemicType = (type: string) => type === 'pandemic' || type === 'epidemic';
const toEpidemicMode = (type: string): 'pandemic' | 'epidemic' =>
  type === 'pandemic' ? 'pandemic' : 'epidemic';

export const GetMonitoringFeedSignalsQuery = {
  async execute(params: {
    latitude: number | null;
    longitude: number | null;
    itemType: string;
    locale: string;
    timeZone: string;
    scope: 'CITY' | 'STATE' | 'COUNTRY';
    aiCategory: string;
    alertAiEnabled: boolean;
    force?: boolean;
  }): Promise<{
    reports: Awaited<ReturnType<typeof RiskReportService.getAll>>;
    monitoring: Awaited<ReturnType<typeof MonitoringService.getActiveEvents>> | null;
    snapshot: Awaited<ReturnType<typeof GetEpidemicFeedQuery.execute>> | null;
    pandemicTop3: HealthTopItem[];
    aiSignals: AlertSignal[];
    aiSummary: AlertAiSummary;
    aiTrustMeta: AlertTrustMeta;
  }> {
    if (
      typeof params.latitude !== 'number' ||
      !Number.isFinite(params.latitude) ||
      typeof params.longitude !== 'number' ||
      !Number.isFinite(params.longitude)
    ) {
      return {
        reports: [],
        monitoring: null,
        snapshot: null,
        pandemicTop3: [],
        aiSignals: [],
        aiSummary: { headline: '' },
        aiTrustMeta: {
          status: 'UNKNOWN',
          updatedAt: undefined,
          sources: [],
          evidencePack: {
            evidenceLinks: [],
            evidenceCount: 0,
          },
          conflict: false,
        },
      };
    }

    const [reports, monitoring, snapshot, pandemicTop3, aiSignals] =
      await Promise.all([
        RiskReportService.getAll(),
        params.itemType === 'sos_nearby' || isEpidemicType(params.itemType)
          ? Promise.resolve(null)
          : MonitoringService.getActiveEvents(
              params.latitude,
              params.longitude,
              0.55,
            ),
        isEpidemicType(params.itemType)
          ? GetEpidemicFeedQuery.execute({
              latitude: params.latitude,
              longitude: params.longitude,
              mode: toEpidemicMode(params.itemType),
              window: 'all',
              force: params.force,
            })
          : Promise.resolve(null),
        params.itemType === 'pandemic'
          ? EventHubService.getHealthTopByLocation({
              latitude: params.latitude,
              longitude: params.longitude,
              radiusKm: 45,
            }).catch(() => [] as HealthTopItem[])
          : Promise.resolve([] as HealthTopItem[]),
        params.alertAiEnabled
          ? AlertIntelligenceService.fetchRealtimeSignals({
              latitude: params.latitude,
              longitude: params.longitude,
              locale: params.locale,
              timeZone: params.timeZone,
              category: params.aiCategory,
              scope: params.scope,
              force: params.force,
            })
          : Promise.resolve([] as AlertSignal[]),
      ]);

    const aiSignalsNormalized = Array.isArray(aiSignals) ? aiSignals : [];
    const aiSummary = AlertIntelligenceService.summarizeForUser(
      aiSignalsNormalized,
      params.locale,
    );
    const aiTrustMeta = AlertIntelligenceService.getTrustMeta(
      aiSignalsNormalized,
    );

    return {
      reports,
      monitoring,
      snapshot,
      pandemicTop3,
      aiSignals: aiSignalsNormalized,
      aiSummary,
      aiTrustMeta,
    };
  },
};
