type SosDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SosDiagnosticValue[]
  | {[key: string]: SosDiagnosticValue};

const PREFIX = '[SOS-DIAG]';
const MAX_STRING_LENGTH = 280;
const MAX_OBJECT_KEYS = 12;
const BLOCKED_OBJECT_KEYS = new Set([
  'authorization',
  'token',
  'payload',
  'contacts',
  'location',
  'targets',
  'headers',
  'deviceId',
  'userId',
  'fcmToken',
]);

const trimText = (value: string): string =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;

const normalizeText = (value: unknown): string =>
  trimText(String(value || '').replace(/\s+/g, ' ').trim());

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitizeValue = (value: unknown, depth = 0): SosDiagnosticValue => {
  if (value == null) return value as null | undefined;
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
    };
  }
  if (isPlainObject(value)) {
    if (depth >= 2) {
      return {
        kind: 'object',
        keys: Object.keys(value).slice(0, MAX_OBJECT_KEYS),
      };
    }
    const next: Record<string, SosDiagnosticValue> = {};
    Object.entries(value)
      .slice(0, MAX_OBJECT_KEYS)
      .forEach(([key, current]) => {
        const normalizedKey = key.toLowerCase();
        if (
          BLOCKED_OBJECT_KEYS.has(key) ||
          normalizedKey.includes('secret') ||
          normalizedKey.includes('password') ||
          normalizedKey.includes('bearer')
        ) {
          next[key] = '<redacted>';
          return;
        }
        next[key] = sanitizeValue(current, depth + 1);
      });
    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      next.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
    }
    return next;
  }
  return normalizeText(value);
};

export const summarizeUrl = (value: string): SosDiagnosticValue => {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return {
      url: raw,
      origin: `${parsed.protocol}//${parsed.host}`,
      host: parsed.host,
      path: parsed.pathname,
    };
  } catch {
    return raw;
  }
};

export const summarizeError = (error: unknown): SosDiagnosticValue => {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: normalizeText(error.name),
      message: normalizeText(error.message),
    };
  }
  return normalizeText(error);
};

export const summarizeResponseBody = (value: unknown): SosDiagnosticValue => {
  if (value == null) return null;
  if (typeof value === 'string') return normalizeText(value);
  return sanitizeValue(value);
};

export const logSosDiagnostic = (
  stage: string,
  payload: Record<string, unknown> = {},
): void => {
  try {
    const safePayload = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, sanitizeValue(value)]),
    );
    console.info(`${PREFIX} ${stage} ${JSON.stringify(safePayload)}`);
  } catch (error) {
    console.info(
      `${PREFIX} ${stage} ${JSON.stringify({
        loggerError: summarizeError(error),
      })}`,
    );
  }
};
