import AlertIntelligenceService from '../AlertIntelligenceService';
import MonitoringContinuityStore from '../MonitoringContinuityStore';
import CrowdReports, { CrowdScope } from '../crowd/CrowdReports';
import SmartCache from '../cache/SmartCache';
import { mapMonitoringEventToDomain } from '../OfficialSourcesResolver';
import { AlertSignal, AlertTrustMeta } from '../../types/alertIntelligence';
import RedactionLogger from '../../privacy/RedactionLogger';

export type SecurityScope = CrowdScope;
export type SecurityStatus =
  | 'LIVE'
  | 'SNAPSHOT_VERIFIED'
  | 'LIMITED_COVERAGE'
  | 'CROWD_SIGNAL';
export type SecurityConfidence = 'high' | 'medium' | 'low';

export type SecurityDomain =
  | 'HEALTH'
  | 'CLIMATE'
  | 'INFRA'
  | 'MOBILITY'
  | 'SECURITY'
  | 'OPERATIONS';

export type SecurityIncidentItem = {
  id: string;
  category: string;
  domain: SecurityDomain;
  severity: AlertSignal['severity'];
  confidence: SecurityConfidence;
  confidenceScore: number;
  title: string;
  summary: string;
  updatedAt: string;
  sourceName: string;
  sourceUrl?: string;
  sourceBadge:
    | 'OFFICIAL'
    | 'VERIFIED'
    | 'REFERENCE'
    | 'TRUSTED_MEDIA'
    | 'TRUSTED_SOCIAL'
    | 'COMMUNITY'
    | 'ESTIMATED';
  evidenceLinks: string[];
  coordinate?: { latitude: number; longitude: number };
};

export type SecurityGlyph = {
  id: string;
  latitude: number;
  longitude: number;
  total: number;
  confidence: SecurityConfidence;
  domains: Array<{
    domain: SecurityDomain;
    severity: 0 | 1 | 2 | 3;
  }>;
};

export type SecurityMapSnapshot = {
  status: SecurityStatus;
  confidence: SecurityConfidence;
  updatedAt?: string;
  hasOfficialLocal: boolean;
  sourcesCount: number;
  evidenceLinks: string[];
  items: SecurityIncidentItem[];
  glyphs: SecurityGlyph[];
};

type SnapshotParams = {
  latitude: number;
  longitude: number;
  scope: SecurityScope;
  locale: string;
  timeZone: string;
  force?: boolean;
};

const CACHE_PREFIX = 'security-map:v2:';
const CACHE_TTL_MS = 40_000;
const CACHE_STALE_MS = 10_000;
const MAX_ITEMS = 5;

const domainFromCategory = (category: string): SecurityDomain => {
  const mapped = mapMonitoringEventToDomain(category);
  if (mapped === 'HEALTH') return 'HEALTH';
  if (mapped === 'INFRA') return 'INFRA';
  if (mapped === 'SECURITY' || mapped === 'SAFETY') return 'SECURITY';

  const normalized = String(category || '').toLowerCase();
  if (
    normalized.includes('storm') ||
    normalized.includes('cyclone') ||
    normalized.includes('hurricane') ||
    normalized.includes('tornado') ||
    normalized.includes('wind') ||
    normalized.includes('heat') ||
    normalized.includes('fog') ||
    normalized.includes('hail') ||
    normalized.includes('snow') ||
    normalized.includes('sand')
  ) {
    return 'CLIMATE';
  }
  if (
    normalized.includes('flood') ||
    normalized.includes('landslide') ||
    normalized.includes('avalanche') ||
    normalized.includes('tsunami') ||
    normalized.includes('high_tide') ||
    normalized.includes('rogue')
  ) {
    return 'MOBILITY';
  }
  if (normalized.includes('meteor')) return 'OPERATIONS';
  return 'OPERATIONS';
};

const severityRank: Record<AlertSignal['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const confidenceFromScore = (score: number): SecurityConfidence => {
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
};

const ageBoost = (updatedAt: string) => {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return 0;
  const age = Date.now() - ms;
  if (age <= 15 * 60 * 1000) return 0.1;
  if (age <= 60 * 60 * 1000) return 0.05;
  if (age > 6 * 60 * 60 * 1000) return -0.08;
  return 0;
};

const bucketByScope = (lat: number, lon: number, scope: SecurityScope) => {
  const precision = scope === 'CITY' ? 2 : scope === 'STATE' ? 1 : 0;
  return `${lat.toFixed(precision)}:${lon.toFixed(precision)}`;
};

const signalKey = (signal: AlertSignal, scope: SecurityScope) => {
  const coords =
    signal.geometry?.type === 'Point'
      ? bucketByScope(
          Number(signal.geometry.coordinates[1]),
          Number(signal.geometry.coordinates[0]),
          scope,
        )
      : 'poly';
  const timeBucket = Math.floor(Date.parse(signal.timestamp) / (15 * 60 * 1000));
  return `${signal.category}:${coords}:${timeBucket}`;
};

const dedupeSignals = (signals: AlertSignal[], scope: SecurityScope) => {
  const byKey = new Map<string, AlertSignal>();
  signals.forEach(signal => {
    const key = signalKey(signal, scope);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, signal);
      return;
    }
    const prevRank = severityRank[prev.severity] * 100 + Number(prev.confidence || 0) * 10;
    const nextRank = severityRank[signal.severity] * 100 + Number(signal.confidence || 0) * 10;
    if (nextRank > prevRank) {
      byKey.set(key, signal);
    }
  });
  return Array.from(byKey.values());
};

const sourceBadgeFromSignal = (
  signal: AlertSignal,
  trustMeta: AlertTrustMeta,
): SecurityIncidentItem['sourceBadge'] => {
  const source = trustMeta.sources.find(
    item =>
      item.name === signal.sourceName &&
      String(item.url || '') === String(signal.sourceUrl || ''),
  );
  if (source?.sourceClass === 'TRUSTED_MEDIA') return 'TRUSTED_MEDIA';
  if (source?.sourceClass === 'TRUSTED_SOCIAL') return 'TRUSTED_SOCIAL';
  if (source?.sourceClass === 'COMMUNITY') return 'COMMUNITY';
  if (source?.sourceClass === 'ESTIMATED') return 'ESTIMATED';
  if (signal.officiality === 'OFFICIAL') return 'OFFICIAL';
  if (signal.officiality === 'VERIFIED') return 'VERIFIED';
  return 'REFERENCE';
};

const baseScoreFromBadge = (badge: SecurityIncidentItem['sourceBadge']) => {
  if (badge === 'OFFICIAL') return 0.9;
  if (badge === 'VERIFIED' || badge === 'TRUSTED_MEDIA') return 0.72;
  if (badge === 'TRUSTED_SOCIAL') return 0.62;
  if (badge === 'ESTIMATED') return 0.5;
  if (badge === 'COMMUNITY') return 0.42;
  return 0.58;
};

const buildItem = (
  signal: AlertSignal,
  trustMeta: AlertTrustMeta,
  corroborationBoost: number,
  crowdBonus: number,
  hasOfficialLocal: boolean,
): SecurityIncidentItem => {
  const badge = sourceBadgeFromSignal(signal, trustMeta);
  let score =
    baseScoreFromBadge(badge) +
    ageBoost(signal.timestamp) +
    corroborationBoost +
    crowdBonus;

  if (!hasOfficialLocal && score > 0.79) score = 0.79;
  score = Math.max(0.2, Math.min(0.98, score));

  const title = String(signal.category || 'incident')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());

  const item: SecurityIncidentItem = {
    id: signal.id,
    category: signal.category,
    domain: domainFromCategory(signal.category),
    severity: signal.severity,
    confidence: confidenceFromScore(score),
    confidenceScore: score,
    title,
    summary: signal.summary || title,
    updatedAt: signal.timestamp,
    sourceName: signal.sourceName || 'Alert',
    sourceUrl: signal.sourceUrl,
    sourceBadge: badge,
    evidenceLinks: trustMeta.evidencePack.evidenceLinks.slice(0, 5),
    coordinate:
      signal.geometry.type === 'Point'
        ? {
            latitude: Number(signal.geometry.coordinates[1]),
            longitude: Number(signal.geometry.coordinates[0]),
          }
        : undefined,
  };
  return item;
};

const buildGlyphs = (items: SecurityIncidentItem[], scope: SecurityScope): SecurityGlyph[] => {
  const byCluster = new Map<string, SecurityIncidentItem[]>();
  items.forEach(item => {
    if (!item.coordinate) return;
    const clusterKey = bucketByScope(item.coordinate.latitude, item.coordinate.longitude, scope);
    const list = byCluster.get(clusterKey) || [];
    list.push(item);
    byCluster.set(clusterKey, list);
  });

  const out: SecurityGlyph[] = [];
  byCluster.forEach((clusterItems, key) => {
    const first = clusterItems[0];
    if (!first.coordinate) return;

    const domainLevels = new Map<SecurityDomain, 0 | 1 | 2 | 3>();
    clusterItems.forEach(item => {
      const level = severityRank[item.severity] as 0 | 1 | 2 | 3;
      const prev = domainLevels.get(item.domain) || 0;
      domainLevels.set(item.domain, level > prev ? level : prev);
    });

    const avgScore =
      clusterItems.reduce((sum, item) => sum + item.confidenceScore, 0) /
      Math.max(1, clusterItems.length);

    out.push({
      id: `glyph-${key}`,
      latitude: first.coordinate.latitude,
      longitude: first.coordinate.longitude,
      total: clusterItems.length,
      confidence: confidenceFromScore(avgScore),
      domains: ([
        'HEALTH',
        'CLIMATE',
        'INFRA',
        'MOBILITY',
        'SECURITY',
        'OPERATIONS',
      ] as SecurityDomain[]).map(domain => ({
        domain,
        severity: domainLevels.get(domain) || 0,
      })),
    });
  });

  return out;
};

const toContinuityStatus = (status: SecurityStatus) => {
  if (status === 'LIVE') return 'active';
  if (status === 'CROWD_SIGNAL') return 'active';
  if (status === 'LIMITED_COVERAGE') return 'none';
  return 'unavailable';
};

const toContinuityTrustStatus = (confidence: SecurityConfidence) => {
  if (confidence === 'high') return 'online';
  if (confidence === 'medium') return 'stale';
  return 'unavailable';
};

const buildCacheKey = ({ latitude, longitude, scope }: SnapshotParams) =>
  `${CACHE_PREFIX}${scope}:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;

const resolveStatus = (params: {
  liveCount: number;
  hasOfficialLocal: boolean;
  hasCrowd: boolean;
  hasContinuity: boolean;
}): SecurityStatus => {
  if (params.liveCount > 0 && params.hasOfficialLocal) return 'LIVE';
  if (params.liveCount > 0 && !params.hasOfficialLocal) return 'LIMITED_COVERAGE';
  if (params.hasContinuity) return 'SNAPSHOT_VERIFIED';
  if (params.hasCrowd) return 'CROWD_SIGNAL';
  return 'LIMITED_COVERAGE';
};

const sortItems = (a: SecurityIncidentItem, b: SecurityIncidentItem) => {
  const severityDiff = severityRank[b.severity] - severityRank[a.severity];
  if (severityDiff !== 0) return severityDiff;
  const confidenceDiff = b.confidenceScore - a.confidenceScore;
  if (Math.abs(confidenceDiff) > 0.001) return confidenceDiff;
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
};

const mapSignalsFromContinuity = (signals: AlertSignal[]): SecurityIncidentItem[] =>
  signals.map(signal => {
    const score = Math.max(0.2, Math.min(0.95, Number(signal.confidence || 0.4)));
    return {
      id: signal.id,
      category: signal.category,
      domain: domainFromCategory(signal.category),
      severity: signal.severity,
      confidence: confidenceFromScore(score),
      confidenceScore: score,
      title: String(signal.category || 'incident')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase()),
      summary: signal.summary || '',
      updatedAt: signal.timestamp,
      sourceName: signal.sourceName || 'Alert',
      sourceUrl: signal.sourceUrl,
      sourceBadge:
        signal.officiality === 'OFFICIAL'
          ? 'OFFICIAL'
          : signal.officiality === 'VERIFIED'
            ? 'VERIFIED'
            : 'REFERENCE',
      evidenceLinks: [],
      coordinate:
        signal.geometry.type === 'Point'
          ? {
              latitude: Number(signal.geometry.coordinates[1]),
              longitude: Number(signal.geometry.coordinates[0]),
            }
          : undefined,
    } as SecurityIncidentItem;
  });

export const UnifiedIncidentStore = {
  async getSnapshot(params: SnapshotParams): Promise<SecurityMapSnapshot> {
    const cacheKey = buildCacheKey(params);
    if (!params.force) {
      const cached = SmartCache.getWithStale<SecurityMapSnapshot>(cacheKey);
      if (cached && !cached.stale) return cached.value;
    }

    const liveSignals = await AlertIntelligenceService.fetchRealtimeSignals({
      latitude: params.latitude,
      longitude: params.longitude,
      locale: params.locale,
      timeZone: params.timeZone,
      scope: params.scope,
      force: Boolean(params.force),
    }).catch(error => {
      RedactionLogger.safeLog('UnifiedIncidentStore.liveSignals.error', {
        message: String((error as any)?.message || error || 'unknown'),
      });
      return [] as AlertSignal[];
    });

    const crowdSignals = await CrowdReports.getSignals({
      latitude: params.latitude,
      longitude: params.longitude,
      scope: params.scope,
    }).catch(() => [] as AlertSignal[]);

    const trustMeta = AlertIntelligenceService.getTrustMeta(liveSignals);
    const hasOfficialLocal = trustMeta.sources.some(source => source.officiality === 'OFFICIAL');
    const distinctSources = new Set(
      liveSignals
        .map(signal => `${String(signal.sourceName || '').toLowerCase()}|${String(signal.sourceUrl || '').toLowerCase()}`)
        .filter(Boolean),
    ).size;
    const corroborationBoost = Math.min(0.16, Math.max(0, distinctSources - 1) * 0.08);

    const deduped = dedupeSignals([...liveSignals, ...crowdSignals], params.scope);
    const items = deduped
      .map(signal => {
        const isCrowd = signal.sourceName === 'Alert Community';
        const crowdBonus = isCrowd ? 0.12 : 0;
        return buildItem(
          signal,
          trustMeta,
          corroborationBoost,
          crowdBonus,
          hasOfficialLocal,
        );
      })
      .sort(sortItems)
      .slice(0, MAX_ITEMS);

    const continuity = await MonitoringContinuityStore.readSnapshot({
      eventType: 'security_map',
      scope: params.scope,
      latitude: params.latitude,
      longitude: params.longitude,
    }).catch(() => null);

    const status = resolveStatus({
      liveCount: liveSignals.length,
      hasOfficialLocal,
      hasCrowd: crowdSignals.length > 0,
      hasContinuity: Boolean(continuity),
    });

    let finalItems = items;
    let updatedAt = items[0]?.updatedAt || trustMeta.updatedAt;
    if (status === 'SNAPSHOT_VERIFIED' && finalItems.length === 0 && continuity?.snapshot) {
      finalItems = mapSignalsFromContinuity(continuity.snapshot.aiSignals).slice(0, MAX_ITEMS);
      updatedAt = continuity.snapshot.updatedAt || continuity.snapshot.savedAt;
    }

    const averageScore =
      finalItems.reduce((sum, item) => sum + item.confidenceScore, 0) /
      Math.max(1, finalItems.length);
    const snapshot: SecurityMapSnapshot = {
      status,
      confidence: confidenceFromScore(averageScore),
      updatedAt,
      hasOfficialLocal,
      sourcesCount: Math.max(
        distinctSources,
        continuity?.snapshot?.sources?.length || 0,
      ),
      evidenceLinks:
        trustMeta.evidencePack.evidenceLinks.length > 0
          ? trustMeta.evidencePack.evidenceLinks.slice(0, 5)
          : continuity?.snapshot?.evidenceLinks?.slice(0, 5) || [],
      items: finalItems,
      glyphs: buildGlyphs(finalItems, params.scope),
    };

    if (liveSignals.length > 0 || crowdSignals.length > 0) {
      const sourceLine =
        finalItems[0]?.sourceName ||
        trustMeta.sources[0]?.name ||
        'Alert Intelligence';
      void MonitoringContinuityStore.saveSnapshot({
        eventType: 'security_map',
        scope: params.scope,
        latitude: params.latitude,
        longitude: params.longitude,
        status: toContinuityStatus(snapshot.status),
        trustStatus: toContinuityTrustStatus(snapshot.confidence),
        summary: finalItems[0]?.summary || '',
        sourceLine,
        sourceUrl: finalItems[0]?.sourceUrl,
        sourceTrustTier: trustMeta.evidencePack.sourceTrustTier,
        sources: trustMeta.sources.slice(0, 5).map(source => ({
          name: source.name,
          url: source.url,
          officiality:
            source.sourceClass === 'TRUSTED_MEDIA'
              ? 'TRUSTED_MEDIA'
              : source.sourceClass === 'TRUSTED_SOCIAL'
                ? 'TRUSTED_SOCIAL'
                : source.sourceClass === 'COMMUNITY'
                  ? 'COMMUNITY'
                  : source.sourceClass === 'ESTIMATED'
                    ? 'ESTIMATED'
                    : source.officiality,
        })),
        sourcesFallback: !hasOfficialLocal,
        updatedAt: snapshot.updatedAt,
        aiSummary: finalItems[0]?.summary || '',
        aiConflict: trustMeta.conflict,
        evidenceLinks: snapshot.evidenceLinks,
        aiSignals: deduped.slice(0, 80),
        officialPoints: {
          type: 'FeatureCollection',
          features: finalItems
            .filter(item => item.coordinate)
            .map(item => ({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [item.coordinate!.longitude, item.coordinate!.latitude],
              },
              properties: {
                category: item.category,
                confidence: item.confidence,
                source: item.sourceName,
              },
            })),
        },
        sosPoints: {
          type: 'FeatureCollection',
          features: crowdSignals
            .filter(signal => signal.geometry.type === 'Point')
            .map(signal => ({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: signal.geometry.coordinates,
              },
              properties: {
                confidence: signal.confidence,
              },
            })),
        },
      }).catch(() => {});
    }

    SmartCache.set(cacheKey, snapshot, CACHE_TTL_MS, CACHE_STALE_MS);
    return snapshot;
  },
};

export default UnifiedIncidentStore;
