import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../../i18n';
import { GetAlertBrainBriefingQuery } from '../../application/queries/GetAlertBrainBriefingQuery';
import { GetOperationalSnapshotQuery } from '../../application/queries/GetOperationalSnapshotQuery';
import { AlertBrainBriefingReadModel } from '../../domain/trust/AlertBrainBriefing';
import {
  OperationalSnapshot,
  OperationalSnapshotReadModel,
  getOperationalScoreLevel,
} from '../../domain/trust/OperationalSnapshot';
import { EventHubService, riskLevelFromCap } from '../../services/EventHubService';
import { MonitoringService } from '../../services/MonitoringService';
import { NotificationService } from '../../services/NotificationService';
import { RiskReportService } from '../../services/RiskReportService';
import { RouteService } from '../../services/RouteService';
import { RouteDestinationService } from '../../services/RouteDestinationService';
import { WeatherService } from '../../services/WeatherService';
import { WidgetConfidence } from '../domain/WidgetConfidence';
import { WidgetPreset, WIDGET_PRESETS } from '../domain/WidgetPreset';
import { WidgetMeterTier, WidgetSnapshot, WidgetStatusBadge, WidgetStatusTone } from '../domain/WidgetSnapshot';
import { AlertNotification } from '../../types/notifications';
import { RiskReport } from '../../services/RiskReportService';

const LAST_LOCATION_KEY = '@Alert:LastLocation';
const TOTAL_MONITORED_SITUATIONS = 34;

const TTL_BY_PRESET: Record<WidgetPreset, number> = {
  risk_now: 5 * 60_000,
  commute: 10 * 60_000,
  city_pulse: 15 * 60_000,
  alerts_ticker: 10 * 60_000,
};

type LastLocation = {
  latitude?: number;
  longitude?: number;
};

type CacheEntry = {
  snapshot: WidgetSnapshot;
  expiresAt: number;
};

type LocalOperationalSignals = {
  level: number;
  confidence: WidgetConfidence;
  sourceLabel: string;
  updatedAt: string;
  freshnessLabel: string;
  signalCount: number;
  sourceKind: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
  statusBadge: WidgetStatusBadge;
  readModelState: OperationalSnapshotReadModel['state'];
  snapshot: OperationalSnapshot;
};

type RouteCorridorSignals = {
  level: number;
  eventCount: number;
  maxRisk: number;
};

type CanonicalWidgetAssessment = {
  level: number;
  confidence: WidgetConfidence;
  sourceLabel: string;
  updatedAt: string;
  sourceKind: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
  statusBadge: WidgetStatusBadge;
  readModelState: OperationalSnapshotReadModel['state'];
  snapshot: OperationalSnapshot;
  briefing: AlertBrainBriefingReadModel;
};

type SharedRiskContext = {
  location: { latitude: number; longitude: number } | null;
  briefing: AlertBrainBriefingReadModel | null;
  assessment: CanonicalWidgetAssessment | null;
};

const memoryCache = new Map<WidgetPreset, CacheEntry>();

const parseJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildCompactCommuteMetric = (minutes: number) => {
  const safeMinutes = Math.max(1, Math.round(Number(minutes || 0)));
  if (safeMinutes >= 60) {
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    if (remainder <= 0) {
      return `${hours}h`;
    }
    return `${hours}h${String(remainder).padStart(2, '0')}`;
  }
  return `${safeMinutes}m`;
};

const getLabelForConfidence = (confidence: WidgetConfidence) =>
  i18n.t(`widget_confidence_${confidence}`, {
    defaultValue:
      confidence === 'high'
        ? 'High'
        : confidence === 'medium'
          ? 'Medium'
          : 'Low',
  });

const buildUpdatedLabel = (updatedAt: string) => {
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) {
    return i18n.t('widget_updated_now', { defaultValue: 'Updated now' });
  }
  const deltaMin = Math.max(1, Math.floor((Date.now() - parsed) / 60_000));
  if (deltaMin <= 1) {
    return i18n.t('widget_updated_now', { defaultValue: 'Updated now' });
  }
  return i18n.t('widget_updated_minutes_ago', {
    count: deltaMin,
    defaultValue: `Updated ${deltaMin}m ago`,
  });
};

const statusLabelForTone = (tone: WidgetStatusTone) =>
  i18n.t(`widget_alerts_status_${tone === 'moderate' ? 'moderate' : tone}`, {
    defaultValue:
      tone === 'high'
        ? 'Avoid the area'
        : tone === 'moderate'
          ? 'Risk nearby'
          : tone === 'attention'
            ? 'Attention nearby'
            : 'No alerts',
  });

const normalizeThreatText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const buildAlertsTickerHeadline = (params: {
  notifications: AlertNotification[];
  riskReports: RiskReport[];
  statusBadge: WidgetStatusBadge;
  operational: OperationalSnapshotReadModel | null;
}): string => {
  const candidates: string[] = [];
  params.notifications.forEach(item => {
    if (item.title) candidates.push(item.title);
    if (item.summary) candidates.push(item.summary);
  });

  for (const rawCandidate of candidates) {
    const candidate = normalizeThreatText(rawCandidate);
    if (!candidate) continue;

    if (
      candidate.includes('shoot') ||
      candidate.includes('gun') ||
      candidate.includes('tiroteio') ||
      candidate.includes('disparo')
    ) {
      return i18n.t('widget_alerts_focus_shooting', { defaultValue: 'Tiroteio próximo' });
    }
    if (
      candidate.includes('protest') ||
      candidate.includes('riot') ||
      candidate.includes('manifest') ||
      candidate.includes('protesto')
    ) {
      return i18n.t('widget_alerts_focus_protest', { defaultValue: 'Protesto ativo' });
    }
    if (
      candidate.includes('landslide') ||
      candidate.includes('desliz')
    ) {
      return i18n.t('widget_alerts_focus_landslide', { defaultValue: 'Risco deslizamento' });
    }
    if (
      candidate.includes('flood') ||
      candidate.includes('alag') ||
      candidate.includes('inunda')
    ) {
      return i18n.t('widget_alerts_focus_flood', { defaultValue: 'Risco inundação' });
    }
    if (
      candidate.includes('rain') ||
      candidate.includes('chuva')
    ) {
      return i18n.t('widget_alerts_focus_heavy_rain', { defaultValue: 'Chuva forte' });
    }
    if (
      candidate.includes('storm') ||
      candidate.includes('tempest') ||
      candidate.includes('hurricane') ||
      candidate.includes('furacao') ||
      candidate.includes('vendaval')
    ) {
      return i18n.t('widget_alerts_focus_storm', { defaultValue: 'Tempestade severa' });
    }
    if (
      candidate.includes('fire') ||
      candidate.includes('incend')
    ) {
      return i18n.t('widget_alerts_focus_fire', { defaultValue: 'Incêndio próximo' });
    }
    if (
      candidate.includes('earthquake') ||
      candidate.includes('quake') ||
      candidate.includes('terremoto') ||
      candidate.includes('tremor') ||
      candidate.includes('seismic')
    ) {
      return i18n.t('widget_alerts_focus_quake', { defaultValue: 'Tremor próximo' });
    }
    if (
      candidate.includes('tsunami') ||
      candidate.includes('maremoto') ||
      candidate.includes('coast')
    ) {
      return i18n.t('widget_alerts_focus_coastal', { defaultValue: 'Risco costeiro' });
    }
    if (
      candidate.includes('robbery') ||
      candidate.includes('assalto') ||
      candidate.includes('roubo')
    ) {
      return i18n.t('widget_alerts_focus_robbery', { defaultValue: 'Assalto próximo' });
    }
    if (
      candidate.includes('metro') ||
      candidate.includes('transit') ||
      candidate.includes('onibus') ||
      candidate.includes('bus') ||
      candidate.includes('train')
    ) {
      return i18n.t('widget_alerts_focus_transit', { defaultValue: 'Trânsito crítico' });
    }
  }

  if (params.riskReports.length > 0) {
    return i18n.t('widget_alerts_focus_sos', { defaultValue: 'SOS próximo' });
  }

  if (params.operational?.snapshot?.riskLevel === 'high' || params.statusBadge.tone === 'high') {
    return i18n.t('widget_alerts_focus_local_risk', { defaultValue: 'Risco local' });
  }

  if (params.statusBadge.tone === 'attention' || params.statusBadge.tone === 'moderate') {
    return i18n.t('widget_alerts_focus_local_attention', { defaultValue: 'Atenção local' });
  }

  return i18n.t('widget_alerts_focus_clear', { defaultValue: 'Sem alertas' });
};

const getCurrentLocation = async () => {
  const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
  const parsed = parseJson<LastLocation>(raw);
  const latitude = Number(parsed?.latitude);
  const longitude = Number(parsed?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const pickConfidenceFromEventCount = (count: number): WidgetConfidence => {
  if (count >= 4) return 'high';
  if (count >= 1) return 'medium';
  return 'low';
};

const pickTierFromLevel = (level: number): WidgetMeterTier => {
  if (level >= 70) return 'high';
  if (level >= 42) return 'medium';
  return 'low';
};

const confidenceFromOperational = (confidence: number): WidgetConfidence => {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.58) return 'medium';
  return 'low';
};

const trustBadgeLabel = (snapshot: OperationalSnapshot): string => {
  if (snapshot.trustBadge === 'official') {
    return i18n.t('badge_official', { defaultValue: 'Official' });
  }
  if (snapshot.trustBadge === 'verified') {
    return i18n.t('badge_verified', { defaultValue: 'Verified' });
  }
  if (snapshot.trustBadge === 'reference') {
    return i18n.t('badge_reference', { defaultValue: 'Reference' });
  }
  return i18n.t('operational_trust_limited', { defaultValue: 'Limited' });
};

const sourceKindFromTrustBadge = (
  snapshot: OperationalSnapshot,
): 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' => {
  if (snapshot.trustBadge === 'official') return 'OFFICIAL';
  if (snapshot.trustBadge === 'verified') return 'VERIFIED';
  return 'REFERENCE';
};

const operationalStateLabel = (state: OperationalSnapshotReadModel['state']): string => {
  if (state === 'fresh') {
    return i18n.t('operational_state_fresh', { defaultValue: 'Fresh' });
  }
  if (state === 'stale') {
    return i18n.t('operational_state_stale', { defaultValue: 'Stale' });
  }
  if (state === 'loading') {
    return i18n.t('operational_state_loading', { defaultValue: 'Loading' });
  }
  return i18n.t('operational_state_error', { defaultValue: 'Error' });
};

const riskLevelLabel = (snapshot: OperationalSnapshot): string =>
  i18n.t(`operational_risk_${snapshot.riskLevel}`, {
    defaultValue:
      snapshot.riskLevel === 'high'
        ? 'High risk'
        : snapshot.riskLevel === 'medium'
          ? 'Moderate risk'
          : 'Low risk',
  });

const freshnessLabelFromSnapshot = (snapshot: OperationalSnapshot): string => {
  const freshnessSec = Math.max(0, Math.round(Number(snapshot.freshnessSec || 0)));
  const freshnessMin = Math.round(freshnessSec / 60);
  if (freshnessMin <= 1) {
    return i18n.t('operational_freshness_now', { defaultValue: 'Updated now' });
  }
  return i18n.t('operational_freshness_minutes', {
    count: freshnessMin,
    defaultValue: `Updated ${freshnessMin} min ago`,
  });
};

const ensureLevel = (level: number) => clamp(Math.round(level), 0, 100);

const fallbackSituationScore = (activeSituationCount: number, sourceCount = 0, base = 18) => {
  const safeActiveCount = Math.max(0, Math.round(Number(activeSituationCount || 0)));
  const coverageRatio = safeActiveCount / TOTAL_MONITORED_SITUATIONS;
  return ensureLevel(base + coverageRatio * 40 + safeActiveCount * 7 + Math.min(sourceCount, 4) * 2);
};

const buildStatusBadge = (params: {
  level: number;
  readModelState?: OperationalSnapshotReadModel['state'];
}): WidgetStatusBadge => {
  const isReliable = !params.readModelState || params.readModelState === 'fresh';
  let tone: WidgetStatusTone = 'normal';

  if (params.level >= 70) {
    tone = 'high';
  } else if (params.level >= 42) {
    tone = 'moderate';
  } else if (!isReliable) {
    tone = 'attention';
  }

  return {
    tone,
    label: statusLabelForTone(tone),
  };
};

const buildOperationalSignals = (
  operational: OperationalSnapshotReadModel | null,
): LocalOperationalSignals | null => {
  if (!operational?.snapshot) return null;
  const snapshot = operational.snapshot;
  const level = ensureLevel(getOperationalScoreLevel(snapshot));
  const signalCount =
    typeof snapshot.exposedSituationCount === 'number'
      ? Math.max(0, Math.round(snapshot.exposedSituationCount))
      : Math.max(0, Math.round(snapshot.activeSituationCount || 0));
  return {
    level,
    confidence: confidenceFromOperational(snapshot.confidence),
    sourceLabel: trustBadgeLabel(snapshot),
    updatedAt: snapshot.updatedAt,
    freshnessLabel: freshnessLabelFromSnapshot(snapshot),
    signalCount,
    sourceKind: sourceKindFromTrustBadge(snapshot),
    readModelState: operational.state,
    snapshot,
    statusBadge: buildStatusBadge({
      level,
      readModelState: operational.state,
    }),
  };
};

const sourceKindFromBriefing = (
  briefing: AlertBrainBriefingReadModel,
  fallback: LocalOperationalSignals,
): 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' => {
  if (briefing.sources.some(source => source.officiality === 'OFFICIAL')) return 'OFFICIAL';
  if (briefing.sources.some(source => source.officiality === 'VERIFIED')) return 'VERIFIED';
  return fallback.sourceKind;
};

const sourceLabelFromBriefing = (
  briefing: AlertBrainBriefingReadModel,
  fallback: LocalOperationalSignals,
): string => {
  if (briefing.sources.some(source => source.officiality === 'OFFICIAL')) {
    return i18n.t('badge_official', { defaultValue: 'Official' });
  }
  if (briefing.sources.some(source => source.officiality === 'VERIFIED')) {
    return i18n.t('badge_verified', { defaultValue: 'Verified' });
  }
  return fallback.sourceLabel;
};

const buildCanonicalWidgetAssessment = (
  briefing: AlertBrainBriefingReadModel | null,
): CanonicalWidgetAssessment | null => {
  if (!briefing?.operational?.snapshot) return null;

  const operationalSignals = buildOperationalSignals(briefing.operational);
  if (!operationalSignals) return null;

  const baseLevel = operationalSignals.level;
  const signalCount = Math.max(0, Number(briefing.signalCount || 0));
  const severeSignalCount = Math.max(0, Number(briefing.severeSignalCount || 0));
  const sourceCount = Math.max(0, Number(briefing.sourceCount || 0));
  const isOnline = briefing.trustStatus === 'online';
  const isStale = briefing.trustStatus === 'stale';

  let boost = 0;
  if (isOnline) {
    boost += severeSignalCount >= 3 ? 12 : severeSignalCount === 2 ? 8 : severeSignalCount === 1 ? 5 : 0;
    boost += signalCount >= 6 ? 4 : signalCount >= 3 ? 2 : 0;
    boost += sourceCount >= 4 ? 4 : sourceCount >= 2 ? 2 : 0;
    if (briefing.conflict) {
      // Safety-first: conflicting credible sources should not lower vigilance.
      boost += 3;
    }
  } else if (isStale) {
    boost += severeSignalCount >= 2 ? 4 : severeSignalCount === 1 ? 2 : 0;
  }

  const level = ensureLevel(Math.max(baseLevel, baseLevel + boost));
  return {
    level,
    confidence: operationalSignals.confidence,
    sourceLabel: sourceLabelFromBriefing(briefing, operationalSignals),
    updatedAt: briefing.updatedAt || operationalSignals.updatedAt,
    sourceKind: sourceKindFromBriefing(briefing, operationalSignals),
    statusBadge: buildStatusBadge({
      level,
      readModelState: operationalSignals.readModelState,
    }),
    readModelState: operationalSignals.readModelState,
    snapshot: operationalSignals.snapshot,
    briefing,
  };
};

const pickRouteSampleCoords = (
  line: Array<[number, number]>,
  maxSamples = 5,
): Array<{ latitude: number; longitude: number }> => {
  if (!Array.isArray(line) || line.length === 0) return [];
  if (line.length <= maxSamples) {
    return line
      .filter(item => Array.isArray(item) && item.length >= 2)
      .map(item => ({ longitude: Number(item[0]), latitude: Number(item[1]) }))
      .filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  }

  const indexes = new Set<number>();
  for (let i = 0; i < maxSamples; i += 1) {
    const idx = Math.round((i * (line.length - 1)) / Math.max(1, maxSamples - 1));
    indexes.add(idx);
  }

  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map(index => line[index])
    .filter(item => Array.isArray(item) && item.length >= 2)
    .map(item => ({ longitude: Number(item[0]), latitude: Number(item[1]) }))
    .filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
};

const buildRouteCorridorSignals = async (
  line: Array<[number, number]>,
): Promise<RouteCorridorSignals | null> => {
  const sampleCoords = pickRouteSampleCoords(line, 5);
  if (sampleCoords.length === 0) return null;

  const responses = await Promise.all(
    sampleCoords.map(point =>
      EventHubService.getEventsByLocation({
        latitude: point.latitude,
        longitude: point.longitude,
        radiusKm: 1,
        limit: 80,
        sosPublicOptIn: false,
      }).catch(() => null),
    ),
  );

  const eventRiskById = new Map<string, number>();
  responses.forEach(response => {
    const unifiedEvents = Array.isArray(response?.unifiedEvents) ? response!.unifiedEvents : [];
    unifiedEvents.forEach(event => {
      const risk = riskLevelFromCap(event.severity, event.urgency, event.certainty);
      const prev = eventRiskById.get(event.id) || 0;
      if (risk > prev) {
        eventRiskById.set(event.id, risk);
      }
    });
  });

  const eventCount = eventRiskById.size;
  if (eventCount === 0) {
    return {
      level: 24,
      eventCount: 0,
      maxRisk: 0,
    };
  }

  let maxRisk = 0;
  eventRiskById.forEach(value => {
    maxRisk = Math.max(maxRisk, value);
  });

  const base =
    maxRisk >= 4 ? 84 : maxRisk >= 3 ? 74 : maxRisk >= 2 ? 52 : maxRisk >= 1 ? 40 : 24;
  const level = ensureLevel(base + Math.min(14, Math.max(0, eventCount - 1) * 4));

  return {
    level,
    eventCount,
    maxRisk,
  };
};

const buildFallbackSnapshot = (
  preset: WidgetPreset,
  options?: {
    deeplink?: string;
    titleKey?: string;
  },
): WidgetSnapshot => {
  const updatedAt = new Date().toISOString();
  const confidence: WidgetConfidence = 'low';
  const level = 32;
  return {
    preset,
    title: i18n.t(options?.titleKey || `widget_preset_${preset}`, { defaultValue: 'Alert' }),
    subtitle:
      preset === 'alerts_ticker'
        ? i18n.t('widget_alerts_status_attention', {
            defaultValue: 'Attention nearby',
          })
        : i18n.t('widget_state_snapshot_verified_short', {
            defaultValue: 'Latest verified snapshot',
          }),
    metric: '--',
    confidence,
    updatedAt,
    deeplink: options?.deeplink || 'alertapp://home',
    chips: [getLabelForConfidence(confidence), buildUpdatedLabel(updatedAt)],
    sourceKind: 'REFERENCE',
    sourceName: 'Alert',
    statusBadge: buildStatusBadge({
      level,
      readModelState: 'loading',
    }),
    visual: {
      level,
      meterTier: pickTierFromLevel(level),
      segmentProfile: [28, 32, 36, 30, 26],
      iconKey:
        preset === 'commute'
          ? 'commute'
          : preset === 'city_pulse'
            ? 'city'
            : preset === 'alerts_ticker'
              ? 'ticker'
              : 'risk',
    },
  };
};

export interface IWidgetDataSourcesAdapter {
  composeAll(options?: { force?: boolean }): Promise<WidgetSnapshot[]>;
}

export class WidgetDataComposer implements IWidgetDataSourcesAdapter {
  private async loadSharedRiskContext(force?: boolean): Promise<SharedRiskContext> {
    const location = await getCurrentLocation();
    if (!location) {
      return {
        location: null,
        briefing: null,
        assessment: null,
      };
    }

    const briefing = await GetAlertBrainBriefingQuery.execute({
      latitude: location.latitude,
      longitude: location.longitude,
      locale: i18n.resolvedLanguage || i18n.language || 'pt-BR',
      force,
    }).catch(() => null);

    return {
      location,
      briefing,
      assessment: buildCanonicalWidgetAssessment(briefing),
    };
  }

  private getCachedSnapshot(preset: WidgetPreset, force?: boolean): WidgetSnapshot | null {
    if (force) return null;
    const cached = memoryCache.get(preset);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) return null;
    return cached.snapshot;
  }

  private setCachedSnapshot(snapshot: WidgetSnapshot) {
    memoryCache.set(snapshot.preset, {
      snapshot,
      expiresAt: Date.now() + TTL_BY_PRESET[snapshot.preset],
    });
  }

  private async composeRiskNowSnapshot(shared?: SharedRiskContext): Promise<WidgetSnapshot> {
    const location = shared?.location || (await getCurrentLocation());
    if (!location) {
      const fallback = {
        ...buildFallbackSnapshot('risk_now', { deeplink: 'alertapp://home' }),
        subtitle: i18n.t('widget_state_limited_coverage', {
          defaultValue: 'Limited coverage in this area',
        }),
      };
      fallback.visual = {
        ...fallback.visual,
        level: 38,
        meterTier: 'low',
        segmentProfile: [34, 40, 36, 30, 26],
        iconKey: 'risk',
      };
      return fallback;
    }

    if (shared?.assessment) {
      const snapshot = shared.assessment.snapshot;
      return {
        preset: 'risk_now',
        title: i18n.t('widget_preset_risk_now', { defaultValue: 'Status' }),
        subtitle: i18n.t('widget_operational_subtitle', {
          risk: riskLevelLabel(snapshot),
          state: operationalStateLabel(shared.assessment.readModelState),
          defaultValue: '{{risk}} - {{state}}',
        }),
        metric: String(shared.assessment.level),
        confidence: shared.assessment.confidence,
        updatedAt: shared.assessment.updatedAt,
        deeplink: 'alertapp://monitoring',
        chips: [
          shared.assessment.sourceLabel,
          i18n.t('operational_sources_count', {
            count: snapshot.sourceCount,
            defaultValue: `Sources: ${snapshot.sourceCount}`,
          }),
          freshnessLabelFromSnapshot(snapshot),
        ].slice(0, 2),
        sourceKind: shared.assessment.sourceKind,
        sourceName: shared.assessment.sourceLabel,
        readModelState: shared.assessment.readModelState,
        statusBadge: shared.assessment.statusBadge,
        visual: {
          level: shared.assessment.level,
          meterTier: pickTierFromLevel(shared.assessment.level),
          segmentProfile: [
            ensureLevel(shared.assessment.level - 16),
            ensureLevel(shared.assessment.level - 6),
            shared.assessment.level,
            ensureLevel(shared.assessment.level - 4),
            ensureLevel(shared.assessment.level - 12),
          ],
          iconKey: 'risk',
        },
      };
    }

    const operational = await GetOperationalSnapshotQuery.execute({
      latitude: location.latitude,
      longitude: location.longitude,
    }).catch(() => null);

    const operationalSignals = buildOperationalSignals(operational);
    if (operationalSignals) {
      const snapshot = operationalSignals.snapshot;
      return {
        preset: 'risk_now',
        title: i18n.t('widget_preset_risk_now', { defaultValue: 'Status' }),
        subtitle: i18n.t('widget_operational_subtitle', {
          risk: riskLevelLabel(snapshot),
          state: operationalStateLabel(operationalSignals.readModelState),
          defaultValue: '{{risk}} - {{state}}',
        }),
        metric: String(operationalSignals.level),
        confidence: operationalSignals.confidence,
        updatedAt: operationalSignals.updatedAt,
        deeplink: 'alertapp://monitoring',
        chips: [
          operationalSignals.sourceLabel,
          i18n.t('operational_sources_count', {
            count: snapshot.sourceCount,
            defaultValue: `Sources: ${snapshot.sourceCount}`,
          }),
          operationalSignals.freshnessLabel,
        ].slice(0, 2),
        sourceKind: operationalSignals.sourceKind,
        sourceName: operationalSignals.sourceLabel,
        readModelState: operationalSignals.readModelState,
        statusBadge: operationalSignals.statusBadge,
        visual: {
          level: operationalSignals.level,
          meterTier: pickTierFromLevel(operationalSignals.level),
          segmentProfile: [
            ensureLevel(operationalSignals.level - 16),
            ensureLevel(operationalSignals.level - 6),
            operationalSignals.level,
            ensureLevel(operationalSignals.level - 4),
            ensureLevel(operationalSignals.level - 12),
          ],
          iconKey: 'risk',
        },
      };
    }

    const [weather, monitoring] = await Promise.all([
      WeatherService.getCurrentWeather(location.latitude, location.longitude).catch(() => null),
      MonitoringService.getActiveEvents(location.latitude, location.longitude, 0.55).catch(() => null),
    ]);

    const activeCount = monitoring?.activeIds?.size || 0;
    const sourceCount = Object.keys(monitoring?.sourceMetaByEventId || {}).length;
    const confidence = pickConfidenceFromEventCount(activeCount);
    const updatedAt = weather?.timestamp || new Date().toISOString();
    const score = fallbackSituationScore(activeCount, sourceCount, 18);
    const statusBadge = buildStatusBadge({
      level: score,
      readModelState: 'stale',
    });

    return {
      preset: 'risk_now',
      title: i18n.t('widget_preset_risk_now', { defaultValue: 'Status' }),
      subtitle:
        activeCount > 0
          ? i18n.t('widget_risk_now_subtitle_active', {
              count: activeCount,
              defaultValue: '{{count}} active signals in your area',
            })
          : i18n.t('widget_state_snapshot_verified_short', {
              defaultValue: 'Latest verified snapshot',
            }),
      metric: String(score),
      confidence,
      updatedAt,
      deeplink: 'alertapp://monitoring',
      chips: [
        getLabelForConfidence(confidence),
        i18n.t('widget_sources_count', {
          count: sourceCount,
          defaultValue: `Sources: ${sourceCount}`,
        }),
      ],
      sourceKind: confidence === 'high' ? 'OFFICIAL' : 'VERIFIED',
      sourceName: i18n.t('widget_source_mixed', { defaultValue: 'Official + verified' }),
      readModelState: 'stale',
      statusBadge,
      visual: {
        level: score,
        meterTier: pickTierFromLevel(score),
        segmentProfile: [
          ensureLevel(score - 18),
          ensureLevel(score - 8),
          score,
          ensureLevel(score - 4),
          ensureLevel(score - 14),
        ],
        iconKey: 'risk',
      },
    };
  }

  private async composeCommuteSnapshot(): Promise<WidgetSnapshot> {
    const [location, destination] = await Promise.all([
      getCurrentLocation(),
      RouteDestinationService.getDefaultDestination(),
    ]);

    if (!location || !destination) {
      const fallback = {
        ...buildFallbackSnapshot('commute', { deeplink: 'alertapp://route-settings' }),
        subtitle: i18n.t('widget_state_limited_coverage', {
          defaultValue: 'Limited coverage in this area',
        }),
      };
      fallback.visual = {
        ...fallback.visual,
        level: 44,
        meterTier: 'medium',
        segmentProfile: [38, 44, 52, 48, 42],
        iconKey: 'commute',
      };
      return fallback;
    }

    const [route, monitoring] = await Promise.all([
      RouteService.getRouteDetails(
        {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
        destination.transportMode || 'car',
      ).catch(() => null),
      MonitoringService.getActiveEvents(location.latitude, location.longitude, 0.5).catch(() => null),
    ]);

    const updatedAt = new Date().toISOString();
    const baseMin = Math.max(1, Number(route?.durationMin || 0) || 0);
    const routeCorridorSignals = await buildRouteCorridorSignals(route?.line || []).catch(() => null);
    const fallbackActiveCount = monitoring?.activeIds?.size || 0;
    const corridorLevel =
      routeCorridorSignals?.level || ensureLevel(28 + fallbackActiveCount * 10);
    const corridorEventCount = routeCorridorSignals?.eventCount || fallbackActiveCount;
    const routeRiskLevel =
      corridorLevel >= 70 ? 'high' : corridorLevel >= 42 ? 'medium' : 'low';
    const confidence: WidgetConfidence = baseMin > 0 ? 'high' : 'medium';
    const destinationLabel = destination.label || i18n.t('widget_destination_default', { defaultValue: 'Work' });
    const statusBadge = buildStatusBadge({
      level: corridorLevel,
      readModelState: 'fresh',
    });

    return {
      preset: 'commute',
      title: i18n.t('widget_preset_commute', { defaultValue: 'Route' }),
      subtitle: i18n.t('widget_commute_subtitle_line', {
        destination: destinationLabel,
        defaultValue: destinationLabel,
      }),
      metric:
        baseMin > 0
          ? buildCompactCommuteMetric(baseMin)
          : '--',
      confidence,
      updatedAt,
      deeplink: 'alertapp://route-settings',
      chips: [getLabelForConfidence(confidence), buildUpdatedLabel(updatedAt)],
      sourceKind: 'VERIFIED',
      sourceName: i18n.t('widget_source_routes', { defaultValue: 'Route model' }),
      statusBadge,
      visual: {
        level: corridorLevel,
        meterTier: pickTierFromLevel(corridorLevel),
        segmentProfile: [
          ensureLevel(corridorLevel - 12),
          ensureLevel(corridorLevel - 2),
          corridorLevel,
          ensureLevel(corridorLevel - 8),
          ensureLevel(corridorLevel - 15),
        ],
        iconKey: 'commute',
      },
    };
  }

  private async composeCityPulseSnapshot(shared?: SharedRiskContext): Promise<WidgetSnapshot> {
    const location = shared?.location || (await getCurrentLocation());
    if (!location) {
      const fallback = {
        ...buildFallbackSnapshot('city_pulse', { deeplink: 'alertapp://monitoring' }),
        subtitle: i18n.t('widget_state_limited_coverage', {
          defaultValue: 'Limited coverage in this area',
        }),
      };
      fallback.visual = {
        ...fallback.visual,
        level: 42,
        meterTier: 'medium',
        segmentProfile: [34, 45, 52, 46, 40],
        iconKey: 'city',
      };
      return fallback;
    }

    const [monitoring, operational] = await Promise.all([
      MonitoringService.getActiveEvents(location.latitude, location.longitude, 0.45).catch(() => null),
      shared?.briefing
        ? Promise.resolve(shared.briefing.operational)
        : GetOperationalSnapshotQuery.execute({
            latitude: location.latitude,
            longitude: location.longitude,
          }).catch(() => null),
    ]);
    const activeCount = monitoring?.activeIds?.size || 0;
    const operationalSignals = shared?.assessment || buildOperationalSignals(operational);
    const operationalSituationCount = operationalSignals?.snapshot?.activeSituationCount;
    const operationalExposedSituationCount =
      'signalCount' in (operationalSignals || {}) ? (operationalSignals as LocalOperationalSignals).signalCount : operationalSignals?.snapshot?.exposedSituationCount;
    const metricSituationCount =
      typeof operationalExposedSituationCount === 'number' &&
      Number.isFinite(operationalExposedSituationCount)
        ? Math.max(0, Math.round(operationalExposedSituationCount))
        : typeof operationalSituationCount === 'number' && Number.isFinite(operationalSituationCount)
          ? Math.max(0, Math.round(operationalSituationCount))
        : activeCount;
    const topSummary = Object.values(monitoring?.summaries || {})[0];
    const confidence = operationalSignals
      ? operationalSignals.confidence
      : pickConfidenceFromEventCount(activeCount);
    const updatedAt = operationalSignals?.updatedAt || new Date().toISOString();
    const level = operationalSignals
      ? operationalSignals.level
      : ensureLevel(28 + activeCount * 15);
    const statusBadge = operationalSignals?.statusBadge || buildStatusBadge({
      level,
      readModelState: operational?.state,
    });

    return {
      preset: 'city_pulse',
      title: i18n.t('widget_preset_city_pulse', { defaultValue: 'Local status' }),
      subtitle:
        metricSituationCount > 0
          ? topSummary || statusBadge.label
          : statusBadge.label,
      metric: i18n.t('widget_city_pulse_metric', {
        count: metricSituationCount,
        defaultValue: `${metricSituationCount}`,
      }),
      confidence,
      updatedAt,
      deeplink: 'alertapp://monitoring',
      chips: [
        i18n.t('widget_alerts_count', {
          count: metricSituationCount,
          defaultValue: `${metricSituationCount} alerts`,
        }),
        getLabelForConfidence(confidence),
      ],
      sourceKind: operationalSignals
        ? operationalSignals.sourceKind
        : confidence === 'high'
          ? 'OFFICIAL'
          : 'VERIFIED',
      sourceName: operationalSignals
        ? operationalSignals.sourceLabel
        : i18n.t('widget_source_city', { defaultValue: 'City feeds' }),
      readModelState: operationalSignals?.readModelState || operational?.state,
      statusBadge,
      visual: {
        level,
        meterTier: pickTierFromLevel(level),
        segmentProfile: [
          ensureLevel(level - 8),
          level,
          ensureLevel(level - 5),
          ensureLevel(level - 14),
          ensureLevel(level - 20),
        ],
        iconKey: 'city',
      },
    };
  }

  private async composeAlertsTickerSnapshot(
    shared?: SharedRiskContext,
    riskReference?: WidgetSnapshot,
  ): Promise<WidgetSnapshot> {
    const location = shared?.location || (await getCurrentLocation());
    const [notifications, riskReports, operational] = await Promise.all([
      NotificationService.getAll().catch(() => []),
      RiskReportService.getAll().catch(() => []),
      shared?.briefing
        ? Promise.resolve(shared.briefing.operational)
        : location
        ? GetOperationalSnapshotQuery.execute({
            latitude: location.latitude,
            longitude: location.longitude,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const operationalSignals = shared?.assessment || buildOperationalSignals(operational);
    const referenceLevel =
      typeof riskReference?.visual?.level === 'number'
        ? ensureLevel(riskReference.visual.level)
        : typeof riskReference?.metric === 'string'
          ? ensureLevel(Number(String(riskReference.metric).replace(/[^\d]/g, '')) || 0)
          : null;
    const updatedAt =
      operationalSignals?.updatedAt ||
      operational?.snapshot?.updatedAt ||
      riskReference?.updatedAt ||
      new Date().toISOString();
    const top = notifications.slice(0, 2).map(item => item.title).filter(Boolean);
    const extraCount = Math.max(0, notifications.length - top.length);
    const confidence: WidgetConfidence =
      operationalSignals?.confidence ||
      riskReference?.confidence ||
      (notifications.length > 0 ? 'medium' : riskReports.length > 0 ? 'medium' : 'low');
    const level =
      operationalSignals?.level ??
      referenceLevel ??
      ensureLevel(20 + notifications.length * 14 + riskReports.length * 6);
    const statusBadge =
      operationalSignals?.statusBadge ||
      riskReference?.statusBadge ||
      buildStatusBadge({
        level,
        readModelState: operational?.state,
      });
    const headline = buildAlertsTickerHeadline({
      notifications,
      riskReports,
      statusBadge,
      operational: shared?.briefing?.operational || operational,
    });

    return {
      preset: 'alerts_ticker',
      title: i18n.t('widget_preset_alerts_ticker', { defaultValue: 'Alerts Ticker' }),
      subtitle: headline,
      metric: String(level),
      confidence,
      updatedAt,
      deeplink: 'alertapp://notifications',
      chips: [
        top[1] || buildUpdatedLabel(updatedAt),
        extraCount > 0
          ? i18n.t('widget_more_count', {
              count: extraCount,
              defaultValue: `+${extraCount}`,
            })
          : getLabelForConfidence(confidence),
      ],
      sourceKind: operationalSignals
        ? operationalSignals.sourceKind
        : riskReference?.sourceKind || 'REFERENCE',
      sourceName: operationalSignals
        ? operationalSignals.sourceLabel
        : riskReference?.sourceName ||
          i18n.t('widget_source_alert_center', { defaultValue: 'Alert center' }),
      readModelState:
        operationalSignals?.readModelState || riskReference?.readModelState || operational?.state,
      statusBadge,
      visual: {
        level,
        meterTier: pickTierFromLevel(level),
        segmentProfile: [
          ensureLevel(level - 10),
          ensureLevel(level + 3),
          ensureLevel(level - 4),
          ensureLevel(level - 15),
          ensureLevel(level - 22),
        ],
        iconKey: 'ticker',
      },
    };
  }

  async composeAll(options?: { force?: boolean }): Promise<WidgetSnapshot[]> {
    const map = new Map<WidgetPreset, WidgetSnapshot>();

    const sharedRiskContext = await this.loadSharedRiskContext(options?.force).catch(() => ({
      location: null,
      briefing: null,
      assessment: null,
    }));

    const riskNow = await this.composeRiskNowSnapshot(sharedRiskContext).catch(() =>
      buildFallbackSnapshot('risk_now'),
    );
    map.set('risk_now', riskNow);
    this.setCachedSnapshot(riskNow);

    const commuteFromCache = this.getCachedSnapshot('commute', options?.force);
    const commute =
      commuteFromCache ||
      (await this.composeCommuteSnapshot().catch(() => buildFallbackSnapshot('commute')));
    map.set('commute', commute);
    this.setCachedSnapshot(commute);

    const cityPulse = await this.composeCityPulseSnapshot(sharedRiskContext).catch(() =>
      buildFallbackSnapshot('city_pulse'),
    );
    map.set('city_pulse', cityPulse);
    this.setCachedSnapshot(cityPulse);

    const alertsTicker = await this.composeAlertsTickerSnapshot(sharedRiskContext, riskNow).catch(() =>
      buildFallbackSnapshot('alerts_ticker'),
    );
    map.set('alerts_ticker', alertsTicker);
    this.setCachedSnapshot(alertsTicker);

    return WIDGET_PRESETS.map(preset => map.get(preset) || buildFallbackSnapshot(preset));
  }
}

export const widgetDataComposer = new WidgetDataComposer();
