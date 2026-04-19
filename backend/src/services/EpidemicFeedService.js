const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getRuntimeConfig } = require('../config/runtime');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ISO_DIR = path.join(DATA_DIR, 'iso3166');
const EPIDEMIC_DIR = path.join(DATA_DIR, 'epidemic');

const WHO_CSV_URL = 'https://srhdpeuwpubsa.blob.core.windows.net/whdh/COVID/WHO-COVID-19-global-data.csv';
const WHO_SOURCE = {
  name: 'World Health Organization COVID-19 Dashboard',
  url: 'https://data.who.int/dashboards/covid19/data',
  tier: 1,
  authorityLevel: 'WHO',
};
const DATA_USER_AGENT = 'AlertApp/1.0 (contact: support@alertapp.com)';

const NY_FLU_RESOURCE_URL = 'https://health.data.ny.gov/resource/jr8b-6gh6.json';
const CA_RV_RESOURCE_ID = '00a147ba-0410-4699-9e34-fd18bbb7017d';
const CA_RV_API_BASE = 'https://data.chhs.ca.gov/api/3/action/datastore_search';

const BRAZIL_UF_BY_STATE_KEY = {
  acre: 'ac',
  alagoas: 'al',
  amapa: 'ap',
  amazonas: 'am',
  bahia: 'ba',
  ceara: 'ce',
  'distrito federal': 'df',
  'espirito santo': 'es',
  goias: 'go',
  maranhao: 'ma',
  'mato grosso': 'mt',
  'mato grosso do sul': 'ms',
  'minas gerais': 'mg',
  para: 'pa',
  paraiba: 'pb',
  parana: 'pr',
  pernambuco: 'pe',
  piaui: 'pi',
  'rio de janeiro': 'rj',
  'rio grande do norte': 'rn',
  'rio grande do sul': 'rs',
  rondonia: 'ro',
  roraima: 'rr',
  'santa catarina': 'sc',
  'sao paulo': 'sp',
  sergipe: 'se',
  tocantins: 'to',
};

const BR_CONFIRMED_CLASSIFICATIONS = [
  'Confirmado Laboratorial',
  'Confirmado Clínico-Epidemiológico',
  'Confirmado por Critério Clínico',
  'Confirmado Clínico-Imagem',
  'Confirmação Laboratorial',
];

const WHO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_STALENESS_SEC = 7 * 24 * 60 * 60;

let cachedCountries = null;
let cachedRegistry = null;
let cachedVersion = null;
let whoCache = { fetchedAt: 0, rows: [] };

const loadJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const getCountries = () => {
  if (!cachedCountries) {
    cachedCountries = loadJson(path.join(ISO_DIR, 'countries.json'));
  }
  return cachedCountries;
};

const getRegistry = () => {
  if (!cachedRegistry) {
    cachedRegistry = loadJson(path.join(EPIDEMIC_DIR, 'registry.json'));
  }
  return cachedRegistry;
};

const getVersion = () => {
  if (!cachedVersion) {
    cachedVersion = loadJson(path.join(ISO_DIR, 'version.json'));
  }
  return cachedVersion;
};

const normalizeKey = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const safeNumber = value => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const isOfficialDomain = url => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('.int')) return true;
    if (host.endsWith('.gov')) return true;
    if (/\.(gov|gob|gouv|go|govt)\.[a-z]{2}$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
};

const hasBadToken = text => {
  const value = String(text || '');
  return value.includes('official.example') || value.includes('OFFICIAL_') || value.includes('Country X');
};

const ensureOfficialSources = sources =>
  Array.isArray(sources) && sources.length > 0 && sources.every(s => isOfficialDomain(s.url));

const validateEpidemicFeed = payload => {
  const hasFreshness =
    payload &&
    payload.freshness &&
    typeof payload.freshness.asOf === 'string' &&
    payload.freshness.asOf.length > 0 &&
    typeof payload.freshness.fetchedAt === 'string' &&
    payload.freshness.fetchedAt.length > 0 &&
    Number.isFinite(payload.freshness.stalenessSec) &&
    typeof payload.freshness.status === 'string' &&
    typeof payload.freshness.refreshPolicy === 'string';

  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const hasSources = sources.length >= 1;
  const officialSources = ensureOfficialSources(sources);
  const hasPlaceholders = sources.some(src => hasBadToken(src?.name) || hasBadToken(src?.url));

  if (payload?.available === true && (!hasFreshness || !hasSources || !officialSources || hasPlaceholders)) {
    return {
      ...payload,
      available: false,
      sources: [],
      freshness: {
        asOf: '',
        fetchedAt: '',
        stalenessSec: 0,
        status: 'UNKNOWN',
        refreshPolicy: 'MANUAL',
      },
    };
  }

  if (payload?.available === false) {
    return {
      ...payload,
      sources: [],
      freshness: {
        asOf: payload?.freshness?.asOf || '',
        fetchedAt: payload?.freshness?.fetchedAt || '',
        stalenessSec: Number.isFinite(payload?.freshness?.stalenessSec)
          ? payload.freshness.stalenessSec
          : 0,
        status: payload?.freshness?.asOf ? 'STALE' : 'UNKNOWN',
        refreshPolicy: payload?.freshness?.refreshPolicy || 'MANUAL',
      },
    };
  }

  return payload;
};

const fetchText = (url, options = {}) => {
  if (typeof fetch === 'function') {
    return fetch(url, options).then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  }

  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      res => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      },
    );
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
};

const fetchJson = async (url, options = {}) => {
  const text = await fetchText(url, options);
  return JSON.parse(text);
};

const buildQueryString = params =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

const fetchNyFluLatest = async () => {
  const query = buildQueryString({
    '$select': 'weekendingdate,season',
    '$order': 'weekendingdate desc',
    '$limit': 1,
  });
  const url = `${NY_FLU_RESOURCE_URL}?${query}`;
  const rows = await fetchJson(url, { headers: { 'User-Agent': DATA_USER_AGENT } });
  return Array.isArray(rows) ? rows[0] : null;
};

const fetchNyFluWeekDates = async count => {
  const query = buildQueryString({
    '$select': 'weekendingdate',
    '$order': 'weekendingdate desc',
    '$limit': count,
  });
  const url = `${NY_FLU_RESOURCE_URL}?${query}`;
  const rows = await fetchJson(url, { headers: { 'User-Agent': DATA_USER_AGENT } });
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => row?.weekendingdate)
    .filter(value => typeof value === 'string' && value.length > 0);
};

const fetchNyFluSum = async whereClause => {
  const query = buildQueryString({
    '$select': 'sum(count) as cases',
    '$where': whereClause,
  });
  const url = `${NY_FLU_RESOURCE_URL}?${query}`;
  const rows = await fetchJson(url, { headers: { 'User-Agent': DATA_USER_AGENT } });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return safeNumber(rows[0]?.cases);
};

const buildNyWindowWhere = async (window, latestDate, season) => {
  if (window === 'all' && season) {
    return `season='${season}'`;
  }
  const days = window === 'all' ? 7 : Number(window.replace('d', '')) || 7;
  const weeks = Math.max(1, Math.round(days / 7));
  const dates = await fetchNyFluWeekDates(weeks);
  if (dates.length === 0 && latestDate) {
    return `weekendingdate='${latestDate}'`;
  }
  const clauses = dates.map(date => `weekendingdate='${date}'`);
  return clauses.length > 0 ? `(${clauses.join(' OR ')})` : `weekendingdate='${latestDate}'`;
};

const fetchCkanRecords = async (filters, options = {}) => {
  const params = buildQueryString({
    resource_id: CA_RV_RESOURCE_ID,
    filters: JSON.stringify(filters || {}),
    limit: options.limit || 500,
    offset: options.offset || 0,
    sort: options.sort,
  });
  const url = `${CA_RV_API_BASE}?${params}`;
  const json = await fetchJson(url, { headers: { 'User-Agent': DATA_USER_AGENT } });
  const records = json?.result?.records;
  return Array.isArray(records) ? records : [];
};

const resolveCaRegion = raw => {
  const key = normalizeKey(raw || '').replace(' county', '');
  if (!key) return null;
  if (key.includes('los angeles')) return 'Los Angeles';
  if (
    key.includes('orange') ||
    key.includes('san diego') ||
    key.includes('riverside') ||
    key.includes('san bernardino') ||
    key.includes('ventura') ||
    key.includes('imperial')
  ) {
    return 'Southern California';
  }
  if (
    key.includes('san francisco') ||
    key.includes('san jose') ||
    key.includes('oakland') ||
    key.includes('alameda') ||
    key.includes('contra costa') ||
    key.includes('san mateo') ||
    key.includes('santa clara') ||
    key.includes('marin') ||
    key.includes('sonoma') ||
    key.includes('napa')
  ) {
    return 'Bay Area';
  }
  if (
    key.includes('sacramento') ||
    key.includes('placer') ||
    key.includes('el dorado') ||
    key.includes('yolo') ||
    key.includes('nevada') ||
    key.includes('sutter') ||
    key.includes('yuba')
  ) {
    return 'Greater Sierra-Sacramento';
  }
  if (
    key.includes('fresno') ||
    key.includes('kern') ||
    key.includes('tulare') ||
    key.includes('stanislaus') ||
    key.includes('merced') ||
    key.includes('san joaquin')
  ) {
    return 'Central California';
  }
  if (
    key.includes('shasta') ||
    key.includes('butte') ||
    key.includes('humboldt') ||
    key.includes('mendocino') ||
    key.includes('del norte') ||
    key.includes('lassen') ||
    key.includes('siskiyou')
  ) {
    return 'Rural North';
  }
  return null;
};

const splitCsvLine = line => {
  const out = [];
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

const parseWhoCsv = csv => {
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

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < header.length) continue;
    rows.push({
      date: cols[idx.date],
      countryCode: cols[idx.code],
      country: cols[idx.country],
      newCases: Number(cols[idx.newCases] || 0),
      cumCases: Number(cols[idx.cumCases] || 0),
      newDeaths: Number(cols[idx.newDeaths] || 0),
      cumDeaths: Number(cols[idx.cumDeaths] || 0),
    });
  }
  return rows;
};

const fetchWhoRows = async () => {
  const now = Date.now();
  if (whoCache.rows.length > 0 && now - whoCache.fetchedAt < WHO_CACHE_TTL_MS) {
    return whoCache;
  }
  const csv = await fetchText(WHO_CSV_URL);
  const rows = parseWhoCsv(csv);
  whoCache = { fetchedAt: now, rows };
  return whoCache;
};

const buildWindowRange = (window, end) => {
  if (window === 'all') return null;
  const days = Number(window.replace('d', '')) || 7;
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const endCopy = new Date(end);
  endCopy.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString().slice(0, 10), endIso: endCopy.toISOString().slice(0, 10) };
};

const computeTrend = (rows, metricKey, windowDays) => {
  if (!windowDays || rows.length < windowDays * 2) return null;
  const last = rows[rows.length - 1];
  if (!last?.date) return null;
  const end = new Date(`${last.date}T00:00:00Z`);
  const range = buildWindowRange(`${windowDays}d`, end);
  if (!range) return null;
  const prevEnd = new Date(end);
  prevEnd.setDate(prevEnd.getDate() - windowDays);
  const prevRange = buildWindowRange(`${windowDays}d`, prevEnd);
  if (!prevRange) return null;

  const sumFor = (from, to) =>
    rows
      .filter(r => r.date >= from && r.date <= to)
      .reduce((acc, r) => acc + (Number.isFinite(r[metricKey]) ? r[metricKey] : 0), 0);

  const current = sumFor(range.startIso, range.endIso);
  const previous = sumFor(prevRange.startIso, prevRange.endIso);

  if (previous === 0 && current === 0) return 'flat';
  if (previous === 0 && current > 0) return 'up';
  const change = (current - previous) / Math.max(1, Math.abs(previous));
  if (change > 0.05) return 'up';
  if (change < -0.05) return 'down';
  return 'flat';
};

const buildUnavailable = (ctx, reason = '') => ({
  available: false,
  sourceTier: 3,
  disease: { id: ctx.disease, name: ctx.diseaseName },
  rollups: {
    country: { name: ctx.countryName, metrics: emptyMetrics(), trend: null, asOf: '' },
    state: { name: ctx.admin1 || '', metrics: emptyMetrics(), trend: null, asOf: '' },
    municipal: { name: ctx.city || '', metrics: emptyMetrics(), trend: null, asOf: '' },
  },
  mapData: { kind: 'choropleth', items: [] },
  freshness: { asOf: '', fetchedAt: '', stalenessSec: 0, status: 'UNKNOWN', refreshPolicy: 'MANUAL' },
  sources: [],
  confidence: 0,
  reason,
});

const emptyMetrics = () => ({
  cases: null,
  deaths: null,
  hospitalizations: null,
  positivity: null,
});

const buildWhoFeed = async ctx => {
  const { rows, fetchedAt } = await fetchWhoRows();
  const code = ctx.country.toUpperCase();
  const series = rows.filter(r => (r.countryCode || '').toUpperCase() === code);
  if (series.length === 0) return buildUnavailable(ctx, 'no_who_rows');

  series.sort((a, b) => a.date.localeCompare(b.date));
  const latest = series[series.length - 1];
  const end = new Date(`${latest.date}T00:00:00Z`);
  const range = buildWindowRange(ctx.window, end);

  let cases = null;
  let deaths = null;

  if (ctx.window === 'all') {
    cases = safeNumber(latest.cumCases);
    deaths = safeNumber(latest.cumDeaths);
  } else if (range) {
    cases = series
      .filter(r => r.date >= range.startIso && r.date <= range.endIso)
      .reduce((acc, r) => acc + (Number.isFinite(r.newCases) ? r.newCases : 0), 0);
    deaths = series
      .filter(r => r.date >= range.startIso && r.date <= range.endIso)
      .reduce((acc, r) => acc + (Number.isFinite(r.newDeaths) ? r.newDeaths : 0), 0);
  }

  const metricKey = ctx.metric === 'deaths' ? 'newDeaths' : 'newCases';
  const windowDays = ctx.window === 'all' ? null : Number(ctx.window.replace('d', '')) || 7;
  const trend = computeTrend(series, metricKey, windowDays);

  const asOf = `${latest.date}T00:00:00.000Z`;
  const now = Date.now();
  const stalenessSec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  const asOfAgeSec = Math.max(0, Math.floor((now - new Date(asOf).getTime()) / 1000));
  const status = asOfAgeSec > MAX_STALENESS_SEC ? 'STALE' : 'FRESH';

  return {
    available: true,
    sourceTier: 1,
    disease: { id: ctx.disease, name: ctx.diseaseName },
    rollups: {
      country: {
        name: latest.country || ctx.countryName,
        metrics: { ...emptyMetrics(), cases, deaths },
        trend,
        asOf,
      },
      state: { name: ctx.admin1 || '', metrics: emptyMetrics(), trend: null, asOf },
      municipal: { name: ctx.city || '', metrics: emptyMetrics(), trend: null, asOf },
    },
    mapData: { kind: 'choropleth', items: [] },
    freshness: {
      asOf,
      fetchedAt: new Date(fetchedAt).toISOString(),
      stalenessSec,
      status,
      refreshPolicy: 'AUTO_5M',
    },
    sources: [WHO_SOURCE],
    confidence: 0.6,
  };
};

const resolveBrazilUf = admin1 => {
  if (!admin1) return null;
  const raw = String(admin1).trim();
  const iso = raw.toUpperCase();
  if (/^BR-[A-Z]{2}$/.test(iso)) return iso.slice(3, 5).toLowerCase();
  if (/^[A-Z]{2}$/.test(iso)) return iso.toLowerCase();
  const key = normalizeKey(raw);
  return BRAZIL_UF_BY_STATE_KEY[key] || null;
};

const isUsState = (admin1, code) => {
  if (!admin1) return false;
  const raw = String(admin1).trim().toUpperCase();
  if (raw === code) return true;
  if (raw === `US-${code}`) return true;
  const key = normalizeKey(admin1);
  if (code === 'NY') return key === 'new york' || key === 'newyork';
  if (code === 'CA') return key === 'california';
  return false;
};

const buildBrazilQuery = params => {
  const filters = [
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

const getNotificaConfig = config => {
  const runtimeConfig = config || getRuntimeConfig();
  const basicAuth = String(runtimeConfig?.epidemic?.notificaBasicAuth || '').trim();
  if (!basicAuth) {
    return null;
  }
  return {
    baseUrl: String(runtimeConfig?.epidemic?.notificaBaseUrl || '').trim(),
    authHeader: `Basic ${Buffer.from(basicAuth, 'utf8').toString('base64')}`,
  };
};

const notificaFetchCount = async (index, query, config) => {
  const providerConfig = getNotificaConfig(config);
  if (!providerConfig?.baseUrl || !providerConfig?.authHeader) {
    return null;
  }
  try {
    const json = await fetchJson(`${providerConfig.baseUrl}/${index}/_count`, {
      method: 'POST',
      headers: {
        Authorization: providerConfig.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    return safeNumber(json?.count);
  } catch {
    return null;
  }
};

const buildBrazilFeed = async (ctx, config) => {
  const fetchedAt = new Date();
  const end = fetchedAt;
  const asOf = end.toISOString();

  const uf = resolveBrazilUf(ctx.admin1 || '');
  const stateIndex = uf ? `desc-esus-notifica-estado-${uf}` : null;
  const nationalIndex = 'desc-esus-notifica-estado-*';

  const stateName = ctx.admin1 || null;
  const municipalName = ctx.city || null;

  if (!getNotificaConfig(config)) {
    return buildUnavailable(ctx, 'missing_env_epidemic_br_notifica_basic_auth');
  }

  const countryCases = await notificaFetchCount(
    nationalIndex,
    buildBrazilQuery({ window: ctx.window, end, kind: 'cases' }),
    config,
  );
  const countryDeaths = await notificaFetchCount(
    nationalIndex,
    buildBrazilQuery({ window: ctx.window, end, kind: 'deaths' }),
    config,
  );

  const stateCases = stateIndex
    ? await notificaFetchCount(
        stateIndex,
        buildBrazilQuery({ window: ctx.window, end, kind: 'cases' }),
        config,
      )
    : stateName
      ? await notificaFetchCount(
          nationalIndex,
          buildBrazilQuery({ window: ctx.window, end, stateName, kind: 'cases' }),
          config,
        )
      : null;
  const stateDeaths = stateIndex
    ? await notificaFetchCount(
        stateIndex,
        buildBrazilQuery({ window: ctx.window, end, kind: 'deaths' }),
        config,
      )
    : stateName
      ? await notificaFetchCount(
          nationalIndex,
          buildBrazilQuery({ window: ctx.window, end, stateName, kind: 'deaths' }),
          config,
        )
      : null;

  const municipalCases =
    stateIndex && municipalName
      ? await notificaFetchCount(
          stateIndex,
          buildBrazilQuery({ window: ctx.window, end, municipalName, kind: 'cases' }),
          config,
        )
      : stateName && municipalName
        ? await notificaFetchCount(
            nationalIndex,
            buildBrazilQuery({ window: ctx.window, end, stateName, municipalName, kind: 'cases' }),
            config,
          )
        : null;

  const municipalDeaths =
    stateIndex && municipalName
      ? await notificaFetchCount(
          stateIndex,
          buildBrazilQuery({ window: ctx.window, end, municipalName, kind: 'deaths' }),
          config,
        )
      : stateName && municipalName
        ? await notificaFetchCount(
            nationalIndex,
            buildBrazilQuery({ window: ctx.window, end, stateName, municipalName, kind: 'deaths' }),
            config,
          )
        : null;

  const hasAny = [countryCases, countryDeaths, stateCases, stateDeaths, municipalCases, municipalDeaths].some(
    value => typeof value === 'number',
  );

  if (!hasAny) return buildUnavailable(ctx, 'no_br_data');

  const sources = [
    {
      name: 'Ministerio da Saude (e-SUS Notifica)',
      url: 'https://notifica.saude.gov.br/',
      tier: 1,
      authorityLevel: 'federal',
    },
  ];

  return {
    available: true,
    sourceTier: 1,
    disease: { id: ctx.disease, name: ctx.diseaseName },
    rollups: {
      country: {
        name: ctx.countryName,
        metrics: { ...emptyMetrics(), cases: countryCases, deaths: countryDeaths },
        trend: null,
        asOf,
      },
      state: {
        name: stateName || '',
        metrics: { ...emptyMetrics(), cases: stateCases, deaths: stateDeaths },
        trend: null,
        asOf,
      },
      municipal: {
        name: municipalName || '',
        metrics: { ...emptyMetrics(), cases: municipalCases, deaths: municipalDeaths },
        trend: null,
        asOf,
      },
    },
    mapData: { kind: 'choropleth', items: [] },
    freshness: {
      asOf,
      fetchedAt: fetchedAt.toISOString(),
      stalenessSec: 0,
      status: 'FRESH',
      refreshPolicy: 'AUTO_5M',
    },
    sources,
    confidence: 0.85,
  };
};

const buildNyFluFeed = async ctx => {
  const fetchedAt = new Date();
  const latest = await fetchNyFluLatest();
  const latestDate = latest?.weekendingdate;
  const season = latest?.season;
  if (!latestDate) return buildUnavailable(ctx, 'ny_flu_no_data');

  const windowWhere = await buildNyWindowWhere(ctx.window, latestDate, season);
  const stateWhere = `${windowWhere}`;
  const countyName = ctx.city ? String(ctx.city).toUpperCase() : '';
  const countyWhere = countyName ? `${windowWhere} AND county='${countyName}'` : null;

  const stateCases = await fetchNyFluSum(stateWhere);
  const countyCases = countyWhere ? await fetchNyFluSum(countyWhere) : null;

  const asOf = latestDate.endsWith('Z') ? latestDate : `${latestDate}Z`;
  const now = Date.now();
  const stalenessSec = Math.max(0, Math.floor((now - new Date(asOf).getTime()) / 1000));
  const status = stalenessSec > MAX_STALENESS_SEC ? 'STALE' : 'FRESH';

  const sources = [
    {
      name: 'NY State Department of Health - Influenza cases by county',
      url: 'https://health.data.ny.gov/resource/jr8b-6gh6.json',
      tier: 1,
      authorityLevel: 'state',
    },
  ];

  return {
    available: typeof stateCases === 'number',
    sourceTier: 1,
    disease: { id: ctx.disease, name: ctx.diseaseName },
    rollups: {
      country: { name: ctx.countryName, metrics: emptyMetrics(), trend: null, asOf },
      state: {
        name: ctx.admin1 || 'New York',
        metrics: { ...emptyMetrics(), cases: stateCases, deaths: null },
        trend: null,
        asOf,
      },
      municipal: {
        name: ctx.city || '',
        metrics: { ...emptyMetrics(), cases: countyCases, deaths: null },
        trend: null,
        asOf,
      },
    },
    mapData: { kind: 'choropleth', items: [] },
    freshness: {
      asOf,
      fetchedAt: fetchedAt.toISOString(),
      stalenessSec,
      status,
      refreshPolicy: 'AUTO_5M',
    },
    sources,
    confidence: 0.6,
  };
};

const buildCaFluFeed = async ctx => {
  const fetchedAt = new Date();
  const ageGroup = 'All Ages';
  const stateRegion = 'California';
  const localRegion = resolveCaRegion(ctx.city || ctx.admin1 || '');

  const latestStateRows = await fetchCkanRecords(
    { RPHO_REGION: stateRegion, AGE_GRP: ageGroup },
    { limit: 1, sort: 'WEEKENDING desc' },
  );
  const latestState = latestStateRows[0];
  if (!latestState?.WEEKENDING) return buildUnavailable(ctx, 'ca_flu_no_data');

  const latestWeek = latestState.WEEKENDING;
  const season = latestState.SEASON;
  const windowDays = ctx.window === 'all' ? null : Number(ctx.window.replace('d', '')) || 7;
  const windowWeeks = windowDays ? Math.max(1, Math.round(windowDays / 7)) : null;

  const collectWindow = async region => {
    if (!windowWeeks) {
      const records = [];
      let offset = 0;
      const limit = 500;
      while (true) {
        const batch = await fetchCkanRecords(
          { RPHO_REGION: region, AGE_GRP: ageGroup, SEASON: season },
          { limit, offset },
        );
        if (batch.length === 0) break;
        records.push(...batch);
        if (batch.length < limit) break;
        offset += limit;
      }
      return records;
    }
    return await fetchCkanRecords(
      { RPHO_REGION: region, AGE_GRP: ageGroup },
      { limit: windowWeeks, sort: 'WEEKENDING desc' },
    );
  };

  const stateRecords = await collectWindow(stateRegion);
  const localRecords = localRegion ? await collectWindow(localRegion) : [];

  const sumField = (rows, field) =>
    rows.reduce((acc, row) => acc + (Number(row?.[field]) || 0), 0);

  const stateCases = stateRecords.length > 0 ? sumField(stateRecords, 'FLU_POSITIVES') : null;
  const stateDeaths = stateRecords.length > 0 ? sumField(stateRecords, 'FLU_DEATHS') : null;
  const localCases = localRecords.length > 0 ? sumField(localRecords, 'FLU_POSITIVES') : null;
  const localDeaths = localRecords.length > 0 ? sumField(localRecords, 'FLU_DEATHS') : null;

  const asOf = new Date(latestWeek).toISOString();
  const now = Date.now();
  const stalenessSec = Math.max(0, Math.floor((now - new Date(asOf).getTime()) / 1000));
  const status = stalenessSec > MAX_STALENESS_SEC ? 'STALE' : 'FRESH';

  const sources = [
    {
      name: 'California Department of Public Health - Respiratory Virus Dashboard',
      url: 'https://data.chhs.ca.gov/dataset/respiratory-virus-dashboard',
      tier: 1,
      authorityLevel: 'state',
    },
  ];

  return {
    available: typeof stateCases === 'number',
    sourceTier: 1,
    disease: { id: ctx.disease, name: ctx.diseaseName },
    rollups: {
      country: { name: ctx.countryName, metrics: emptyMetrics(), trend: null, asOf },
      state: {
        name: ctx.admin1 || 'California',
        metrics: { ...emptyMetrics(), cases: stateCases, deaths: stateDeaths },
        trend: null,
        asOf,
      },
      municipal: {
        name: ctx.city || localRegion || '',
        metrics: { ...emptyMetrics(), cases: localCases, deaths: localDeaths },
        trend: null,
        asOf,
      },
    },
    mapData: { kind: 'choropleth', items: [] },
    freshness: {
      asOf,
      fetchedAt: fetchedAt.toISOString(),
      stalenessSec,
      status,
      refreshPolicy: 'AUTO_5M',
    },
    sources,
    confidence: 0.6,
  };
};

const buildContext = params => {
  const countries = getCountries();
  const countryCode = String(params.country || '').toUpperCase();
  const countryMeta = countries.find(item => item.country === countryCode);
  const disease = params.disease || 'covid19';
  const diseaseName =
    disease === 'covid19'
      ? 'COVID-19'
      : disease === 'influenza'
        ? 'Influenza'
        : disease;
  const metric = ['cases', 'deaths', 'hospitalizations', 'positivity'].includes(params.metric)
    ? params.metric
    : 'cases';
  const window = ['7d', '14d', '30d', 'all'].includes(params.window) ? params.window : '7d';
  const normalize = ['count', 'per100k', 'percent'].includes(params.normalize) ? params.normalize : 'count';

  return {
    country: countryCode,
    countryName: countryMeta?.name_en || countryCode,
    admin1: params.admin1 || '',
    city: params.city || '',
    disease,
    diseaseName,
    metric,
    window,
    normalize,
  };
};

const getMetaCountries = () => {
  const version = getVersion();
  const registry = getRegistry();
  const countries = getCountries();

  const computed = countries.map(entry => {
    const sources = registry?.countries?.[entry.country];
    const localSourcesReady =
      Boolean(sources?.national?.some(item => item.enabled)) ||
      Boolean(sources?.subnational?.some(item => item.enabled)) ||
      Boolean(sources?.municipal?.some(item => item.enabled));
    return { ...entry, localSourcesReady: Boolean(localSourcesReady) };
  });

  return {
    version: `iso3166-1-alpha2@${version.dataset}@${version.version}`,
    generatedAt: new Date().toISOString(),
    source: version.source,
    countries: computed,
  };
};

const getEpidemicFeed = async (params, options = {}) => {
  const config = options.config || getRuntimeConfig();
  const ctx = buildContext(params);
  if (!/^[A-Z]{2}$/.test(ctx.country)) {
    return buildUnavailable(ctx, 'invalid_country');
  }

  if (ctx.normalize !== 'count') {
    return buildUnavailable(ctx, 'normalize_not_supported');
  }

  const registry = getRegistry();
  const sources = registry?.countries?.[ctx.country];

  if (ctx.disease === 'covid19') {
    if (ctx.country === 'BR') {
      const hasBrConnector =
        sources?.national?.some(item => item.enabled) ||
        sources?.subnational?.some(item => item.enabled) ||
        sources?.municipal?.some(item => item.enabled);
      if (hasBrConnector) {
        const brFeed = await buildBrazilFeed(ctx, config);
        if (brFeed.available) return validateEpidemicFeed(brFeed);
      }
    }

    if (sources?.baseline?.enabled) {
      const whoFeed = await buildWhoFeed(ctx);
      return validateEpidemicFeed(whoFeed);
    }
  }

  if (ctx.disease === 'influenza') {
    if (ctx.country === 'US') {
      const hasUsConnector =
        sources?.subnational?.some(item => item.enabled) ||
        sources?.municipal?.some(item => item.enabled);
      if (hasUsConnector) {
        if (isUsState(ctx.admin1, 'NY')) {
          const nyFeed = await buildNyFluFeed(ctx);
          return validateEpidemicFeed(nyFeed);
        }
        if (isUsState(ctx.admin1, 'CA')) {
          const caFeed = await buildCaFluFeed(ctx);
          return validateEpidemicFeed(caFeed);
        }
      }
    }
  }

  return validateEpidemicFeed(buildUnavailable(ctx, 'no_provider'));
};

module.exports = {
  getMetaCountries,
  getEpidemicFeed,
  validateEpidemicFeed,
  isOfficialDomain,
};
