const { performance } = require('node:perf_hooks');

const BASE_URL = String(process.env.ALERT_LOAD_BASE_URL || 'http://127.0.0.1:5005')
  .replace(/\/+$/, '');
const REQUESTS = Math.max(1, Number(process.env.ALERT_LOAD_REQUESTS || 1800));
const CONCURRENCY = Math.max(1, Number(process.env.ALERT_LOAD_CONCURRENCY || 150));
const TIMEOUT_MS = Math.max(100, Number(process.env.ALERT_LOAD_TIMEOUT_MS || 3500));
const SCENARIO = String(process.env.ALERT_LOAD_REGIONAL_SCENARIO || 'multi_region_burst');
const PROVIDER_PRESSURE_BUCKETS = Math.max(
  1,
  Number(process.env.ALERT_LOAD_PROVIDER_PRESSURE_BUCKETS || 16),
);
const MAX_FAILURE_RATE = Math.max(
  0,
  Math.min(1, Number(process.env.ALERT_LOAD_MAX_FAILURE_RATE || 0.05)),
);

const REGIONS = [
  {
    id: 'sa-east-1-sao-paulo',
    city: 'Sao Paulo',
    country: 'BR',
    lat: -23.5505,
    lon: -46.6333,
    bbox: '-46.75,-23.65,-46.5,-23.45',
    locale: 'pt-BR',
    routeTo: { lat: -23.5617, lon: -46.6559 },
  },
  {
    id: 'us-east-1-new-york',
    city: 'New York',
    country: 'US',
    lat: 40.7128,
    lon: -74.006,
    bbox: '-74.1,40.65,-73.9,40.8',
    locale: 'en-US',
    routeTo: { lat: 40.758, lon: -73.9855 },
  },
  {
    id: 'eu-west-2-london',
    city: 'London',
    country: 'GB',
    lat: 51.5072,
    lon: -0.1276,
    bbox: '-0.25,51.45,0.02,51.56',
    locale: 'en-GB',
    routeTo: { lat: 51.5155, lon: -0.1419 },
  },
  {
    id: 'ap-northeast-1-tokyo',
    city: 'Tokyo',
    country: 'JP',
    lat: 35.6762,
    lon: 139.6503,
    bbox: '139.55,35.6,139.8,35.75',
    locale: 'ja-JP',
    routeTo: { lat: 35.6895, lon: 139.6917 },
  },
  {
    id: 'ap-southeast-1-singapore',
    city: 'Singapore',
    country: 'SG',
    lat: 1.3521,
    lon: 103.8198,
    bbox: '103.75,1.27,103.9,1.43',
    locale: 'en-SG',
    routeTo: { lat: 1.2834, lon: 103.8607 },
  },
];

const endpointCatalog = [
  {
    name: 'healthz',
    weight: 18,
    hotPath: false,
    providerPressure: false,
    path: () => '/healthz',
  },
  {
    name: 'ops_summary',
    weight: 18,
    hotPath: true,
    providerPressure: false,
    path: () => '/v1/ops/summary',
  },
  {
    name: 'events_hot_path',
    weight: 24,
    hotPath: true,
    providerPressure: false,
    path: region =>
      `/v1/events?bbox=${encodeURIComponent(region.bbox)}&types=weather,health,geophysical,community&limit=80&country=${region.country}`,
  },
  {
    name: 'risk_feed',
    weight: 12,
    hotPath: true,
    providerPressure: false,
    path: region =>
      `/api/v1/risk/feed?lat=${region.lat}&lon=${region.lon}&radiusKm=35&limit=80&sosPublicOptIn=false`,
  },
  {
    name: 'weather_feed',
    weight: 8,
    hotPath: true,
    providerPressure: true,
    path: region =>
      `/api/v1/weather/feed?lat=${region.lat}&lon=${region.lon}&locale=${region.locale}`,
  },
  {
    name: 'maps_routes',
    weight: 8,
    hotPath: true,
    providerPressure: true,
    path: region =>
      `/v1/maps/routes?fromLat=${region.lat}&fromLon=${region.lon}&toLat=${region.routeTo.lat}&toLon=${region.routeTo.lon}&mode=walking`,
  },
  {
    name: 'provider_pressure_events',
    weight: 12,
    hotPath: true,
    providerPressure: true,
    path: (region, index) => {
      const bucket = index % PROVIDER_PRESSURE_BUCKETS;
      const since = encodeURIComponent(
        new Date(Date.UTC(2026, 3, 18, 12, bucket, 0)).toISOString(),
      );
      return `/v1/events?bbox=${encodeURIComponent(region.bbox)}&types=weather,health,geophysical&limit=40&country=${region.country}&since=${since}`;
    },
  },
];

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index]);
};

const round = value => Math.round(value * 100) / 100;

const pickEndpoint = index => {
  const totalWeight = endpointCatalog.reduce((sum, item) => sum + item.weight, 0);
  const slot = index % totalWeight;
  let cursor = 0;
  for (const endpoint of endpointCatalog) {
    cursor += endpoint.weight;
    if (slot < cursor) return endpoint;
  }
  return endpointCatalog[0];
};

const pickRegion = index => {
  if (SCENARIO === 'single_city_peak') return REGIONS[0];
  if (SCENARIO === 'two_region_failover') return REGIONS[index % 2];
  return REGIONS[index % REGIONS.length];
};

const summarize = rows => {
  const latencies = rows.map(row => row.durationMs);
  const ok = rows.filter(row => row.ok).length;
  const failed = rows.length - ok;
  const statuses = rows.reduce((acc, row) => {
    const key = String(row.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    requests: rows.length,
    ok,
    failed,
    failureRate: rows.length > 0 ? round(failed / rows.length) : 0,
    statuses,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length > 0 ? Math.round(Math.max(...latencies)) : null,
    },
  };
};

const summarizeBy = (rows, key) =>
  Object.fromEntries(
    Array.from(new Set(rows.map(row => row[key]))).map(value => [
      value,
      summarize(rows.filter(row => row[key] === value)),
    ]),
  );

const requestOnce = async index => {
  const region = pickRegion(index);
  const endpoint = pickEndpoint(index);
  const url = `${BASE_URL}${endpoint.path(region, index)}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-alert-region': region.id,
        'x-alert-city': region.city,
        'x-alert-load-scenario': SCENARIO,
      },
    });
    await res.arrayBuffer();
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Math.max(0, performance.now() - startedAt),
      endpoint: endpoint.name,
      region: region.id,
      hotPath: endpoint.hotPath,
      providerPressure: endpoint.providerPressure,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Math.max(0, performance.now() - startedAt),
      endpoint: endpoint.name,
      region: region.id,
      hotPath: endpoint.hotPath,
      providerPressure: endpoint.providerPressure,
      error: error?.name || 'request_error',
    };
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  let next = 0;
  const results = [];
  const startedAt = performance.now();

  const worker = async () => {
    while (next < REQUESTS) {
      const index = next;
      next += 1;
      results.push(await requestOnce(index));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker()),
  );

  const durationSec = Math.max(0.001, (performance.now() - startedAt) / 1000);
  const overall = summarize(results);
  const output = {
    generatedAt: new Date().toISOString(),
    scenario: SCENARIO,
    baseUrl: BASE_URL,
    requests: REQUESTS,
    concurrency: CONCURRENCY,
    timeoutMs: TIMEOUT_MS,
    durationSec: round(durationSec),
    rps: round(results.length / durationSec),
    regions: REGIONS.map(region => region.id),
    externalInfra: {
      redisUrlConfigured: Boolean(process.env.ALERT_REDIS_URL),
      jobQueueDriver: process.env.ALERT_JOB_QUEUE_DRIVER || 'memory',
      cacheDriver: process.env.ALERT_CACHE_DRIVER || 'memory',
      classification: process.env.ALERT_REDIS_URL
        ? 'implemented_not_proven_here'
        : 'blocked_by_missing_external_infra',
    },
    proofClassification: {
      localBackendLoad: 'proven',
      multiEndpointHotPathMix: 'proven_locally',
      distributedInternetLoad: 'not_proven_here',
      multiRegionRuntime: 'modeled_requires_multi_region',
    },
    overall,
    byEndpoint: summarizeBy(results, 'endpoint'),
    byRegion: summarizeBy(results, 'region'),
    hotPaths: summarize(results.filter(row => row.hotPath)),
    providerPressure: summarize(results.filter(row => row.providerPressure)),
    failureBudget: {
      maxFailureRate: MAX_FAILURE_RATE,
      withinBudget: overall.failureRate <= MAX_FAILURE_RATE,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  if (!output.failureBudget.withinBudget) {
    process.exitCode = 1;
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
