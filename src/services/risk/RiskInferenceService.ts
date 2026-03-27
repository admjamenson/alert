import { AlertNotification } from '../../types/notifications';
import { EpidemicSnapshot } from '../EpidemicService';

export type RiskNature = 'forecast' | 'observed' | 'none';
export type EpidemicScope = 'municipal' | 'state' | 'country';

type PriorityScoreInput = {
  nature: RiskNature;
  riskScore: number;
  timestamp?: string;
  highlighted?: boolean;
  distanceKm?: number;
};

type EpidemicThreshold = {
  warningCases: number;
  criticalCases: number;
  warningDeaths: number;
  criticalDeaths: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TS_BUFFER_MS = 2 * 60 * 1000;

const EPIDEMIC_THRESHOLDS: Record<EpidemicScope, EpidemicThreshold> = {
  municipal: {
    warningCases: 75,
    criticalCases: 250,
    warningDeaths: 1,
    criticalDeaths: 3,
  },
  state: {
    warningCases: 500,
    criticalCases: 5000,
    warningDeaths: 3,
    criticalDeaths: 20,
  },
  country: {
    warningCases: 5000,
    criticalCases: 50000,
    warningDeaths: 25,
    criticalDeaths: 200,
  },
};

const FORECAST_KEYWORDS = [
  'previs',
  'possibilidade',
  'risco de',
  'watch',
  'warning',
  'advisory',
  'expected',
  'likely',
  'potential',
  'chance',
  'probability',
  'outlook',
  'estimate',
  'estimated',
  'forecast',
];

const OBSERVED_KEYWORDS = [
  'detectad',
  'ocorrendo',
  'em andamento',
  'confirmad',
  'registrad',
  'atividade sismica detectada',
  'incendio ativo',
  'flooding reported',
  'earthquake',
  'landslide occurred',
  'ongoing',
  'active',
  'reported',
  'confirmed',
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeText = (value: unknown): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const includesAny = (text: string, terms: string[]): boolean =>
  terms.some(term => text.includes(term));

const parseTimestamp = (value?: string): number => {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : Date.now();
};

const parseMagnitudeFromAlert = (alert: AlertNotification): number | null => {
  const title = String(alert.title || '');
  const summary = String(alert.summary || '');
  const source = `${title} ${summary}`;
  const match = source.match(/m\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const recencyWeight = (timestamp?: string): number => {
  const ageMs = Math.max(0, Date.now() - parseTimestamp(timestamp));
  const ratio = Math.max(0, 1 - ageMs / (3 * DAY_MS));
  return ratio * 0.15;
};

const getEpidemicTrend = (snapshot: EpidemicSnapshot, scope: EpidemicScope): string => {
  const level = (snapshot as any)?.[scope];
  const directTrend =
    typeof level?.trend === 'string'
      ? level.trend
      : typeof (snapshot as any)?.trend === 'string'
        ? (snapshot as any).trend
        : '';
  return normalizeText(directTrend);
};

const getEpidemicLevel = (snapshot: EpidemicSnapshot, scope: EpidemicScope) => {
  if (scope === 'country') return snapshot.country;
  if (scope === 'state') return snapshot.state;
  return snapshot.municipal;
};

export const inferRiskNatureFromAlert = (
  alert: AlertNotification,
): RiskNature => {
  if (!alert) return 'none';
  if (alert.type === 'sos') return 'observed';

  const source = normalizeText(alert.sourceName);
  const text = normalizeText(`${alert.title} ${alert.summary}`);
  const ts = parseTimestamp(alert.timestamp);
  const isFuture = ts > Date.now() + FUTURE_TS_BUFFER_MS;

  const observedByText = includesAny(text, OBSERVED_KEYWORDS);
  const forecastByText = includesAny(text, FORECAST_KEYWORDS);

  if (source.includes('usgs') || source.includes('gdacs')) return 'observed';
  if (source.includes('noaa')) return observedByText ? 'observed' : 'forecast';
  if (isFuture) return 'forecast';
  if (observedByText) return 'observed';
  if (forecastByText) return 'forecast';

  return 'forecast';
};

export const riskScoreFromAlert = (alert: AlertNotification): number => {
  if (!alert) return 0;
  if (alert.type === 'sos') return 1;

  let score = 0.35;
  const severity = normalizeText((alert as any)?.severity);
  const source = normalizeText(alert.sourceName);
  const text = normalizeText(`${alert.title} ${alert.summary}`);

  if (severity.includes('critical') || severity.includes('extreme') || severity.includes('major')) {
    score = Math.max(score, 0.9);
  } else if (severity.includes('severe')) {
    score = Math.max(score, 0.78);
  } else if (severity.includes('moderate')) {
    score = Math.max(score, 0.62);
  } else if (severity.includes('minor')) {
    score = Math.max(score, 0.45);
  }

  if (source.includes('usgs')) {
    const mag = parseMagnitudeFromAlert(alert);
    if (mag !== null) {
      if (mag >= 8) score = Math.max(score, 1);
      else if (mag >= 7) score = Math.max(score, 0.96);
      else if (mag >= 6) score = Math.max(score, 0.88);
      else if (mag >= 5) score = Math.max(score, 0.76);
      else if (mag >= 4) score = Math.max(score, 0.64);
    }
  }

  if (
    includesAny(text, [
      'catastrophic',
      'grave',
      'severe storm',
      'major flood',
      'flood emergency',
      'evacuat',
      'desastre',
      'fatal',
    ])
  ) {
    score = Math.max(score, 0.86);
  } else if (includesAny(text, FORECAST_KEYWORDS)) {
    score = Math.max(score, 0.52);
  }

  return clamp01(score);
};

export const priorityScore = ({
  nature,
  riskScore,
  timestamp,
  highlighted,
  distanceKm,
}: PriorityScoreInput): number => {
  const natureWeight = nature === 'observed' ? 0.35 : nature === 'forecast' ? 0.2 : 0;
  const highlightBonus = highlighted ? 0.08 : 0;
  const distanceBonus =
    Number.isFinite(distanceKm as number) && typeof distanceKm === 'number'
      ? distanceKm <= 5
        ? 0.14
        : distanceKm <= 10
          ? 0.07
          : 0
      : 0;
  const score =
    natureWeight +
    clamp01(riskScore) * 0.55 +
    recencyWeight(timestamp) +
    highlightBonus +
    distanceBonus;
  return clamp01(score);
};

export const inferRiskFromEpidemicSnapshot = (
  snapshot: EpidemicSnapshot | null | undefined,
  scope: EpidemicScope,
  highlighted = false,
): {
  nature: RiskNature;
  riskScore: number;
  priorityScore: number;
} => {
  if (!snapshot?.enabled) {
    return { nature: 'none', riskScore: 0, priorityScore: 0 };
  }

  const level = getEpidemicLevel(snapshot, scope);
  const cases = Number.isFinite(level.cases as number) ? Number(level.cases) : 0;
  const deaths = Number.isFinite(level.deaths as number) ? Number(level.deaths) : 0;
  const trend = getEpidemicTrend(snapshot, scope);
  const trendUp = includesAny(trend, ['up', 'rising', 'increase', 'spike', 'alta', 'subindo']);
  const threshold = EPIDEMIC_THRESHOLDS[scope];

  if (cases <= 0 && deaths <= 0 && !trendUp) {
    return { nature: 'none', riskScore: 0, priorityScore: 0 };
  }

  let nature: RiskNature = 'none';
  let score = 0;

  if (
    cases >= threshold.criticalCases ||
    deaths >= threshold.criticalDeaths ||
    (trendUp && (cases >= threshold.warningCases || deaths >= threshold.warningDeaths))
  ) {
    nature = 'observed';
    score = 0.72;
    if (cases >= threshold.criticalCases * 2 || deaths >= threshold.criticalDeaths * 2) {
      score = 0.88;
    }
  } else if (
    cases >= threshold.warningCases ||
    deaths >= threshold.warningDeaths ||
    trendUp
  ) {
    nature = 'forecast';
    score = 0.52;
    if (cases >= threshold.warningCases * 2 || deaths >= threshold.warningDeaths * 2) {
      score = 0.62;
    }
  }

  if (nature === 'none') {
    return { nature, riskScore: 0, priorityScore: 0 };
  }

  return {
    nature,
    riskScore: score,
    priorityScore: priorityScore({
      nature,
      riskScore: score,
      timestamp: snapshot.asOf || snapshot.fetchedAt,
      highlighted,
    }),
  };
};
