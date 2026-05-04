type MetricPayload = Record<string, string | number | boolean | null | undefined>;

export type OperationalMetric = {
  name: string;
  value: number;
  ts: number;
  payload?: MetricPayload;
};

const MAX_METRICS = 120;
const metrics: OperationalMetric[] = [];

type TestRuntimeGlobal = typeof globalThis & {
  expect?: unknown;
  it?: unknown;
  jest?: unknown;
};

const isTestRuntime = () => {
  const runtime = globalThis as TestRuntimeGlobal;
  return (
    typeof runtime.jest !== 'undefined' ||
    (typeof runtime.expect === 'function' && typeof runtime.it === 'function') ||
    (typeof process !== 'undefined' &&
      Boolean(process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test'))
  );
};

const isSensitiveKey = (key: string) => {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('lat') ||
    normalized.includes('lon') ||
    normalized.includes('location') ||
    normalized.includes('phone') ||
    normalized.includes('email') ||
    normalized.includes('token') ||
    normalized.includes('uid') ||
    normalized.includes('device')
  );
};

const sanitizePayload = (payload?: MetricPayload): MetricPayload | undefined => {
  if (!payload) return undefined;
  const sanitized: MetricPayload = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (isSensitiveKey(key)) return;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      typeof value === 'undefined'
    ) {
      sanitized[key] = typeof value === 'string' ? value.slice(0, 96) : value;
    }
  });
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const enqueueTelemetryMirror = (
  name: string,
  value: number,
  payload?: MetricPayload,
) => {
  if (isTestRuntime()) return;
  setTimeout(() => {
    try {
      const { TelemetryService } = require('../services/TelemetryService');
      TelemetryService.trackEvent(name, {
        ...(payload || {}),
        value,
      });
    } catch {
      // Metrics must never affect the product path.
    }
  }, 0);
};

export const recordOperationalMetric = (
  name: string,
  value: number,
  payload?: MetricPayload,
) => {
  const normalizedName = String(name || '').trim();
  const normalizedValue = Number(value);
  if (!normalizedName || !Number.isFinite(normalizedValue)) return;

  const metric: OperationalMetric = {
    name: normalizedName,
    value: normalizedValue,
    ts: Date.now(),
    payload: sanitizePayload(payload),
  };
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }

  enqueueTelemetryMirror(normalizedName, normalizedValue, metric.payload);
};

export const getOperationalMetricsSnapshot = () => metrics.slice();

export const clearOperationalMetrics = () => {
  metrics.splice(0, metrics.length);
};
