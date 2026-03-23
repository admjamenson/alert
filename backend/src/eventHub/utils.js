const crypto = require('crypto');

const nowIso = () => new Date().toISOString();

const toIso = value => {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString();
};

const toMillis = value => {
  const iso = toIso(value);
  if (!iso) return 0;
  return new Date(iso).getTime();
};

const normalizeSeverity = value => {
  const text = String(value || '').trim();
  if (text === 'Extreme' || text === 'Severe' || text === 'Moderate' || text === 'Minor') {
    return text;
  }
  return 'Minor';
};

const normalizeUrgency = value => {
  const text = String(value || '').trim();
  if (text === 'Immediate' || text === 'Expected' || text === 'Future' || text === 'Past') {
    return text;
  }
  return 'Expected';
};

const normalizeCertainty = value => {
  const text = String(value || '').trim();
  if (text === 'Observed' || text === 'Likely' || text === 'Possible' || text === 'Unlikely') {
    return text;
  }
  return 'Possible';
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeSourceClass = value => {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (
    text === 'official' ||
    text === 'official_social' ||
    text === 'major_media' ||
    text === 'verified_partner' ||
    text === 'internal_alert' ||
    text === 'community'
  ) {
    return text;
  }
  return 'reference';
};

const riskLevelFromCap = (severity, urgency, certainty) => {
  const baseBySeverity = {
    Minor: 1,
    Moderate: 2,
    Severe: 3,
    Extreme: 4,
  };
  let level = baseBySeverity[normalizeSeverity(severity)] || 1;
  if (normalizeUrgency(urgency) === 'Immediate' && normalizeCertainty(certainty) === 'Observed') {
    level += 1;
  }
  if (normalizeCertainty(certainty) === 'Unlikely') {
    level -= 1;
  }
  return clamp(level, 0, 4);
};

const parseCsvList = value =>
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const parseBbox = value => {
  const parts = String(value || '')
    .split(',')
    .map(item => Number(item.trim()));
  if (parts.length !== 4 || parts.some(item => !Number.isFinite(item))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  return {
    minLon: clamp(minLon, -180, 180),
    minLat: clamp(minLat, -90, 90),
    maxLon: clamp(maxLon, -180, 180),
    maxLat: clamp(maxLat, -90, 90),
  };
};

const bboxFromPoint = (lat, lon, radiusKm = 20) => {
  const safeLat = clamp(Number(lat || 0), -90, 90);
  const safeLon = clamp(Number(lon || 0), -180, 180);
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / Math.max(12, 111.32 * Math.cos((safeLat * Math.PI) / 180));
  return {
    minLon: clamp(safeLon - lonDelta, -180, 180),
    minLat: clamp(safeLat - latDelta, -90, 90),
    maxLon: clamp(safeLon + lonDelta, -180, 180),
    maxLat: clamp(safeLat + latDelta, -90, 90),
  };
};

const bboxContainsPoint = (bbox, lat, lon) => {
  if (!bbox) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
};

const bboxIntersects = (bboxA, bboxB) => {
  if (!bboxA || !bboxB) return true;
  return !(
    bboxA.maxLon < bboxB.minLon ||
    bboxA.minLon > bboxB.maxLon ||
    bboxA.maxLat < bboxB.minLat ||
    bboxA.minLat > bboxB.maxLat
  );
};

const haversineKm = (a, b) => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const toEventDedupeKey = event => {
  if (event.id) return String(event.id);
  const lon =
    Number(event?.geometry?.coordinates?.[0]) || Number(event?.bbox?.minLon) || Number(event?.bbox?.maxLon) || 0;
  const lat =
    Number(event?.geometry?.coordinates?.[1]) || Number(event?.bbox?.minLat) || Number(event?.bbox?.maxLat) || 0;
  const timeBucket = Math.floor(toMillis(event.updatedAt || event.startTime) / (5 * 60 * 1000));
  const raw = `${event.type || 'event'}:${event.subtype || ''}:${lat.toFixed(2)}:${lon.toFixed(2)}:${timeBucket}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20);
};

const dedupeUnifiedEvents = events => {
  const byId = new Map();
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue;
    const key = toEventDedupeKey(event);
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, event);
      continue;
    }
    const currentRisk = riskLevelFromCap(event.severity, event.urgency, event.certainty);
    const existingRisk = riskLevelFromCap(existing.severity, existing.urgency, existing.certainty);
    if (currentRisk > existingRisk) {
      byId.set(key, event);
      continue;
    }
    if (currentRisk === existingRisk && toMillis(event.updatedAt) > toMillis(existing.updatedAt)) {
      byId.set(key, event);
    }
  }
  return Array.from(byId.values());
};

const sortByRiskAndFreshness = events =>
  [...(events || [])].sort((a, b) => {
    const riskA = riskLevelFromCap(a.severity, a.urgency, a.certainty);
    const riskB = riskLevelFromCap(b.severity, b.urgency, b.certainty);
    if (riskB !== riskA) return riskB - riskA;
    return toMillis(b.updatedAt || b.startTime) - toMillis(a.updatedAt || a.startTime);
  });

const sanitizeTypesFilter = value => {
  const items = parseCsvList(value).map(item => item.toLowerCase());
  return Array.from(new Set(items));
};

const createUnifiedEvent = payload => {
  const severity = normalizeSeverity(payload.severity);
  const urgency = normalizeUrgency(payload.urgency);
  const certainty = normalizeCertainty(payload.certainty);
  const geometry = payload.geometry && typeof payload.geometry === 'object' ? payload.geometry : null;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
  const pointLat = Number(coordinates?.[1]);
  const pointLon = Number(coordinates?.[0]);
  const bbox =
    payload.bbox && typeof payload.bbox === 'object'
      ? payload.bbox
      : Number.isFinite(pointLat) && Number.isFinite(pointLon)
        ? bboxFromPoint(pointLat, pointLon, 5)
        : null;

  const updatedAt = toIso(payload.updatedAt || payload.startTime || nowIso()) || nowIso();
  const startTime = toIso(payload.startTime || updatedAt) || updatedAt;
  const endTime = toIso(payload.endTime || '');
  const confidence = clamp(Number(payload.confidence || 0.5), 0, 1);
  const privacyLevel =
    payload.privacyLevel === 'trusted-only' || payload.privacyLevel === 'aggregated'
      ? payload.privacyLevel
      : 'public';

  const source = payload.source && typeof payload.source === 'object' ? payload.source : {};

  return {
    id: String(payload.id || toEventDedupeKey(payload)),
    type: String(payload.type || 'unknown'),
    subtype: String(payload.subtype || ''),
    severity,
    urgency,
    certainty,
    confidence,
    startTime,
    endTime: endTime || null,
    updatedAt,
    geometry: geometry || null,
    bbox,
    region: payload.region || null,
    source: {
      name: String(source.name || 'Unknown source'),
      trustTier: String(source.trustTier || 'C'),
      sourceClass: normalizeSourceClass(
        source.sourceClass || (String(source.trustTier || '').toUpperCase() === 'A' ? 'official' : 'reference'),
      ),
      sourceAuthority: clamp(Number(source.sourceAuthority || 0), 0, 1),
      referenceUrl: source.referenceUrl ? String(source.referenceUrl) : undefined,
    },
    recommendedActions: Array.isArray(payload.recommendedActions)
      ? payload.recommendedActions.filter(item => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
      : [],
    privacyLevel,
  };
};

module.exports = {
  nowIso,
  toIso,
  toMillis,
  clamp,
  parseCsvList,
  parseBbox,
  bboxFromPoint,
  bboxContainsPoint,
  bboxIntersects,
  haversineKm,
  normalizeSeverity,
  normalizeUrgency,
  normalizeCertainty,
  riskLevelFromCap,
  normalizeSourceClass,
  sanitizeTypesFilter,
  dedupeUnifiedEvents,
  sortByRiskAndFreshness,
  createUnifiedEvent,
};
