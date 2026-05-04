const DEFAULT_MAX_SAMPLES = 256;

const nowIso = () => new Date().toISOString();

const readPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.round(parsed));
};

const createRequestMetricTracker = (options = {}) => ({
  total: 0,
  success: 0,
  failed: 0,
  totalLatencyMs: 0,
  latencySamples: [],
  successLatencySamples: [],
  maxSamples: readPositiveInteger(options.maxSamples, DEFAULT_MAX_SAMPLES),
  windowStartedAt: nowIso(),
  lastUpdatedAt: null,
});

const appendBoundedSample = (samples, value, maxSamples) => {
  samples.push(value);
  if (samples.length > maxSamples) {
    samples.splice(0, samples.length - maxSamples);
  }
};

const markRequestMetric = (tracker, ok, latencyMs) => {
  if (!tracker || typeof tracker !== 'object') return;
  const normalizedLatency = Math.max(0, Math.round(Number(latencyMs) || 0));
  tracker.total += 1;
  if (ok) tracker.success += 1;
  else tracker.failed += 1;
  tracker.totalLatencyMs += normalizedLatency;
  appendBoundedSample(
    tracker.latencySamples,
    normalizedLatency,
    tracker.maxSamples || DEFAULT_MAX_SAMPLES,
  );
  if (ok) {
    appendBoundedSample(
      tracker.successLatencySamples,
      normalizedLatency,
      tracker.maxSamples || DEFAULT_MAX_SAMPLES,
    );
  }
  tracker.lastUpdatedAt = nowIso();
};

const percentileFromSamples = (samples, percentile) => {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = samples
    .map(value => Math.max(0, Math.round(Number(value) || 0)))
    .sort((left, right) => left - right);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((Number(percentile) / 100) * sorted.length) - 1),
  );
  return sorted[rank];
};

const summarizeRequestMetric = tracker => {
  if (!tracker || typeof tracker !== 'object') {
    return {
      total: 0,
      success: 0,
      failed: 0,
      totalLatencyMs: 0,
      successRate: 0,
      deliveryRate: 0,
      errorRate: 0,
      avgLatencyMs: null,
      p95LatencyMs: null,
      latencySampleCount: 0,
      successLatencySampleCount: 0,
      windowStartedAt: null,
      lastUpdatedAt: null,
    };
  }

  const successRate =
    tracker.total > 0
      ? Number((tracker.success / tracker.total).toFixed(4))
      : 0;
  const errorRate =
    tracker.total > 0
      ? Number((tracker.failed / tracker.total).toFixed(4))
      : 0;

  return {
    total: tracker.total,
    success: tracker.success,
    failed: tracker.failed,
    totalLatencyMs: tracker.totalLatencyMs,
    successRate,
    deliveryRate: successRate,
    errorRate,
    avgLatencyMs:
      tracker.total > 0 ? Math.round(tracker.totalLatencyMs / tracker.total) : null,
    p95LatencyMs: percentileFromSamples(tracker.successLatencySamples, 95),
    latencySampleCount: Array.isArray(tracker.latencySamples)
      ? tracker.latencySamples.length
      : 0,
    successLatencySampleCount: Array.isArray(tracker.successLatencySamples)
      ? tracker.successLatencySamples.length
      : 0,
    windowStartedAt: tracker.windowStartedAt || null,
    lastUpdatedAt: tracker.lastUpdatedAt || null,
  };
};

module.exports = {
  createRequestMetricTracker,
  markRequestMetric,
  percentileFromSamples,
  summarizeRequestMetric,
};
