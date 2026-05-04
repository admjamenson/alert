import {
  EpidemicMode,
  EpidemicService,
  EpidemicSnapshot,
} from '../EpidemicService';
import { normalizeToIsoDateTime } from '../../utils/dateTimeFormat';
import { AlertSignal, AlertSignalSeverity } from '../../types/alertIntelligence';
import { AlertSignalsConnector } from './types';

const parseSeverityFromSnapshot = (snapshot: EpidemicSnapshot): AlertSignalSeverity => {
  const levels = [snapshot.municipal, snapshot.state, snapshot.country];
  const maxCases = levels.reduce((acc, level) => {
    const value = typeof level?.cases === 'number' ? level.cases : 0;
    return Math.max(acc, value);
  }, 0);

  if (maxCases >= 2000) return 'critical';
  if (maxCases >= 500) return 'high';
  if (maxCases >= 100) return 'medium';
  return 'low';
};

const officialityFromTier = (tier?: 1 | 2 | 3): AlertSignal['officiality'] => {
  if (tier === 1) return 'OFFICIAL';
  if (tier === 2) return 'VERIFIED';
  return 'REFERENCE';
};

const confidenceFromStatus = (status: EpidemicSnapshot['status']): number => {
  if (status === 'FRESH') return 0.94;
  if (status === 'STALE') return 0.74;
  return 0.52;
};

const modeFromCategory = (category?: string | null): EpidemicMode | null => {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'pandemic') return 'pandemic';
  if (normalized === 'epidemic') return 'epidemic';
  return null;
};

export const EpidemicSignalsConnector: AlertSignalsConnector = {
  id: 'epidemic-official-feed',
  policy: {
    id: 'epidemic-official-feed-policy',
    allowedDomains: [
      'who.int',
      'covid19.who.int',
      'gov.br',
      'saude.gov.br',
      'notifica.saude.gov.br',
      'notifica-prd-es.saude.gov.br',
    ],
    allowHttp: false,
    mode: 'metadata_only',
  },
  supportsCategory(category) {
    const mode = modeFromCategory(category);
    return mode !== null;
  },
  async fetchSignals(context) {
    const mode = modeFromCategory(context.category);
    if (!mode) return [];
    if (
      !Number.isFinite(context.latitude) ||
      !Number.isFinite(context.longitude)
    ) {
      return [];
    }

    const snapshot = await EpidemicService.getSnapshot(
      Number(context.latitude),
      Number(context.longitude),
      mode,
      '7d',
      { force: Boolean(context.force) },
    );

    const timestamp =
      normalizeToIsoDateTime(snapshot.asOf || snapshot.fetchedAt) ||
      new Date().toISOString();
    const severity = parseSeverityFromSnapshot(snapshot);
    const source = snapshot.sources?.[0];

    const signal: AlertSignal = {
      id: `epi-${mode}-${timestamp}`,
      category: mode,
      severity,
      geometry: {
        type: 'Point',
        coordinates: [Number(context.longitude), Number(context.latitude)],
      },
      timestamp,
      sourceName: String(source?.name || snapshot.disease?.name || 'Official Epidemiology Feed'),
      sourceUrl: source?.url,
      jurisdiction: snapshot.municipal?.name || snapshot.state?.name || snapshot.country?.name,
      confidence: confidenceFromStatus(snapshot.status),
      officiality: officialityFromTier(source?.tier),
      freshness: snapshot.status,
      summary: snapshot.message,
    };

    return [signal];
  },
};

export default EpidemicSignalsConnector;
