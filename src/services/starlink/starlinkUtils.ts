export type ConnectivityQuality = 'good' | 'medium' | 'poor' | 'unknown';

export type RelayMetricsSample = {
  ok: boolean;
  retriesUsed: number;
  latencyMs: number;
  at: string;
};

export type RelayMetricsState = {
  samples: RelayMetricsSample[];
  retryRate: number;
  successRate: number;
  avgLatencyMs: number | null;
};

export type StarlinkTransportProfile = {
  name: 'normal' | 'starlink';
  timeoutMs: number;
  maxRetries: number;
  initialBackoffMs: number;
  compressPayload: boolean;
};

const STARLINK_SSID_REGEX = /\bstarlink\b/i;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const detectStarlinkFromSsid = (ssid?: string | null): boolean => {
  if (!ssid) return false;
  const normalized = String(ssid).replace(/^"|"$/g, '').trim();
  if (!normalized) return false;
  return STARLINK_SSID_REGEX.test(normalized);
};

export const buildRelayMetricsState = (
  samples: RelayMetricsSample[],
): RelayMetricsState => {
  if (!samples.length) {
    return {
      samples: [],
      retryRate: 0,
      successRate: 0,
      avgLatencyMs: null,
    };
  }

  const safeSamples = samples.slice(-40);
  const successCount = safeSamples.filter(sample => sample.ok).length;
  const retryEvents = safeSamples.filter(sample => sample.retriesUsed > 0).length;
  const latencySum = safeSamples.reduce((sum, sample) => sum + Math.max(0, sample.latencyMs), 0);

  return {
    samples: safeSamples,
    retryRate: retryEvents / safeSamples.length,
    successRate: successCount / safeSamples.length,
    avgLatencyMs: Math.round(latencySum / safeSamples.length),
  };
};

export const computeConnectivityQuality = (params: {
  isOnline: boolean;
  latencyMs: number | null;
  retryRate: number;
  successRate: number;
}): ConnectivityQuality => {
  if (!params.isOnline) return 'poor';
  if (params.latencyMs === null) return 'unknown';

  const retryPenalty = clamp(params.retryRate, 0, 1);
  const successPenalty = 1 - clamp(params.successRate, 0, 1);
  const effectiveLatency = params.latencyMs * (1 + retryPenalty + successPenalty);

  if (effectiveLatency <= 420) return 'good';
  if (effectiveLatency <= 980) return 'medium';
  return 'poor';
};

export const selectTransportProfile = (params: {
  starlinkModeEnabled: boolean;
  starlinkDetected: boolean;
}): StarlinkTransportProfile => {
  const useStarlinkProfile = params.starlinkModeEnabled && params.starlinkDetected;

  if (useStarlinkProfile) {
    return {
      name: 'starlink',
      timeoutMs: 12000,
      maxRetries: 5,
      initialBackoffMs: 450,
      compressPayload: true,
    };
  }

  return {
    name: 'normal',
    timeoutMs: 5500,
    maxRetries: 2,
    initialBackoffMs: 320,
    compressPayload: true,
  };
};

export const appendQueueItem = <T>(queue: T[], item: T, max = 40): T[] => {
  if (max <= 1) return [item];
  return [...queue, item].slice(-(Math.max(2, max)));
};
