const crypto = require('node:crypto');

const MAX_ID_LENGTH = 120;
const MAX_ROUTE_LENGTH = 120;
const MAX_METHOD_LENGTH = 16;
const MAX_ERROR_CODE_LENGTH = 80;

const nowIso = () => new Date().toISOString();

const sanitizeId = value =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '_')
    .slice(0, MAX_ID_LENGTH) || null;

const sanitizeRoute = value =>
  String(value || '')
    .trim()
    .slice(0, MAX_ROUTE_LENGTH) || null;

const sanitizeMethod = value =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, MAX_METHOD_LENGTH) || null;

const sanitizeErrorCode = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '_')
    .slice(0, MAX_ERROR_CODE_LENGTH) || null;

const sanitizeBoolean = value =>
  typeof value === 'boolean' ? value : undefined;

const sanitizeStatusCode = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(999, Math.round(parsed)));
};

const sanitizeDurationMs = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round(parsed));
};

const buildGuardianSosLogEntry = (event, payload = {}) => {
  const entry = {
    timestamp: nowIso(),
    event: String(event || '').trim() || 'guardian_sos_unknown',
    requestId: sanitizeId(payload.requestId),
    jobId: sanitizeId(payload.jobId),
    route: sanitizeRoute(payload.route),
    method: sanitizeMethod(payload.method),
    statusCode: sanitizeStatusCode(payload.statusCode),
    accepted: sanitizeBoolean(payload.accepted),
    queued: sanitizeBoolean(payload.queued),
    fallbackUsed: sanitizeBoolean(payload.fallbackUsed),
    errorCode: sanitizeErrorCode(payload.errorCode),
    durationMs: sanitizeDurationMs(payload.durationMs),
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null),
  );
};

const logGuardianSosEvent = (logger, event, payload = {}) => {
  const entry = buildGuardianSosLogEntry(event, payload);
  const line = JSON.stringify(entry);
  const target = logger || console;

  if (event === 'guardian_sos_request_failed') {
    const statusCode = Number(entry.statusCode || 0);
    if (statusCode >= 500 && typeof target.error === 'function') {
      target.error(line);
      return entry;
    }
    if (typeof target.warn === 'function') {
      target.warn(line);
      return entry;
    }
  }

  if (typeof target.log === 'function') {
    target.log(line);
    return entry;
  }

  if (typeof target.info === 'function') {
    target.info(line);
    return entry;
  }

  console.log(line);
  return entry;
};

const buildGuardianSosRequestId = value => sanitizeId(value) || crypto.randomUUID();

module.exports = {
  buildGuardianSosLogEntry,
  buildGuardianSosRequestId,
  logGuardianSosEvent,
  sanitizeErrorCode,
};
