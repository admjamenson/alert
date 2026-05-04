import { GetAlertBrainBriefingQuery } from './GetAlertBrainBriefingQuery';
import { GetOperationalSnapshotQuery } from './GetOperationalSnapshotQuery';
import { GetEpidemicFeedQuery } from './GetEpidemicFeedQuery';
import {
  HomeRankedRisk,
  HomeRiskSnapshotReadModel,
  HomeSafetyState,
} from '../../domain/home/HomeRiskSnapshot';
import { NotificationService } from '../../services/NotificationService';
import { RouteDestinationService } from '../../services/RouteDestinationService';
import { ImportantAlertsService } from '../../services/ImportantAlertsService';
import { MonitoringService } from '../../services/MonitoringService';
import { mapAlertToCategory } from '../../services/importantAlertUtils';
import {
  inferRiskFromEpidemicSnapshot,
  inferRiskNatureFromAlert,
  priorityScore,
  riskScoreFromAlert,
} from '../../services/risk/RiskInferenceService';
import type { AlertNotification } from '../../types/notifications';
import type { EpidemicSnapshot } from '../../services/EpidemicService';
import type { OperationalSnapshotReadModel } from '../../domain/trust/OperationalSnapshot';
import { createOperationalFallbackBriefing } from './GetAlertBrainBriefingQuery';

type ExecuteParams = {
  latitude: number | null;
  longitude: number | null;
  riskScore: number;
  clientRiskLevel: 'low' | 'medium' | 'high';
  locale: string;
  timeZone?: string;
  force?: boolean;
  includeBriefing?: boolean;
  t: (key: string, options?: any) => string;
};

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeToFeedCategory = (category: string): string =>
  category === 'sos' ? 'sos_nearby' : category;

const getSafetyStateFromRisks = (risks: HomeRankedRisk[]): HomeSafetyState => {
  if (risks.some(item => item.nature === 'observed' && item.score >= 0.72)) {
    return 'critical';
  }
  if (risks.some(item => item.nature === 'forecast' && item.score >= 0.52)) {
    return 'warning';
  }
  return 'ok';
};

const buildRankedRisks = (
  alerts: AlertNotification[],
  activeCategoryIds: Set<string>,
  pandemicSnapshot: EpidemicSnapshot | null | undefined,
  epidemicSnapshot: EpidemicSnapshot | null | undefined,
): HomeRankedRisk[] => {
  const byCategory = new Map<string, HomeRankedRisk>();
  const upsertRisk = (risk: HomeRankedRisk) => {
    const existing = byCategory.get(risk.categoryId);
    if (!existing || risk.score > existing.score) {
      byCategory.set(risk.categoryId, risk);
    }
  };

  alerts.forEach(alert => {
    const rawCategory = mapAlertToCategory(alert);
    const categoryId = normalizeToFeedCategory(rawCategory);
    if (!categoryId) return;
    if (
      categoryId !== 'sos_nearby' &&
      activeCategoryIds.size > 0 &&
      !activeCategoryIds.has(rawCategory)
    ) {
      return;
    }

    const nature = inferRiskNatureFromAlert(alert);
    if (nature === 'none') return;

    const computedPriority = priorityScore({
      nature,
      riskScore: riskScoreFromAlert(alert),
      timestamp: alert.timestamp,
      distanceKm: categoryId === 'sos_nearby' ? 0 : undefined,
    });

    upsertRisk({
      categoryId,
      nature,
      score: computedPriority,
      title: alert.title,
      summary: alert.summary,
      timestamp: alert.timestamp,
    });
  });

  const pandemic = inferRiskFromEpidemicSnapshot(pandemicSnapshot, 'municipal');
  if (pandemic.nature !== 'none') {
    upsertRisk({
      categoryId: 'pandemic',
      nature: pandemic.nature,
      score: pandemic.priorityScore,
      title: 'Pandemia',
      summary: pandemicSnapshot?.message,
      timestamp: pandemicSnapshot?.asOf || pandemicSnapshot?.fetchedAt,
    });
  }

  const epidemic = inferRiskFromEpidemicSnapshot(epidemicSnapshot, 'municipal');
  if (epidemic.nature !== 'none') {
    upsertRisk({
      categoryId: 'epidemic',
      nature: epidemic.nature,
      score: epidemic.priorityScore,
      title: 'Epidemia',
      summary: epidemicSnapshot?.message,
      timestamp: epidemicSnapshot?.asOf || epidemicSnapshot?.fetchedAt,
    });
  }

  return Array.from(byCategory.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Date.parse(b.timestamp || '') - Date.parse(a.timestamp || '');
  });
};

const deriveSafetyStates = (
  operational: OperationalSnapshotReadModel,
  prioritizedRisks: HomeRankedRisk[],
  clientRiskLevel: 'low' | 'medium' | 'high',
): { safetyCTAState: HomeSafetyState; statusBarState: HomeSafetyState } => {
  const operationalRisk = operational.snapshot?.riskLevel;
  const backendAvailable = operational.state !== 'error';

  const safetyCTAState: HomeSafetyState =
    operationalRisk === 'high'
      ? 'critical'
      : operationalRisk === 'medium'
        ? 'warning'
        : operationalRisk === 'low' && backendAvailable
          ? 'ok'
          : getSafetyStateFromRisks(prioritizedRisks);

  const statusBarState: HomeSafetyState =
    operationalRisk === 'high'
      ? 'critical'
      : operationalRisk === 'medium'
        ? 'warning'
        : operationalRisk === 'low'
          ? 'ok'
          : clientRiskLevel === 'high'
            ? 'critical'
            : clientRiskLevel === 'medium'
              ? 'warning'
              : 'ok';

  return { safetyCTAState, statusBarState };
};

const buildReadModel = (params: {
  alerts: AlertNotification[];
  activeCategoryIds: Set<string>;
  pandemicSnapshot: EpidemicSnapshot | null;
  epidemicSnapshot: EpidemicSnapshot | null;
  briefing: HomeRiskSnapshotReadModel['briefing'];
  operational: OperationalSnapshotReadModel;
  hasUnavailableMonitoringData: boolean;
  clientRiskLevel: 'low' | 'medium' | 'high';
}): HomeRiskSnapshotReadModel => {
  const prioritizedRisks = buildRankedRisks(
    params.alerts,
    params.activeCategoryIds,
    params.pandemicSnapshot,
    params.epidemicSnapshot,
  );
  const safetyStates = deriveSafetyStates(
    params.operational,
    prioritizedRisks,
    params.clientRiskLevel,
  );

  return {
    alerts: params.alerts,
    activeCategoryIds: params.activeCategoryIds,
    pandemicSnapshot: params.pandemicSnapshot,
    epidemicSnapshot: params.epidemicSnapshot,
    briefing: params.briefing,
    operational: params.operational,
    prioritizedRisks,
    ...safetyStates,
    hasUnavailableMonitoringData: params.hasUnavailableMonitoringData,
  };
};

export const GetHomeRiskSnapshotQuery = {
  async execute(params: ExecuteParams): Promise<HomeRiskSnapshotReadModel> {
    const shouldIncludeBriefing = params.includeBriefing !== false;

    if (!isFiniteCoord(params.latitude) || !isFiniteCoord(params.longitude)) {
      const operationalPromise = GetOperationalSnapshotQuery.execute({
        latitude: null,
        longitude: null,
        force: params.force,
      });
      const briefing = shouldIncludeBriefing
        ? await operationalPromise.then(operational =>
            GetAlertBrainBriefingQuery.execute({
              latitude: null,
              longitude: null,
              locale: params.locale,
              timeZone: params.timeZone,
              force: params.force,
              operational,
            }),
          )
        : await operationalPromise.then(operational =>
            createOperationalFallbackBriefing(
              operational,
              operational.errorCode || 'home_briefing_deferred',
            ),
          );
      return buildReadModel({
        alerts: [],
        activeCategoryIds: new Set<string>(),
        pandemicSnapshot: null,
        epidemicSnapshot: null,
        briefing,
        operational: briefing.operational,
        clientRiskLevel: params.clientRiskLevel,
        hasUnavailableMonitoringData: true,
      });
    }

    const safeLat = Number(params.latitude);
    const safeLon = Number(params.longitude);
    const operationalPromise = GetOperationalSnapshotQuery.execute({
      latitude: safeLat,
      longitude: safeLon,
      force: params.force,
    });
    const briefingPromise = shouldIncludeBriefing
      ? operationalPromise.then(operational =>
          GetAlertBrainBriefingQuery.execute({
            latitude: safeLat,
            longitude: safeLon,
            locale: params.locale,
            timeZone: params.timeZone,
            force: params.force,
            operational,
          }),
        )
      : operationalPromise.then(operational =>
          createOperationalFallbackBriefing(
            operational,
            operational.errorCode || 'home_briefing_deferred',
          ),
        );

    const [
      activeMonitoring,
      activeSos,
      targetLocation,
      pandemicSnapshot,
      epidemicSnapshot,
      briefing,
    ] = await Promise.all([
      MonitoringService.getActiveEvents(safeLat, safeLon, params.riskScore).catch(
        () => null,
      ),
      NotificationService.getActiveSos().catch(() => null),
      RouteDestinationService.getDefaultDestination().catch(() => null),
      GetEpidemicFeedQuery.execute({
        latitude: safeLat,
        longitude: safeLon,
        mode: 'pandemic',
        window: '7d',
        force: params.force,
      }).catch(() => null),
      GetEpidemicFeedQuery.execute({
        latitude: safeLat,
        longitude: safeLon,
        mode: 'epidemic',
        window: '7d',
        force: params.force,
      }).catch(() => null),
      briefingPromise,
    ]);

    const externalAlerts = activeMonitoring?.alerts || [];
    const alerts = activeSos
      ? [
          {
            id: 'sos-active',
            type: 'sos',
            title: params.t('home_sos_nearby_title'),
            summary: params.t('home_sos_nearby_summary', {
              name: activeSos.senderName,
            }),
            timestamp: new Date().toISOString(),
            data: activeSos,
          },
          ...externalAlerts,
        ]
      : externalAlerts;

    await ImportantAlertsService.ingestAlerts(alerts, {
      currentLocation: { latitude: safeLat, longitude: safeLon },
      targetLocation: targetLocation
        ? {
            latitude: targetLocation.latitude,
            longitude: targetLocation.longitude,
          }
        : null,
    }).catch(() => {
      // Fail-soft: important alert indexing cannot block the home snapshot.
    });

    return buildReadModel({
      alerts,
      activeCategoryIds: activeMonitoring?.activeIds || new Set<string>(),
      pandemicSnapshot,
      epidemicSnapshot,
      briefing,
      operational: briefing.operational,
      clientRiskLevel: params.clientRiskLevel,
      hasUnavailableMonitoringData:
        Boolean(activeMonitoring?.unavailableIds?.size) || false,
    });
  },
};
