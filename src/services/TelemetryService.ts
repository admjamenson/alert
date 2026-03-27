import AsyncStorage from '@react-native-async-storage/async-storage';

const TELEMETRY_KEY = '@Alert:TelemetryEventsV2';
const TELEMETRY_SESSION_KEY = '@Alert:TelemetrySessionIdV2';
const MAX_EVENTS = 500;
const SCHEMA_VERSION = 2;
const DEFAULT_SAMPLE_RATE = 0.2;
const PERF_SAMPLE_RATE = 0.05;
const MAX_EVENTS_PER_MINUTE = 60;

const ALWAYS_TRACK_PREFIXES = [
  'sos_',
  'ad_',
  'ads_',
  'reward_',
  'checkout_',
  'security_',
  'permission_',
  'crash_',
  'error_',
];

export type TelemetryEventV2 = {
  v: 2;
  name: string;
  ts: number;
  sessionId: string;
  city?: string;
  screen?: string;
  payload?: Record<string, unknown>;
};

let sessionIdCache = '';
let minuteWindowStartMs = 0;
let minuteEventCount = 0;

const DEV_LOG_THROTTLE_MS = 10_000;
const lastDevLogByEventName: Record<string, number> = {};

const randomSegment = () => Math.random().toString(36).slice(2, 10);

const getSessionId = async (): Promise<string> => {
  if (sessionIdCache) return sessionIdCache;
  try {
    const stored = await AsyncStorage.getItem(TELEMETRY_SESSION_KEY);
    if (stored) {
      sessionIdCache = stored;
      return stored;
    }
  } catch {
    // ignore
  }
  const created = `${Date.now().toString(36)}-${randomSegment()}`;
  sessionIdCache = created;
  try {
    await AsyncStorage.setItem(TELEMETRY_SESSION_KEY, created);
  } catch {
    // ignore
  }
  return created;
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
    normalized.includes('deviceid')
  );
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    return sanitizePayload(value as Record<string, unknown>);
  }
  if (typeof value === 'string') {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }
  return value;
};

const sanitizePayload = (
  payload?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (isSensitiveKey(key)) return;
    out[key] = sanitizeValue(value);
  });
  return Object.keys(out).length > 0 ? out : undefined;
};

const shouldAlwaysTrack = (name: string) =>
  ALWAYS_TRACK_PREFIXES.some(prefix => name.startsWith(prefix));

const sampleRateFor = (name: string) => {
  if (shouldAlwaysTrack(name)) return 1;
  if (name.includes('_ms') || name.includes('fps') || name.includes('render')) {
    return PERF_SAMPLE_RATE;
  }
  return DEFAULT_SAMPLE_RATE;
};

const shouldTrackBySampling = (name: string) => {
  if (__DEV__) return true;
  return Math.random() <= sampleRateFor(name);
};

const withinRateLimit = (name: string) => {
  if (__DEV__ || shouldAlwaysTrack(name)) return true;
  const now = Date.now();
  if (minuteWindowStartMs === 0 || now - minuteWindowStartMs >= 60_000) {
    minuteWindowStartMs = now;
    minuteEventCount = 0;
  }
  if (minuteEventCount >= MAX_EVENTS_PER_MINUTE) return false;
  minuteEventCount += 1;
  return true;
};

const enqueue = async (event: TelemetryEventV2) => {
  try {
    const raw = await AsyncStorage.getItem(TELEMETRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as TelemetryEventV2[]) : [];
    const queue = Array.isArray(parsed) ? parsed : [];
    queue.push(event);
    const tail = queue.slice(-MAX_EVENTS);
    await AsyncStorage.setItem(TELEMETRY_KEY, JSON.stringify(tail));
  } catch {
    // no-op
  }
};

export const TelemetryService = {
  trackEvent(name: string, payload?: Record<string, unknown>) {
    const rawName = String(name || '').trim();
    const normalizedName = rawName.toLowerCase();
    if (!rawName) return;
    if (!shouldTrackBySampling(normalizedName)) return;
    if (!withinRateLimit(normalizedName)) return;

    void (async () => {
      const sessionId = await getSessionId();
      const cleanPayload = sanitizePayload(payload);
      const event: TelemetryEventV2 = {
        v: SCHEMA_VERSION,
        name: rawName,
        ts: Date.now(),
        sessionId,
        city: typeof cleanPayload?.city === 'string' ? cleanPayload.city : undefined,
        screen:
          typeof cleanPayload?.screen === 'string'
            ? cleanPayload.screen
            : typeof cleanPayload?.sourceScreen === 'string'
              ? cleanPayload.sourceScreen
              : undefined,
        payload: cleanPayload,
      };
      if (__DEV__) {
        const now = Date.now();
        const last = lastDevLogByEventName[rawName] ?? 0;
        const isHighFrequency = /location_fix|position|location_update/i.test(rawName);
        const shouldLog = !isHighFrequency || now - last >= DEV_LOG_THROTTLE_MS;
        if (shouldLog) {
          lastDevLogByEventName[rawName] = now;
          console.log('[ALERT-EVENT-v2]', event.name, {
            ts: event.ts,
            screen: event.screen ?? undefined,
            city: event.city ?? undefined,
          });
        }
      }
      await enqueue(event);
    })();
  },

  async getBufferedEvents(): Promise<TelemetryEventV2[]> {
    try {
      const raw = await AsyncStorage.getItem(TELEMETRY_KEY);
      const parsed = raw ? (JSON.parse(raw) as TelemetryEventV2[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async clearBufferedEvents(): Promise<void> {
    try {
      await AsyncStorage.removeItem(TELEMETRY_KEY);
    } catch {
      // ignore
    }
  },
};

export default TelemetryService;
