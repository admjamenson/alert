const SENSITIVE_KEYS = [
  'lat',
  'latitude',
  'lon',
  'lng',
  'longitude',
  'location',
  'address',
  'uid',
  'token',
  'deviceid',
  'email',
  'phone',
];

const isSensitiveKey = (key: string) => {
  const normalized = String(key || '').toLowerCase();
  return SENSITIVE_KEYS.some(pattern => normalized.includes(pattern));
};

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(redactValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, next]) => {
      if (isSensitiveKey(key)) return;
      out[key] = redactValue(next);
    });
    return out;
  }
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  return value;
};

export const RedactionLogger = {
  safeLog(scope: string, payload?: Record<string, unknown>) {
    if (!__DEV__) return;
    const clean = redactValue(payload || {}) as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.log(`[SAFE-LOG] ${scope}`, clean);
  },
};

export default RedactionLogger;
