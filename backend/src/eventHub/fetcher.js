const { nowIso } = require('./utils');

const REQUEST_CACHE = new Map();
const RATE_LIMIT_WINDOWS = new Map();

const DEFAULT_USER_AGENT = 'AlertEventHub/1.0 (+support@alertapp.com)';

const readCached = key => {
  const row = REQUEST_CACHE.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    REQUEST_CACHE.delete(key);
    return null;
  }
  return row.value;
};

const writeCached = (key, ttlMs, value) => {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  REQUEST_CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
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

  if (cacheKey) {
    const cached = readCached(cacheKey);
    if (cached) {
      return { ok: true, status: 200, json: cached, cached: true, fetchedAt: nowIso() };
    }
  }

  if (rateLimitKey && enforceRateLimit(rateLimitKey, maxPerMinute)) {
    return {
      ok: false,
      status: 429,
      error: 'provider_rate_limited',
      cached: false,
      fetchedAt: nowIso(),
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), Math.max(500, timeoutMs))
      : null;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'application/json',
          ...headers,
        },
        body,
        signal: controller?.signal,
      });
      if (!response.ok) {
        lastError = new Error(`HTTP_${response.status}`);
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
      };
    } catch (error) {
      lastError = error;
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
  };
};

module.exports = {
  fetchJsonWithRetry,
  readCached,
  writeCached,
};
