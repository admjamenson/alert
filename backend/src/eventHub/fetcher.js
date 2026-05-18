const { nowIso } = require('./utils');

const REQUEST_CACHE = new Map();
const RATE_LIMIT_WINDOWS = new Map();
const PROVIDER_FETCH_METRICS = new Map();
const IN_FLIGHT_REQUESTS = new Map();

const DEFAULT_USER_AGENT = 'AlertEventHub/1.0 (+support@alertapp.com)';
const MAX_CACHE_ENTRIES = Math.max(
  100,
  Number(process.env.ALERT_PROVIDER_CACHE_MAX_ENTRIES || 1000),
);
const MAX_IN_FLIGHT_ENTRIES = Math.max(
  25,
  Number(process.env.ALERT_PROVIDER_INFLIGHT_MAX_ENTRIES || 250),
);

const emptyProviderMetric = providerId => ({
  providerId,
  total: 0,
  success: 0,
  failure: 0,
  cacheHit: 0,
  rateLimited: 0,
  timeout: 0,
  totalLatencyMs: 0,
  lastStatus: null,
  lastErrorType: null,
  lastSeenAt: null,
});

const normalizeProviderId = options => {
  const raw =
    options.providerId ||
    options.rateLimitKey ||
    options.cacheKey ||
    'unknown_provider';
  return String(raw).trim().slice(0, 80) || 'unknown_provider';
};

const recordProviderFetchMetric = (providerId, result) => {
  const key = String(providerId || 'unknown_provider');
  const current = PROVIDER_FETCH_METRICS.get(key) || emptyProviderMetric(key);
  current.total += 1;
  if (result.ok) {
    current.success += 1;
  } else {
    current.failure += 1;
  }
  if (result.cached) current.cacheHit += 1;
  if (result.status === 429 || result.errorType === 'rate_limit') {
    current.rateLimited += 1;
  }
  if (result.errorType === 'timeout') {
    current.timeout += 1;
  }
  current.totalLatencyMs += Math.max(0, Number(result.durationMs || 0));
  current.lastStatus = Number.isFinite(Number(result.status))
    ? Number(result.status)
    : null;
  current.lastErrorType = result.errorType || null;
  current.lastSeenAt = nowIso();
  PROVIDER_FETCH_METRICS.set(key, current);
};

const withProviderMetric = (providerId, result) => {
  recordProviderFetchMetric(providerId, result);
  return result;
};

const getProviderFetchMetrics = () =>
  Array.from(PROVIDER_FETCH_METRICS.values()).map(row => ({
    ...row,
    successRate:
      row.total > 0 ? Number((row.success / row.total).toFixed(4)) : 0,
    cacheHitRate:
      row.total > 0 ? Number((row.cacheHit / row.total).toFixed(4)) : 0,
    avgLatencyMs:
      row.total > 0 ? Math.round(row.totalLatencyMs / row.total) : null,
  }));

const clearProviderFetchMetrics = () => {
  PROVIDER_FETCH_METRICS.clear();
};

const readCached = key => {
  const row = REQUEST_CACHE.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    REQUEST_CACHE.delete(key);
    return null;
  }
  REQUEST_CACHE.delete(key);
  REQUEST_CACHE.set(key, row);
  return row.value;
};

const pruneCache = () => {
  while (REQUEST_CACHE.size > MAX_CACHE_ENTRIES) {
    const oldestKey = REQUEST_CACHE.keys().next().value;
    if (!oldestKey) break;
    REQUEST_CACHE.delete(oldestKey);
  }
};

const writeCached = (key, ttlMs, value) => {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  if (REQUEST_CACHE.has(key)) {
    REQUEST_CACHE.delete(key);
  }
  REQUEST_CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  pruneCache();
};

const getRateWindow = key => {
  const now = Date.now();
  const current = RATE_LIMIT_WINDOWS.get(key);
  if (!current || now - current.startAt > 60_000) {
    const next = { startAt: now, count: 0 };
    RATE_LIMIT_WINDOWS.set(key, next);
    return next;
  }
  return current;
};

const enforceRateLimit = (key, maxPerMinute) => {
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) return false;
  const window = getRateWindow(key);
  window.count += 1;
  RATE_LIMIT_WINDOWS.set(key, window);
  return window.count > maxPerMinute;
};

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const buildRequestHeaders = headers => {
  const requestHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'application/json',
  };
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    requestHeaders[key] = String(value);
  }
  return requestHeaders;
};

const fetchJsonWithRetry = async (
  url,
  options = {},
) => {
  const {
    method = 'GET',
    headers = {},
    body,
    cacheKey,
    cacheTtlMs = 0,
    retries = 2,
    retryDelayMs = 250,
    timeoutMs = 4500,
    rateLimitKey,
    maxPerMinute = 0,
  } = options;
  const startAt = Date.now();
  const providerId = normalizeProviderId(options);
  const coalesceKey = cacheKey || `${method}:${url}:${body ? String(body).slice(0, 256) : ''}`;

  if (cacheKey) {
    const cached = readCached(cacheKey);
    if (cached) {
      return withProviderMetric(providerId, {
        ok: true,
        status: 200,
        json: cached,
        cached: true,
        fetchedAt: nowIso(),
        attempts: 0,
        durationMs: Math.max(0, Date.now() - startAt),
        errorType: null,
      });
    }
  }

  if (IN_FLIGHT_REQUESTS.has(coalesceKey)) {
    const shared = await IN_FLIGHT_REQUESTS.get(coalesceKey);
    return withProviderMetric(providerId, {
      ...shared,
      coalesced: true,
      durationMs: Math.max(0, Date.now() - startAt),
    });
  }

  if (rateLimitKey && enforceRateLimit(rateLimitKey, maxPerMinute)) {
    return withProviderMetric(providerId, {
      ok: false,
      status: 429,
      error: 'provider_rate_limited',
      cached: false,
      fetchedAt: nowIso(),
      attempts: 0,
      durationMs: Math.max(0, Date.now() - startAt),
      errorType: 'rate_limit',
    });
  }

  const runFetch = async () => {
    let lastError = null;
    let lastErrorType = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), Math.max(500, timeoutMs))
        : null;
      try {
        const response = await fetch(url, {
          method,
          headers: buildRequestHeaders(headers),
          body,
          signal: controller?.signal,
        });
        if (!response.ok) {
          lastError = new Error(`HTTP_${response.status}`);
          lastErrorType = 'http';
          if (response.status >= 500 && attempt < retries) {
            await sleep(retryDelayMs * (attempt + 1));
            continue;
          }
          return {
            ok: false,
            status: response.status,
            error: lastError.message,
            cached: false,
            fetchedAt: nowIso(),
            attempts: attempt + 1,
            durationMs: Math.max(0, Date.now() - startAt),
            errorType: lastErrorType,
          };
        }
        const json = await response.json();
        if (cacheKey && cacheTtlMs > 0) {
          writeCached(cacheKey, cacheTtlMs, json);
        }
        return {
          ok: true,
          status: response.status,
          json,
          cached: false,
          fetchedAt: nowIso(),
          attempts: attempt + 1,
          durationMs: Math.max(0, Date.now() - startAt),
          errorType: null,
        };
      } catch (error) {
        lastError = error;
        lastErrorType =
          error?.name === 'AbortError' ||
          String(error?.message || '').toLowerCase().includes('abort')
            ? 'timeout'
            : 'network';
        if (attempt < retries) {
          await sleep(retryDelayMs * (attempt + 1));
        }
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    return {
      ok: false,
      status: 0,
      error: String(lastError?.message || 'network_error'),
      cached: false,
      fetchedAt: nowIso(),
      attempts: retries + 1,
      durationMs: Math.max(0, Date.now() - startAt),
      errorType: lastErrorType,
    };
  };

  if (IN_FLIGHT_REQUESTS.size >= MAX_IN_FLIGHT_ENTRIES) {
    return withProviderMetric(providerId, {
      ok: false,
      status: 503,
      error: 'provider_inflight_saturated',
      cached: false,
      fetchedAt: nowIso(),
      attempts: 0,
      durationMs: Math.max(0, Date.now() - startAt),
      errorType: 'inflight_saturated',
    });
  }

  const inFlight = runFetch();
  IN_FLIGHT_REQUESTS.set(coalesceKey, inFlight);
  try {
    return withProviderMetric(providerId, await inFlight);
  } finally {
    IN_FLIGHT_REQUESTS.delete(coalesceKey);
  }
};

module.exports = {
  fetchJsonWithRetry,
  getProviderFetchMetrics,
  clearProviderFetchMetrics,
  readCached,
  writeCached,
};
