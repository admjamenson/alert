import {
  AlertAiSummary,
  AlertIntelligenceContext,
  AlertSignal,
  AlertSignalSource,
  AlertTrustMeta,
} from '../types/alertIntelligence';
import { mapMonitoringEventToDomain } from './OfficialSourcesResolver';
import MonitoringSignalsConnector from './sources/MonitoringSignalsConnector';
import EpidemicSignalsConnector from './sources/EpidemicSignalsConnector';
import { AlertSignalsConnector, SourcePolicy } from './sources/types';

type SignalsCacheEntry = {
  savedAtMs: number;
  ttlMs: number;
  signals: AlertSignal[];
};

type FailureState = {
  streak: number;
  blockedUntilMs: number;
};

const CONNECTORS: AlertSignalsConnector[] = [
  EpidemicSignalsConnector,
  MonitoringSignalsConnector,
];

const CACHE_BY_KEY = new Map<string, SignalsCacheEntry>();
const IN_FLIGHT_BY_KEY = new Map<string, Promise<AlertSignal[]>>();
const LAST_FORCE_ATTEMPT_MS = new Map<string, number>();
const FAILURE_STATE_BY_KEY = new Map<string, FailureState>();

const CRITICAL_TTL_MS = 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const FORCE_THROTTLE_MS = 5 * 1000;
const MAX_SIGNALS = 240;
const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000];

const SEVERITY_RANK: Record<AlertSignal['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const CRITICAL_CATEGORIES = new Set([
  'sos',
  'sos_nearby',
  'earthquake',
  'flood',
  'storm',
  'hurricane',
  'tornado',
  'wildfire',
  'tsunami',
  'pandemic',
  'epidemic',
]);

const TRUSTED_SOCIAL_DOMAINS = [
  'instagram.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'youtube.com',
  't.me',
  'threads.net',
];

const toCategory = (value?: string) => String(value || '').trim().toLowerCase();

const buildKey = (context: AlertIntelligenceContext) => {
  const lat = Number(context.latitude || 0).toFixed(3);
  const lon = Number(context.longitude || 0).toFixed(3);
  const category = toCategory(context.category);
  return `${lat}|${lon}|${context.scope}|${category || 'all'}`;
};

const parseMs = (value?: string) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};

const sortSignals = (a: AlertSignal, b: AlertSignal) => {
  const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severityDiff !== 0) return severityDiff;
  const freshnessDiff = parseMs(b.timestamp) - parseMs(a.timestamp);
  if (freshnessDiff !== 0) return freshnessDiff;
  return b.confidence - a.confidence;
};

const normalizeSignal = (signal: AlertSignal): AlertSignal | null => {
  if (!signal || typeof signal !== 'object') return null;
  if (!signal.geometry || typeof signal.geometry !== 'object') return null;
  if (signal.geometry.type === 'Point') {
    const coords = signal.geometry.coordinates;
    if (
      !Array.isArray(coords) ||
      coords.length < 2 ||
      !Number.isFinite(Number(coords[0])) ||
      !Number.isFinite(Number(coords[1]))
    ) {
      return null;
    }
  }
  if (signal.geometry.type === 'Polygon') {
    const rings = signal.geometry.coordinates;
    if (!Array.isArray(rings) || rings.length === 0) return null;
  }
  const category = toCategory(signal.category) || 'other';
  const timestamp = parseMs(signal.timestamp)
    ? new Date(parseMs(signal.timestamp)).toISOString()
    : new Date().toISOString();

  return {
    ...signal,
    id:
      String(signal.id || '').trim() ||
      `${category}-${timestamp}-${Math.round(Math.random() * 10000)}`,
    category,
    timestamp,
    sourceName: String(signal.sourceName || '').trim() || 'Alert Intelligence Feed',
    confidence: Number.isFinite(signal.confidence)
      ? Math.max(0, Math.min(1, Number(signal.confidence)))
      : 0.5,
  };
};

const dedupeSignals = (signals: AlertSignal[]) => {
  const byId = new Map<string, AlertSignal>();
  signals.forEach(signal => {
    const key = String(signal.id || '').trim();
    if (!key) return;
    const existing = byId.get(key);
    if (!existing || sortSignals(signal, existing) < 0) {
      byId.set(key, signal);
    }
  });
  return Array.from(byId.values()).sort(sortSignals);
};

const isExpired = (entry: SignalsCacheEntry) => Date.now() - entry.savedAtMs > entry.ttlMs;

const nextBackoffMs = (streak: number) => {
  if (streak <= 1) return BACKOFF_STEPS_MS[0];
  if (streak === 2) return BACKOFF_STEPS_MS[1];
  return BACKOFF_STEPS_MS[2];
};

const inferTTL = (signals: AlertSignal[], category?: string) => {
  const normalizedCategory = toCategory(category);
  if (CRITICAL_CATEGORIES.has(normalizedCategory)) return CRITICAL_TTL_MS;
  if (
    signals.some(
      signal =>
        signal.severity === 'critical' ||
        signal.severity === 'high' ||
        CRITICAL_CATEGORIES.has(toCategory(signal.category)),
    )
  ) {
    return CRITICAL_TTL_MS;
  }
  return DEFAULT_TTL_MS;
};

const supportsCategory = (connector: AlertSignalsConnector, category?: string) => {
  if (!connector.supportsCategory) return true;
  return connector.supportsCategory(category);
};

const isUrlAllowedByPolicy = (url: string | undefined, policy?: SourcePolicy): boolean => {
  if (!policy) return true;
  if (!url) return true;

  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (!policy.allowHttp && protocol !== 'https:') return false;
    if (policy.allowedDomains.length === 0) return true;
    const host = parsed.hostname.toLowerCase();
    return policy.allowedDomains.some(domain => {
      const normalizedDomain = domain.toLowerCase();
      return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
    });
  } catch {
    return false;
  }
};

const inferSourceType = (url?: string): AlertSignalSource['sourceType'] => {
  const raw = String(url || '').toLowerCase();
  if (!raw) return 'WEB';
  if (
    raw.includes('/api') ||
    raw.includes('format=json') ||
    raw.endsWith('.json') ||
    raw.includes('application/json')
  ) {
    return 'API';
  }
  if (
    raw.includes('rss') ||
    raw.includes('atom') ||
    raw.endsWith('.xml') ||
    raw.includes('feed=')
  ) {
    return 'RSS';
  }
  return 'WEB';
};

const normalizeFreshness = (signals: AlertSignal[]): AlertTrustMeta['status'] => {
  if (signals.some(signal => signal.freshness === 'FRESH')) return 'FRESH';
  if (signals.some(signal => signal.freshness === 'STALE')) return 'STALE';
  return 'UNKNOWN';
};

const isPortuguese = (locale: string) => String(locale || '').toLowerCase().startsWith('pt');

const humanizeCategory = (category: string) =>
  toCategory(category)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const summarizeSignals = (signals: AlertSignal[], locale: string): AlertAiSummary => {
  const pt = isPortuguese(locale);
  if (!signals.length) {
    return {
      headline: pt ? 'Monitorando atualizacoes agora.' : 'Monitoring updates now.',
      bullets: [
        pt
          ? 'Mostrando a ultima verificacao confiavel disponivel.'
          : 'Showing the latest verified snapshot available.',
      ],
      action: pt
        ? 'Use Atualizar para tentar dados ao vivo sem perder o contexto do mapa.'
        : 'Use Refresh to attempt live data without losing map context.',
    };
  }

  const severeCount = signals.filter(
    signal => signal.severity === 'high' || signal.severity === 'critical',
  ).length;
  const topCategories = Array.from(
    new Set(signals.slice(0, 3).map(signal => humanizeCategory(signal.category))),
  ).filter(Boolean);

  const headline =
    pt
      ? severeCount > 0
        ? `${severeCount} sinais de alta severidade detectados.`
        : `${signals.length} sinais ativos monitorados.`
      : severeCount > 0
        ? `${severeCount} high-severity signals detected.`
        : `${signals.length} active signals monitored.`;

  const bullets: string[] = [];
  if (topCategories.length > 0) {
    bullets.push(
      pt
        ? `Categorias principais: ${topCategories.join(', ')}.`
        : `Top categories: ${topCategories.join(', ')}.`,
    );
  }
  const newest = signals[0];
  if (newest?.sourceName) {
    bullets.push(
      pt
        ? `Fonte principal: ${newest.sourceName}.`
        : `Primary source: ${newest.sourceName}.`,
    );
  }

  return {
    headline,
    bullets,
    action: pt
      ? 'Revise as fontes e aplique o foco no mapa para validar a area afetada.'
      : 'Review sources and apply map focus to validate the affected area.',
  };
};

const parseHost = (url?: string): string => {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const resolveSourceClass = (
  officiality: AlertSignal['officiality'],
  sourceUrl?: string,
): NonNullable<AlertSignalSource['sourceClass']> => {
  if (officiality === 'OFFICIAL') return 'OFFICIAL';
  const host = parseHost(sourceUrl);
  if (host && TRUSTED_SOCIAL_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
    return 'TRUSTED_SOCIAL';
  }
  if (officiality === 'VERIFIED') return 'TRUSTED_MEDIA';
  if (host.includes('model') || host.includes('forecast') || host.includes('simulator')) {
    return 'ESTIMATED';
  }
  return 'COMMUNITY';
};

const buildEvidencePack = (signals: AlertSignal[]): AlertTrustMeta['evidencePack'] => {
  if (!signals.length) {
    return {
      evidenceLinks: [],
      evidenceCount: 0,
      sourcesDistinctCount: 0,
      sourceTrustTier: 'C',
      verifiedAt: undefined,
      confirmation: 'INITIAL_SIGNAL',
    };
  }

  const links = Array.from(
    new Set(
      signals
        .map(signal => String(signal.sourceUrl || '').trim())
        .filter(link => Boolean(link))
        .slice(0, 5),
    ),
  );
  const distinctSources = new Set(
    signals.map(signal => String(signal.sourceName || '').trim().toLowerCase()).filter(Boolean),
  );
  const hasOfficial = signals.some(signal => signal.officiality === 'OFFICIAL');
  const hasVerified = signals.some(signal => signal.officiality === 'VERIFIED');
  const hasEstimated = signals.some(
    signal => resolveSourceClass(signal.officiality, signal.sourceUrl) === 'ESTIMATED',
  );
  const sourceTrustTier: 'A' | 'B' | 'C' = hasOfficial ? 'A' : hasVerified ? 'B' : 'C';

  let confirmation: AlertTrustMeta['evidencePack']['confirmation'] = 'COMMUNITY_ONLY';
  if ((sourceTrustTier === 'A' || sourceTrustTier === 'B') && distinctSources.size >= 2) {
    confirmation = 'MULTI_SOURCE_CONFIRMED';
  } else if (sourceTrustTier === 'A' || sourceTrustTier === 'B') {
    confirmation = 'INITIAL_SIGNAL';
  } else if (hasEstimated) {
    confirmation = 'ESTIMATED_MODEL';
  }

  const latest = signals.reduce((acc, signal) => {
    if (parseMs(signal.timestamp) > parseMs(acc?.timestamp)) return signal;
    return acc;
  }, signals[0]);

  return {
    evidenceLinks: links,
    evidenceCount: links.length,
    sourcesDistinctCount: distinctSources.size,
    sourceTrustTier,
    verifiedAt: latest?.timestamp,
    confirmation,
  };
};

const buildTrustMeta = (signals: AlertSignal[]): AlertTrustMeta => {
  if (!signals.length) {
    return {
      status: 'UNKNOWN',
      updatedAt: undefined,
      conflict: false,
      sources: [],
      evidencePack: buildEvidencePack(signals),
    };
  }

  const latest = signals.reduce((acc, signal) => {
    if (parseMs(signal.timestamp) > parseMs(acc?.timestamp)) return signal;
    return acc;
  }, signals[0]);

  const sourceMap = new Map<string, AlertSignalSource>();
  signals.forEach(signal => {
    const name = String(signal.sourceName || '').trim();
    if (!name) return;
    const url = String(signal.sourceUrl || '').trim() || undefined;
    const key = `${name.toLowerCase()}|${String(url || '').toLowerCase()}`;
    const current = sourceMap.get(key);
    if (!current) {
      sourceMap.set(key, {
        name,
        url,
        officiality: signal.officiality,
        sourceClass: resolveSourceClass(signal.officiality, url),
        domain: mapMonitoringEventToDomain(signal.category),
        sourceType: inferSourceType(url),
      });
      return;
    }
    if (!current.url && url) {
      sourceMap.set(key, {
        ...current,
        url,
      });
    }
  });

  const byCategory = new Map<string, { min: number; max: number }>();
  signals.forEach(signal => {
    const category = toCategory(signal.category);
    const level = SEVERITY_RANK[signal.severity];
    const current = byCategory.get(category);
    if (!current) {
      byCategory.set(category, { min: level, max: level });
      return;
    }
    byCategory.set(category, {
      min: Math.min(current.min, level),
      max: Math.max(current.max, level),
    });
  });
  const conflict = Array.from(byCategory.values()).some(levels => levels.max - levels.min >= 2);

  return {
    status: normalizeFreshness(signals),
    updatedAt: latest?.timestamp,
    conflict,
    sources: Array.from(sourceMap.values()).slice(0, 6),
    evidencePack: buildEvidencePack(signals),
  };
};

const fetchFromConnectors = async (
  context: AlertIntelligenceContext,
): Promise<AlertSignal[]> => {
  const eligible = CONNECTORS.filter(connector => supportsCategory(connector, context.category));
  if (eligible.length === 0) return [];

  const results = await Promise.allSettled(
    eligible.map(connector =>
      connector.fetchSignals({
        latitude: context.latitude,
        longitude: context.longitude,
        category: context.category,
        scope: context.scope,
        force: context.force,
      }).then(signals => ({ connector, signals })),
    ),
  );

  const merged: AlertSignal[] = [];
  results.forEach(result => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value.signals)) return;
    const { connector, signals } = result.value;
    signals.forEach(signal => {
      const normalized = normalizeSignal(signal);
      if (!normalized) return;
      if (!isUrlAllowedByPolicy(normalized.sourceUrl, connector.policy)) return;
      merged.push(normalized);
    });
  });

  return dedupeSignals(merged).slice(0, MAX_SIGNALS);
};

const getFailureState = (key: string): FailureState => {
  const state = FAILURE_STATE_BY_KEY.get(key);
  if (state) return state;
  return { streak: 0, blockedUntilMs: 0 };
};

const recordFailure = (key: string) => {
  const current = getFailureState(key);
  const streak = current.streak + 1;
  FAILURE_STATE_BY_KEY.set(key, {
    streak,
    blockedUntilMs: Date.now() + nextBackoffMs(streak),
  });
};

const resetFailure = (key: string) => {
  FAILURE_STATE_BY_KEY.set(key, { streak: 0, blockedUntilMs: 0 });
};

const requestAndCache = async (
  key: string,
  context: AlertIntelligenceContext,
  fallbackSignals: AlertSignal[],
): Promise<AlertSignal[]> => {
  try {
    const signals = await fetchFromConnectors(context);
    CACHE_BY_KEY.set(key, {
      savedAtMs: Date.now(),
      ttlMs: inferTTL(signals, context.category),
      signals,
    });
    resetFailure(key);
    return signals;
  } catch {
    recordFailure(key);
    return fallbackSignals;
  }
};

export const AlertIntelligenceService = {
  async fetchRealtimeSignals(context: AlertIntelligenceContext): Promise<AlertSignal[]> {
    const key = buildKey(context);
    const forceRefresh = Boolean(context.force);
    const cached = CACHE_BY_KEY.get(key);
    const now = Date.now();
    const cachedSignals = cached?.signals || [];
    const failureState = getFailureState(key);
    const blockedByBackoff = failureState.blockedUntilMs > now;

    if (blockedByBackoff && !forceRefresh) {
      return cachedSignals;
    }

    if (!forceRefresh && cached && !isExpired(cached)) {
      return cachedSignals;
    }

    if (!forceRefresh && cached && isExpired(cached)) {
      if (!IN_FLIGHT_BY_KEY.has(key)) {
        const background = requestAndCache(key, { ...context, force: false }, cachedSignals).finally(
          () => {
            IN_FLIGHT_BY_KEY.delete(key);
          },
        );
        IN_FLIGHT_BY_KEY.set(key, background);
      }
      return cachedSignals;
    }

    if (forceRefresh) {
      const lastForce = LAST_FORCE_ATTEMPT_MS.get(key) || 0;
      const tooSoon = now - lastForce < FORCE_THROTTLE_MS;
      if (tooSoon && cachedSignals.length > 0) {
        return cachedSignals;
      }
      if (blockedByBackoff && tooSoon) {
        return cachedSignals;
      }
      LAST_FORCE_ATTEMPT_MS.set(key, now);
    }

    const inFlight = IN_FLIGHT_BY_KEY.get(key);
    if (inFlight) return inFlight;

    const request = requestAndCache(key, context, cachedSignals)
      .finally(() => {
        IN_FLIGHT_BY_KEY.delete(key);
      });

    IN_FLIGHT_BY_KEY.set(key, request);
    return request;
  },

  summarizeForUser(signals: AlertSignal[], locale: string): AlertAiSummary {
    return summarizeSignals(signals, locale);
  },

  getTrustMeta(signals: AlertSignal[]): AlertTrustMeta {
    return buildTrustMeta(signals);
  },

  getTrustBundle(signals: AlertSignal[]) {
    const trustMeta = buildTrustMeta(signals);
    return {
      status: trustMeta.status,
      updatedAt: trustMeta.updatedAt,
      conflict: trustMeta.conflict,
      sources: trustMeta.sources.map(source => ({
        name: source.name,
        url: source.url,
        officiality: source.officiality,
        sourceClass: source.sourceClass,
        sourceType: source.sourceType,
        domain: source.domain,
      })),
      evidencePack: trustMeta.evidencePack,
    };
  },
};

export default AlertIntelligenceService;
