import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';

import { ReverseGeocodeService, ReverseGeocodeResult } from './ReverseGeocodeService';
import { APP_CONFIG } from '../core/config';
import { normalizeToIsoDateTime } from '../utils/dateTimeFormat';

export type EpidemicWindow = '7d' | 'all';
export type EpidemicMode = 'pandemic' | 'epidemic';

export type EpidemicSource = {
  name: string;
  url: string;
  tier: 1 | 2 | 3;
  authorityLevel: 'WHO' | 'federal' | 'state' | 'municipal';
};

export type EpidemicLevel = {
  name: string;
  cases: number | null;
  deaths: number | null;
};

export type EpidemicSnapshot = {
  enabled: boolean;
  disease: { id: string; name: string };
  mode?: EpidemicMode;
  window: EpidemicWindow;
  country: EpidemicLevel;
  state: EpidemicLevel;
  municipal: EpidemicLevel;
  asOf: string;
  fetchedAt: string;
  stalenessSec: number;
  status: 'FRESH' | 'STALE' | 'UNKNOWN';
  sources: EpidemicSource[];
  message?: string;
};

type EpidemicFeed = {
  available: boolean;
  sourceTier: 1 | 2 | 3;
  disease: { id: string; name: string };
  rollups: {
    country: { name: string; metrics: Record<string, number | null>; trend: string | null; asOf: string };
    state: { name: string; metrics: Record<string, number | null>; trend: string | null; asOf: string };
    municipal: { name: string; metrics: Record<string, number | null>; trend: string | null; asOf: string };
  };
  mapData?: { kind: string; items: any[] };
  freshness: {
    asOf: string;
    fetchedAt: string;
    stalenessSec: number;
    status: 'FRESH' | 'STALE' | 'UNKNOWN';
    refreshPolicy: 'AUTO_60S' | 'AUTO_5M' | 'MANUAL';
  };
  sources: EpidemicSource[];
  confidence: number;
};

type CacheEntry = {
  ts: number;
  data: EpidemicSnapshot;
};

const CACHE_PREFIX = '@Alert:Epidemic:v1:';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const MODE_DISEASE: Record<EpidemicMode, { id: string; name: string }> = {
  pandemic: { id: 'covid19', name: 'COVID-19' },
  epidemic: { id: 'influenza', name: 'Influenza' },
};

const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const safeNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const buildWindowRange = (window: EpidemicWindow, end: Date) => {
  if (window === 'all') return null;
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  const endCopy = new Date(end);
  endCopy.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: endCopy.toISOString() };
};

const getApiBaseUrl = () => {
  const globalOverride = (globalThis as any)?.ALERT_API_URL || (globalThis as any)?.__ALERT_API_URL__;
  const envOverride = typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return (globalOverride || envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const buildFeedUrl = (params: {
  country: string;
  admin1?: string;
  city?: string;
  disease: string;
  metric: string;
  window: string;
  normalize: string;
}) => {
  const base = getApiBaseUrl();
  if (!base) return '';
  const trim = base.endsWith('/') ? base.slice(0, -1) : base;
  const query = [
    `country=${encodeURIComponent(params.country)}`,
    params.admin1 ? `admin1=${encodeURIComponent(params.admin1)}` : null,
    params.city ? `city=${encodeURIComponent(params.city)}` : null,
    `disease=${encodeURIComponent(params.disease)}`,
    `metric=${encodeURIComponent(params.metric)}`,
    `window=${encodeURIComponent(params.window)}`,
    `normalize=${encodeURIComponent(params.normalize)}`,
  ]
    .filter(Boolean)
    .join('&');
  return `${trim}/v1/epidemic/feed?${query}`;
};

const fetchBackendFeed = async (params: {
  country: string;
  admin1?: string;
  city?: string;
  disease: string;
  metric: string;
  window: EpidemicWindow;
}): Promise<EpidemicFeed | null> => {
  const url = buildFeedUrl({
    country: params.country,
    admin1: params.admin1,
    city: params.city,
    disease: params.disease,
    metric: params.metric,
    window: params.window,
    normalize: 'count',
  });
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as EpidemicFeed;
    if (!json || typeof json !== 'object') return null;
    return json;
  } catch {
    return null;
  }
};

const mapFeedToSnapshot = (
  feed: EpidemicFeed,
  window: EpidemicWindow,
  fallbackDisease: { id: string; name: string },
  mode: EpidemicMode,
): EpidemicSnapshot => {
  const safeValue = (value: unknown) => safeNumber(value);
  const safeText = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  const normalizedAsOf = normalizeToIsoDateTime(feed?.freshness?.asOf);
  const normalizedFetchedAt =
    normalizeToIsoDateTime(feed?.freshness?.fetchedAt) || new Date().toISOString();

  return {
    enabled: Boolean(feed?.available),
    disease: feed?.disease || fallbackDisease,
    mode,
    window,
    country: {
      name: safeText(feed?.rollups?.country?.name, 'Country'),
      cases: safeValue(feed?.rollups?.country?.metrics?.cases),
      deaths: safeValue(feed?.rollups?.country?.metrics?.deaths),
    },
    state: {
      name: safeText(feed?.rollups?.state?.name, 'State'),
      cases: safeValue(feed?.rollups?.state?.metrics?.cases),
      deaths: safeValue(feed?.rollups?.state?.metrics?.deaths),
    },
    municipal: {
      name: safeText(feed?.rollups?.municipal?.name, 'City'),
      cases: safeValue(feed?.rollups?.municipal?.metrics?.cases),
      deaths: safeValue(feed?.rollups?.municipal?.metrics?.deaths),
    },
    asOf: normalizedAsOf,
    fetchedAt: normalizedFetchedAt,
    stalenessSec: Number.isFinite(feed?.freshness?.stalenessSec) ? feed.freshness.stalenessSec : 0,
    status: feed?.freshness?.status || 'UNKNOWN',
    sources: Array.isArray(feed?.sources) ? feed.sources : [],
    message: feed?.available ? undefined : 'No official epidemic feed configured yet.',
  };
};

// --- Brazil (Ministry of Health / e-SUS Notifica) ---
const NOTIFICA_BASE_URL = 'https://notifica-prd-es.saude.gov.br';
const NOTIFICA_BASIC = 'user-public-notificacoes:Za4qNXdyQNSa9YaA';
const NOTIFICA_AUTH_HEADER = `Basic ${Buffer.from(NOTIFICA_BASIC, 'utf8').toString('base64')}`;

const BR_CONFIRMED_CLASSIFICATIONS = [
  'Confirmado Laboratorial',
  'Confirmado Clínico-Epidemiológico',
  'Confirmado por Critério Clínico',
  'Confirmado Clínico-Imagem',
  'Confirmação Laboratorial',
];

const BRAZIL_UF_BY_STATE_KEY: Record<string, string> = {
  'acre': 'ac',
  'alagoas': 'al',
  'amapa': 'ap',
  'amazonas': 'am',
  'bahia': 'ba',
  'ceara': 'ce',
  'distrito federal': 'df',
  'espirito santo': 'es',
  'goias': 'go',
  'maranhao': 'ma',
  'mato grosso': 'mt',
  'mato grosso do sul': 'ms',
  'minas gerais': 'mg',
  'para': 'pa',
  'paraiba': 'pb',
  'parana': 'pr',
  'pernambuco': 'pe',
  'piaui': 'pi',
  'rio de janeiro': 'rj',
  'rio grande do norte': 'rn',
  'rio grande do sul': 'rs',
  'rondonia': 'ro',
  'roraima': 'rr',
  'santa catarina': 'sc',
  'sao paulo': 'sp',
  'sergipe': 'se',
  'tocantins': 'to',
};

const resolveBrazilUf = (geo: ReverseGeocodeResult): string | null => {
  const iso = geo.isoStateCode;
  if (iso && typeof iso === 'string' && iso.toUpperCase().startsWith('BR-')) {
    const uf = iso.slice(3, 5).toLowerCase();
    if (uf.length === 2) return uf;
  }
  const key = geo.stateName ? normalizeKey(geo.stateName) : '';
  return key ? BRAZIL_UF_BY_STATE_KEY[key] || null : null;
};

const notificaFetchCount = async (
  index: string,
  query: unknown,
): Promise<number | null> => {
  try {
    const res = await fetch(`${NOTIFICA_BASE_URL}/${index}/_count`, {
      method: 'POST',
      headers: {
        Authorization: NOTIFICA_AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return safeNumber(json?.count);
  } catch {
    return null;
  }
};

const buildBrazilQuery = (params: {
  window: EpidemicWindow;
  end: Date;
  stateName?: string | null;
  municipalName?: string | null;
  kind: 'cases' | 'deaths';
}) => {
  const filters: any[] = [
    { term: { registroAtual: true } },
    { terms: { 'classificacaoFinal.keyword': BR_CONFIRMED_CLASSIFICATIONS } },
  ];

  if (params.kind === 'deaths') {
    filters.push({ term: { 'evolucaoCaso.keyword': 'Óbito' } });
  }

  const range = buildWindowRange(params.window, params.end);
  if (range) {
    filters.push({ range: { dataNotificacao: { gte: range.startIso, lte: range.endIso } } });
  }

  if (params.stateName) {
    const raw = params.stateName.trim();
    const alt = normalizeKey(raw);
    const altTitle = alt
      .split(' ')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    filters.push({
      bool: {
        should: [
          { term: { 'estadoNotificacao.keyword': raw } },
          raw !== altTitle ? { term: { 'estadoNotificacao.keyword': altTitle } } : undefined,
        ].filter(Boolean),
        minimum_should_match: 1,
      },
    });
  }

  if (params.municipalName) {
    const raw = params.municipalName.trim();
    const alt = normalizeKey(raw);
    const altTitle = alt
      .split(' ')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    filters.push({
      bool: {
        should: [
          { term: { 'municipioNotificacao.keyword': raw } },
          raw !== altTitle ? { term: { 'municipioNotificacao.keyword': altTitle } } : undefined,
        ].filter(Boolean),
        minimum_should_match: 1,
      },
    });
  }

  return { bool: { filter: filters } };
};

const getBrazilCovidSnapshot = async (
  geo: ReverseGeocodeResult,
  window: EpidemicWindow,
): Promise<EpidemicSnapshot> => {
  const fetchedAt = new Date();
  const end = fetchedAt;
  const asOf = end.toISOString();

  const uf = resolveBrazilUf(geo);
  const stateIndex = uf ? `desc-esus-notifica-estado-${uf}` : null;
  const nationalIndex = 'desc-esus-notifica-estado-*';

  const stateName = geo.stateName || null;
  const municipalName = geo.cityName || null;

  const sources: EpidemicSource[] = [
    {
      name: 'Ministerio da Saude (e-SUS Notifica)',
      url: 'https://notifica.saude.gov.br/',
      tier: 1,
      authorityLevel: 'federal',
    },
  ];

  // National (Brazil)
  const countryCases = await notificaFetchCount(
    nationalIndex,
    buildBrazilQuery({ window, end, kind: 'cases' }),
  );
  const countryDeaths = await notificaFetchCount(
    nationalIndex,
    buildBrazilQuery({ window, end, kind: 'deaths' }),
  );

  // State
  const stateCases = stateIndex
    ? await notificaFetchCount(stateIndex, buildBrazilQuery({ window, end, kind: 'cases' }))
    : stateName
      ? await notificaFetchCount(
          nationalIndex,
          buildBrazilQuery({ window, end, stateName, kind: 'cases' }),
        )
      : null;
  const stateDeaths = stateIndex
    ? await notificaFetchCount(stateIndex, buildBrazilQuery({ window, end, kind: 'deaths' }))
    : stateName
      ? await notificaFetchCount(
          nationalIndex,
          buildBrazilQuery({ window, end, stateName, kind: 'deaths' }),
        )
      : null;

  // Municipal (inside state when possible)
  const municipalCases =
    stateIndex && municipalName
      ? await notificaFetchCount(
          stateIndex,
          buildBrazilQuery({ window, end, municipalName, kind: 'cases' }),
        )
      : stateName && municipalName
        ? await notificaFetchCount(
            nationalIndex,
            buildBrazilQuery({ window, end, stateName, municipalName, kind: 'cases' }),
          )
        : null;

  const municipalDeaths =
    stateIndex && municipalName
      ? await notificaFetchCount(
          stateIndex,
          buildBrazilQuery({ window, end, municipalName, kind: 'deaths' }),
        )
      : stateName && municipalName
        ? await notificaFetchCount(
            nationalIndex,
            buildBrazilQuery({ window, end, stateName, municipalName, kind: 'deaths' }),
          )
        : null;

  const hasAny =
    [countryCases, countryDeaths, stateCases, stateDeaths, municipalCases, municipalDeaths].some(
      value => typeof value === 'number',
    );

  return {
    enabled: true,
    disease: { id: 'covid19', name: 'COVID-19' },
    window,
    country: { name: geo.countryName || 'Brasil', cases: countryCases, deaths: countryDeaths },
    state: { name: stateName || 'State', cases: stateCases, deaths: stateDeaths },
    municipal: { name: municipalName || 'City', cases: municipalCases, deaths: municipalDeaths },
    asOf,
    fetchedAt: fetchedAt.toISOString(),
    stalenessSec: 0,
    status: hasAny ? 'FRESH' : 'UNKNOWN',
    sources,
    message: hasAny ? undefined : 'No epidemic data available for this location.',
  };
};

// --- WHO fallback (country-level only) ---
const WHO_CSV_URL = 'https://covid19.who.int/WHO-COVID-19-global-data.csv';

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

type WhoRow = {
  date: string;
  countryCode: string;
  country: string;
  newCases: number;
  cumCases: number;
  newDeaths: number;
  cumDeaths: number;
};

const parseWhoCsv = (csv: string): WhoRow[] => {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const idx = {
    date: header.indexOf('Date_reported'),
    code: header.indexOf('Country_code'),
    country: header.indexOf('Country'),
    newCases: header.indexOf('New_cases'),
    cumCases: header.indexOf('Cumulative_cases'),
    newDeaths: header.indexOf('New_deaths'),
    cumDeaths: header.indexOf('Cumulative_deaths'),
  };
  if (Object.values(idx).some(v => v < 0)) return [];

  const rows: WhoRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < header.length) continue;
    const row: WhoRow = {
      date: cols[idx.date],
      countryCode: cols[idx.code],
      country: cols[idx.country],
      newCases: Number(cols[idx.newCases] || 0),
      cumCases: Number(cols[idx.cumCases] || 0),
      newDeaths: Number(cols[idx.newDeaths] || 0),
      cumDeaths: Number(cols[idx.cumDeaths] || 0),
    };
    rows.push(row);
  }
  return rows;
};

const fetchWhoCsv = async (): Promise<string | null> => {
  try {
    const res = await fetch(WHO_CSV_URL);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

const getWhoCovidSnapshot = async (
  geo: ReverseGeocodeResult,
  window: EpidemicWindow,
): Promise<EpidemicSnapshot> => {
  const fetchedAt = new Date();
  const asOf = fetchedAt.toISOString();

  const csv = await fetchWhoCsv();
  if (!csv) {
    return {
      enabled: true,
      disease: { id: 'covid19', name: 'COVID-19' },
      window,
      country: { name: geo.countryName || 'Country', cases: null, deaths: null },
      state: { name: geo.stateName || 'State', cases: null, deaths: null },
      municipal: { name: geo.cityName || 'City', cases: null, deaths: null },
      asOf,
      fetchedAt: fetchedAt.toISOString(),
      stalenessSec: 0,
      status: 'UNKNOWN',
      sources: [
        { name: 'WHO COVID-19 dashboard', url: 'https://covid19.who.int/', tier: 1, authorityLevel: 'WHO' },
      ],
      message: 'Could not load WHO data.',
    };
  }

  const rows = parseWhoCsv(csv);
  const code = (geo.countryCode || '').toUpperCase();
  const filtered = rows.filter(r => (r.countryCode || '').toUpperCase() === code);
  if (filtered.length === 0) {
    return {
      enabled: true,
      disease: { id: 'covid19', name: 'COVID-19' },
      window,
      country: { name: geo.countryName || 'Country', cases: null, deaths: null },
      state: { name: geo.stateName || 'State', cases: null, deaths: null },
      municipal: { name: geo.cityName || 'City', cases: null, deaths: null },
      asOf,
      fetchedAt: fetchedAt.toISOString(),
      stalenessSec: 0,
      status: 'UNKNOWN',
      sources: [
        { name: 'WHO COVID-19 dashboard', url: 'https://covid19.who.int/', tier: 1, authorityLevel: 'WHO' },
      ],
      message: 'No WHO data for this country code.',
    };
  }

  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const latest = filtered[filtered.length - 1];
  const latestDate = new Date(`${latest.date}T00:00:00Z`);
  const range = buildWindowRange(window, latestDate);

  let cases: number | null = null;
  let deaths: number | null = null;
  let effectiveAsOf = latest.date;

  if (window === 'all') {
    cases = safeNumber(latest.cumCases);
    deaths = safeNumber(latest.cumDeaths);
  } else if (range) {
    const startYmd = range.startIso.slice(0, 10);
    const endYmd = range.endIso.slice(0, 10);
    const windowRows = filtered.filter(r => r.date >= startYmd && r.date <= endYmd);
    cases = windowRows.reduce((acc, r) => acc + (Number.isFinite(r.newCases) ? r.newCases : 0), 0);
    deaths = windowRows.reduce((acc, r) => acc + (Number.isFinite(r.newDeaths) ? r.newDeaths : 0), 0);
    effectiveAsOf = endYmd;
  }

  const sources: EpidemicSource[] = [
    { name: 'WHO COVID-19 dashboard', url: 'https://covid19.who.int/', tier: 1, authorityLevel: 'WHO' },
  ];

  return {
    enabled: true,
    disease: { id: 'covid19', name: 'COVID-19' },
    window,
    country: { name: latest.country || geo.countryName || 'Country', cases, deaths },
    state: { name: geo.stateName || 'State', cases: null, deaths: null },
    municipal: { name: geo.cityName || 'City', cases: null, deaths: null },
    asOf: `${effectiveAsOf}T00:00:00.000Z`,
    fetchedAt: fetchedAt.toISOString(),
    stalenessSec: 0,
    status: 'FRESH',
    sources,
    message: undefined,
  };
};

// --- Public API ---
export const EpidemicService = {
  async getSnapshot(
    lat: number,
    lon: number,
    mode: EpidemicMode,
    window: EpidemicWindow,
    options?: { force?: boolean },
  ): Promise<EpidemicSnapshot> {
    const geo = await ReverseGeocodeService.reverse(lat, lon, { force: options?.force });
    const fetchedAt = new Date();
    const disease = MODE_DISEASE[mode];

    if (!geo?.countryCode) {
      return {
        enabled: false,
        disease,
        mode,
        window,
        country: { name: 'Country', cases: null, deaths: null },
        state: { name: 'State', cases: null, deaths: null },
        municipal: { name: 'City', cases: null, deaths: null },
        asOf: '',
        fetchedAt: fetchedAt.toISOString(),
        stalenessSec: 0,
        status: 'UNKNOWN',
        sources: [],
        message: 'Location unavailable.',
      };
    }

    const cacheCity =
      mode === 'epidemic' ? geo.countyName || geo.cityName || '' : geo.cityName || '';
    const cacheKey = `${CACHE_PREFIX}${mode}:${geo.countryCode}:${geo.stateName || ''}:${cacheCity}:${window}`;
    if (!options?.force) {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as CacheEntry;
          if (cached?.ts && cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
            const stalenessSec = Math.max(0, Math.floor((Date.now() - cached.ts) / 1000));
            return { ...cached.data, stalenessSec };
          }
        }
      } catch {
        // ignore cache errors
      }
    }

    const countryCode = (geo.countryCode || '').toUpperCase();
    const admin1 = geo.isoStateCode || geo.stateName || undefined;
    const city = mode === 'epidemic' ? geo.countyName || geo.cityName || undefined : geo.cityName || undefined;

    const backendFeed = await fetchBackendFeed({
      country: countryCode,
      admin1,
      city,
      disease: disease.id,
      metric: 'cases',
      window,
    });

    if (backendFeed) {
      const mapped = mapFeedToSnapshot(backendFeed, window, disease, mode);
      if (backendFeed.available) {
        try {
          const entry: CacheEntry = { ts: Date.now(), data: mapped };
          await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
        } catch {
          // ignore cache write errors
        }
        return mapped;
      }
      return mapped;
    }

    if (mode !== 'pandemic') {
      return {
        enabled: false,
        disease,
        mode,
        window,
        country: { name: geo.countryName || 'Country', cases: null, deaths: null },
        state: { name: geo.stateName || 'State', cases: null, deaths: null },
        municipal: { name: geo.cityName || 'City', cases: null, deaths: null },
        asOf: '',
        fetchedAt: fetchedAt.toISOString(),
        stalenessSec: 0,
        status: 'UNKNOWN',
        sources: [],
        message: 'No official epidemic feed configured yet.',
      };
    }

    const snapshot =
      geo.countryCode.toLowerCase() === 'br'
        ? await getBrazilCovidSnapshot(geo, window)
        : await getWhoCovidSnapshot(geo, window);

    try {
      const entry: CacheEntry = { ts: Date.now(), data: snapshot };
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
      // ignore cache write errors
    }

    return snapshot;
  },

  async getCovidSnapshot(
    lat: number,
    lon: number,
    window: EpidemicWindow,
    options?: { force?: boolean },
  ): Promise<EpidemicSnapshot> {
    return await EpidemicService.getSnapshot(lat, lon, 'pandemic', window, options);
  },
};
