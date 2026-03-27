export type OperationalRiskLevel = 'low' | 'medium' | 'high';

export type OperationalTrustBadge = 'official' | 'verified' | 'reference' | 'limited';

export type OperationalSnapshotState = 'loading' | 'fresh' | 'stale' | 'error';

export type OperationalSourceClass =
  | 'official'
  | 'official_social'
  | 'major_media'
  | 'verified_partner'
  | 'internal_alert'
  | 'community'
  | 'reference';

export type OperationalSourceSummary = Partial<Record<OperationalSourceClass, number>>;

export type OperationalSnapshot = {
  riskLevel: OperationalRiskLevel;
  scoreLevel: number;
  confidence: number;
  freshnessSec: number;
  trustBadge: OperationalTrustBadge;
  sourceCount: number;
  dominantSourceClass: OperationalSourceClass;
  sourceSummary: OperationalSourceSummary;
  monitoredSituationCount: number;
  activeSituationCount: number;
  activeSituationRatio: number;
  exposedSituationCount: number;
  exposedSituationRatio: number;
  highSituationCount: number;
  mediumSituationCount: number;
  situationPressure: number;
  exposurePressure: number;
  criticalExposureCount: number;
  nearestThreatKm: number | null;
  expiresAt: string;
  updatedAt: string;
  generatedAt: string;
};

export type OperationalSnapshotReadModel = {
  snapshot: OperationalSnapshot | null;
  state: OperationalSnapshotState;
  stale: boolean;
  errorCode?: string;
};

const DEFAULT_FRESHNESS_SEC = 999;

export const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Number(value) || 0));

export const normalizeOperationalRiskLevel = (value: unknown): OperationalRiskLevel => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'high' || normalized === 'medium') return normalized;
  return 'low';
};

export const normalizeOperationalTrustBadge = (value: unknown): OperationalTrustBadge => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'official' || normalized === 'verified' || normalized === 'reference') {
    return normalized;
  }
  return 'limited';
};

export const normalizeOperationalSourceClass = (value: unknown): OperationalSourceClass => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'official' ||
    normalized === 'official_social' ||
    normalized === 'major_media' ||
    normalized === 'verified_partner' ||
    normalized === 'internal_alert' ||
    normalized === 'community'
  ) {
    return normalized;
  }
  return 'reference';
};

export const riskLevelToMeterLevel = (riskLevel: OperationalRiskLevel): number => {
  if (riskLevel === 'high') return 80;
  if (riskLevel === 'medium') return 58;
  return 34;
};

export const getOperationalScoreLevel = (snapshot: OperationalSnapshot): number =>
  Math.max(0, Math.min(100, Math.round(Number(snapshot.scoreLevel || riskLevelToMeterLevel(snapshot.riskLevel)))));

const normalizeOperationalSourceSummary = (raw: any): OperationalSourceSummary => ({
  official: Math.max(0, Math.round(Number(raw?.official || 0))),
  official_social: Math.max(0, Math.round(Number(raw?.official_social || 0))),
  major_media: Math.max(0, Math.round(Number(raw?.major_media || 0))),
  verified_partner: Math.max(0, Math.round(Number(raw?.verified_partner || 0))),
  internal_alert: Math.max(0, Math.round(Number(raw?.internal_alert || 0))),
  community: Math.max(0, Math.round(Number(raw?.community || 0))),
  reference: Math.max(0, Math.round(Number(raw?.reference || 0))),
});

export const getFreshnessSec = (snapshot: OperationalSnapshot): number => {
  if (Number.isFinite(snapshot.freshnessSec) && snapshot.freshnessSec >= 0) {
    return Number(snapshot.freshnessSec);
  }
  const updatedAtMs = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return DEFAULT_FRESHNESS_SEC;
  return Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000));
};

export const isSnapshotStale = (snapshot: OperationalSnapshot, now = Date.now()): boolean => {
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return getFreshnessSec(snapshot) > 20 * 60;
  }
  return expiresAtMs <= now;
};

export const normalizeOperationalSnapshot = (raw: any): OperationalSnapshot => {
  const nowIso = new Date().toISOString();
  const normalized: OperationalSnapshot = {
    riskLevel: normalizeOperationalRiskLevel(raw?.riskLevel),
    scoreLevel: Math.max(0, Math.min(100, Math.round(Number(raw?.scoreLevel || 0)))),
    confidence: clampConfidence(raw?.confidence),
    freshnessSec: Math.max(0, Number(raw?.freshnessSec || 0)),
    trustBadge: normalizeOperationalTrustBadge(raw?.trustBadge),
    sourceCount: Math.max(0, Math.round(Number(raw?.sourceCount || 0))),
    dominantSourceClass: normalizeOperationalSourceClass(raw?.dominantSourceClass),
    sourceSummary: normalizeOperationalSourceSummary(raw?.sourceSummary),
    monitoredSituationCount: Math.max(1, Math.round(Number(raw?.monitoredSituationCount || 34))),
    activeSituationCount: Math.max(0, Math.round(Number(raw?.activeSituationCount || 0))),
    activeSituationRatio: clampConfidence(raw?.activeSituationRatio),
    exposedSituationCount: Math.max(0, Math.round(Number(raw?.exposedSituationCount || 0))),
    exposedSituationRatio: clampConfidence(raw?.exposedSituationRatio),
    highSituationCount: Math.max(0, Math.round(Number(raw?.highSituationCount || 0))),
    mediumSituationCount: Math.max(0, Math.round(Number(raw?.mediumSituationCount || 0))),
    situationPressure: clampConfidence(raw?.situationPressure),
    exposurePressure: clampConfidence(raw?.exposurePressure),
    criticalExposureCount: Math.max(0, Math.round(Number(raw?.criticalExposureCount || 0))),
    nearestThreatKm: Number.isFinite(Number(raw?.nearestThreatKm))
      ? Math.max(0, Number(raw.nearestThreatKm))
      : null,
    expiresAt: typeof raw?.expiresAt === 'string' && raw.expiresAt.trim() ? raw.expiresAt : nowIso,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : nowIso,
    generatedAt:
      typeof raw?.generatedAt === 'string' && raw.generatedAt.trim() ? raw.generatedAt : nowIso,
  };
  if (!Number.isFinite(normalized.scoreLevel) || normalized.scoreLevel <= 0) {
    normalized.scoreLevel = riskLevelToMeterLevel(normalized.riskLevel);
  }
  if (!Number.isFinite(normalized.freshnessSec) || normalized.freshnessSec <= 0) {
    normalized.freshnessSec = getFreshnessSec(normalized);
  }
  if (
    !Number.isFinite(normalized.activeSituationRatio) ||
    normalized.activeSituationRatio <= 0
  ) {
    normalized.activeSituationRatio = clampConfidence(
      normalized.activeSituationCount / Math.max(1, normalized.monitoredSituationCount),
    );
  }
  if (
    !Number.isFinite(normalized.exposedSituationRatio) ||
    normalized.exposedSituationRatio <= 0
  ) {
    normalized.exposedSituationRatio = clampConfidence(
      normalized.exposedSituationCount / Math.max(1, normalized.monitoredSituationCount),
    );
  }
  return normalized;
};
