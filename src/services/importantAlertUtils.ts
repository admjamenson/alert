import { AlertNotification } from '../types/notifications';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type ImportantAlertSource = 'featured' | 'sos' | 'proximity' | 'route';
export type ImportantAlertSeverity = 'warning' | 'critical';

export type ImportantAlert = {
  id: string;
  type: string;
  category: string;
  severity: ImportantAlertSeverity;
  lat: number | null;
  lon: number | null;
  timestamp: string;
  source: ImportantAlertSource;
  read: boolean;
  title?: string;
  summary?: string;
  sourceName?: string;
  data?: AlertNotification['data'];
};

export type NotificationCenterState = {
  unreadCount: number;
  importantAlerts: ImportantAlert[];
};

export type ImportantAlertClassificationContext = {
  userHighlights: string[];
  currentLocation?: Coordinate | null;
  targetLocation?: Coordinate | null;
  radiusKm?: number;
};

const DEFAULT_RADIUS_KM = 5;
const IMPORTANT_ALERT_WARNING_TTL_MS = 3 * 60 * 60 * 1000;
const IMPORTANT_ALERT_CRITICAL_TTL_MS = 6 * 60 * 60 * 1000;
const LOCAL_WEATHER_THREAT_CATEGORIES = new Set([
  'storm',
  'lightning',
  'hail',
  'snowstorm',
  'flood',
  'hurricane',
  'tornado',
]);
const IMPORTANT_ALERT_SOURCE_PRIORITY: Record<ImportantAlertSource, number> = {
  proximity: 4,
  route: 3,
  sos: 2,
  featured: 1,
};
const IMPORTANT_ALERT_SEVERITY_PRIORITY: Record<ImportantAlertSeverity, number> = {
  critical: 2,
  warning: 1,
};
const IMPORTANT_WEATHER_CATEGORY_PRIORITY: Record<string, number> = {
  lightning: 5,
  hail: 4,
  storm: 3,
  flood: 2,
  snowstorm: 1,
};

const toRad = (value: number) => (value * Math.PI) / 180;

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeTimestamp = (value?: string): string => {
  if (!value) return new Date().toISOString();
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return new Date().toISOString();
  return new Date(ts).toISOString();
};

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type AlertLikeWithOptionalFields = Pick<
  AlertNotification,
  'id' | 'type' | 'title' | 'summary' | 'timestamp' | 'data'
> & {
  lat?: unknown;
  latitude?: unknown;
  lon?: unknown;
  lng?: unknown;
  longitude?: unknown;
  severity?: unknown;
  sourceName?: unknown;
};

export const isWithinRadiusKm = (
  alertCoord: Coordinate | null | undefined,
  userCoord: Coordinate | null | undefined,
  radiusKm = DEFAULT_RADIUS_KM,
): boolean => {
  if (!alertCoord || !userCoord) return false;
  if (
    !isFiniteCoord(alertCoord.latitude) ||
    !isFiniteCoord(alertCoord.longitude) ||
    !isFiniteCoord(userCoord.latitude) ||
    !isFiniteCoord(userCoord.longitude)
  ) {
    return false;
  }

  const R = 6371;
  const dLat = toRad(userCoord.latitude - alertCoord.latitude);
  const dLon = toRad(userCoord.longitude - alertCoord.longitude);
  const lat1 = toRad(alertCoord.latitude);
  const lat2 = toRad(userCoord.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const distance = 2 * R * Math.asin(Math.sqrt(h));

  return distance <= Math.max(0, radiusKm);
};

export const mapAlertToCategory = (
  alert: Pick<AlertNotification, 'type' | 'title' | 'summary'> &
    Partial<Pick<AlertNotification, 'data'>>,
): string => {
  if (alert.type === 'sos') return 'sos';
  const payload = alert?.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const eventType = String((payload as Record<string, unknown>)?.eventType || '')
      .trim()
      .toLowerCase();
    if (eventType.length > 0) return eventType;
  }
  const text = `${normalizeText(alert.title)} ${normalizeText(alert.summary)}`.toLowerCase();
  if (text.includes('terremoto') || text.includes('sismo')) return 'earthquake';
  if (text.includes('furac') || text.includes('ciclone')) return 'hurricane';
  if (text.includes('tornado')) return 'tornado';
  if (text.includes('vendaval') || text.includes('vento')) return 'gale';
  if (text.includes('tempest')) return 'storm';
  if (text.includes('chuva') || text.includes('alag') || text.includes('inund'))
    return 'flood';
  if (text.includes('desliz')) return 'landslide';
  if (text.includes('granizo')) return 'hail';
  if (text.includes('calor')) return 'heatwave';
  if (text.includes('neblina')) return 'fog';
  if (text.includes('incend') || text.includes('incênd')) return 'wildfire';
  if (text.includes('maremoto') || text.includes('tsunami')) return 'tsunami';
  if (text.includes('neve') || text.includes('nevasca')) return 'snowstorm';
  if (text.includes('raio')) return 'lightning';
  if (text.includes('energia') || text.includes('power')) return 'energy_outage';
  if (text.includes('água') || text.includes('agua') || text.includes('water'))
    return 'water_outage';
  return '';
};

export const isFeaturedCategory = (
  category: string | null | undefined,
  userHighlights: string[] | null | undefined,
): boolean => {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  if (!normalizedCategory) return false;
  if (!Array.isArray(userHighlights) || userHighlights.length === 0) return false;
  return userHighlights.some(item => String(item || '').trim().toLowerCase() === normalizedCategory);
};

export const isSosAlert = (alert: Pick<AlertNotification, 'type' | 'title' | 'summary'>): boolean => {
  if (alert.type === 'sos') return true;
  const text = `${normalizeText(alert.title)} ${normalizeText(alert.summary)}`.toLowerCase();
  return text.includes('sos');
};

const isLocalWeatherThreatCategory = (category: string | null | undefined): boolean =>
  LOCAL_WEATHER_THREAT_CATEGORIES.has(String(category || '').trim().toLowerCase());

export const extractAlertCoordinate = (alert: AlertLikeWithOptionalFields): Coordinate | null => {
  const topLat = Number(alert.lat ?? alert.latitude);
  const topLon = Number(alert.lon ?? alert.longitude ?? alert.lng);
  if (isFiniteCoord(topLat) && isFiniteCoord(topLon)) {
    return { latitude: topLat, longitude: topLon };
  }

  const data = alert.data;
  if (!isObjectRecord(data)) return null;
  const payload = data as Record<string, unknown>;

  const location = isObjectRecord(payload.location) ? payload.location : payload;
  const lat = Number(location.latitude ?? location.lat);
  const lon = Number(location.longitude ?? location.lon ?? location.lng);
  if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return null;
  return { latitude: lat, longitude: lon };
};

const normalizeSeverity = (
  rawSeverity: unknown,
  source: ImportantAlertSource,
): ImportantAlertSeverity => {
  if (source === 'proximity' || source === 'route' || source === 'sos') {
    return 'critical';
  }
  const severityText = String(rawSeverity || '').toLowerCase();
  if (
    severityText.includes('extreme') ||
    severityText.includes('severe') ||
    severityText.includes('major') ||
    severityText.includes('critical')
  ) {
    return 'critical';
  }
  if (severityText.includes('moderate') || severityText.includes('minor')) {
    return 'warning';
  }
  return 'warning';
};

const buildFallbackId = (
  alert: Pick<AlertNotification, 'type' | 'title' | 'summary' | 'timestamp' | 'data'>,
  category: string,
  coord: Coordinate | null,
): string => {
  const senderName = isObjectRecord(alert.data)
    ? normalizeText((alert.data as Record<string, unknown>).senderName)
    : '';
  const latPart = coord ? coord.latitude.toFixed(4) : '';
  const lonPart = coord ? coord.longitude.toFixed(4) : '';
  const titlePart = normalizeText(alert.title).slice(0, 50);
  const summaryPart = normalizeText(alert.summary).slice(0, 50);
  const tsPart = alert.type === 'sos' ? '' : normalizeTimestamp(alert.timestamp);
  return [
    'important',
    normalizeText(alert.type) || 'unknown',
    category || 'uncategorized',
    senderName,
    latPart,
    lonPart,
    tsPart,
    titlePart,
    summaryPart,
  ]
    .filter(Boolean)
    .join(':');
};

const normalizeAlertId = (
  alert: Pick<AlertNotification, 'id' | 'type' | 'title' | 'summary' | 'timestamp' | 'data'>,
  category: string,
  coord: Coordinate | null,
): string => {
  const id = normalizeText(alert.id);
  if (id && id !== 'sos-active') return id;
  return buildFallbackId(alert, category, coord);
};

export const classifyImportantAlert = (
  alert: AlertNotification,
  context: ImportantAlertClassificationContext,
): ImportantAlert | null => {
  const extendedAlert = alert as AlertLikeWithOptionalFields;
  const category = mapAlertToCategory(alert);
  const featured = isFeaturedCategory(category, context.userHighlights);
  const sos = isSosAlert(alert);
  const localWeatherThreat = isLocalWeatherThreatCategory(category);
  const coord = extractAlertCoordinate(extendedAlert);
  const radiusKm = Number.isFinite(context.radiusKm as number)
    ? Math.max(0, Number(context.radiusKm))
    : DEFAULT_RADIUS_KM;

  const nearCurrent =
    (sos || localWeatherThreat) && isWithinRadiusKm(coord, context.currentLocation, radiusKm);
  const nearTarget =
    (sos || localWeatherThreat) && isWithinRadiusKm(coord, context.targetLocation, radiusKm);

  const isImportant = featured || nearCurrent || nearTarget;
  if (!isImportant) return null;

  const source: ImportantAlertSource = nearCurrent
    ? 'proximity'
    : nearTarget
      ? 'route'
      : sos
        ? 'sos'
        : 'featured';

  const severity = normalizeSeverity(extendedAlert.severity, source);

  return {
    id: normalizeAlertId(alert, category, coord),
    type: String(alert.type || 'system'),
    category: category || (sos ? 'sos' : 'unknown'),
    severity,
    lat: coord?.latitude ?? null,
    lon: coord?.longitude ?? null,
    timestamp: normalizeTimestamp(alert.timestamp),
    source,
    read: false,
    title: normalizeText(alert.title) || undefined,
    summary: normalizeText(alert.summary) || undefined,
    sourceName: normalizeText(extendedAlert.sourceName) || undefined,
    data: alert.data,
  };
};

const getImportantAlertFreshness = (item: Pick<ImportantAlert, 'timestamp'>): number => {
  const value = Date.parse(item.timestamp || '');
  return Number.isFinite(value) ? value : 0;
};

const getImportantAlertCategoryPriority = (
  item: Pick<ImportantAlert, 'category'>,
): number => IMPORTANT_WEATHER_CATEGORY_PRIORITY[String(item.category || '').trim().toLowerCase()] || 0;

export const compareImportantAlerts = (
  a: Pick<ImportantAlert, 'id' | 'severity' | 'source' | 'timestamp' | 'category'>,
  b: Pick<ImportantAlert, 'id' | 'severity' | 'source' | 'timestamp' | 'category'>,
): number => {
  const severityDelta =
    IMPORTANT_ALERT_SEVERITY_PRIORITY[b.severity] - IMPORTANT_ALERT_SEVERITY_PRIORITY[a.severity];
  if (severityDelta !== 0) return severityDelta;

  const sourceDelta =
    IMPORTANT_ALERT_SOURCE_PRIORITY[b.source] - IMPORTANT_ALERT_SOURCE_PRIORITY[a.source];
  if (sourceDelta !== 0) return sourceDelta;

  const freshnessDelta = getImportantAlertFreshness(b) - getImportantAlertFreshness(a);
  if (freshnessDelta !== 0) return freshnessDelta;

  const categoryDelta = getImportantAlertCategoryPriority(b) - getImportantAlertCategoryPriority(a);
  if (categoryDelta !== 0) return categoryDelta;

  return String(a.id || '').localeCompare(String(b.id || ''));
};

export const classifyImportantAlerts = (
  alerts: AlertNotification[],
  context: ImportantAlertClassificationContext,
): ImportantAlert[] => {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  const out: ImportantAlert[] = [];
  for (const alert of alerts) {
    const classified = classifyImportantAlert(alert, context);
    if (classified) out.push(classified);
  }
  return out.sort(compareImportantAlerts);
};

export const createEmptyNotificationCenterState = (): NotificationCenterState => ({
  unreadCount: 0,
  importantAlerts: [],
});

const getImportantAlertTtlMs = (alert: Pick<ImportantAlert, 'severity'>): number =>
  alert.severity === 'critical'
    ? IMPORTANT_ALERT_CRITICAL_TTL_MS
    : IMPORTANT_ALERT_WARNING_TTL_MS;

const isFreshImportantAlert = (
  alert: Pick<ImportantAlert, 'timestamp' | 'severity'>,
  now = Date.now(),
): boolean => {
  const ts = Date.parse(alert.timestamp || '');
  if (!Number.isFinite(ts)) return false;
  if (ts > now + 10 * 60 * 1000) return false;
  return now - ts <= getImportantAlertTtlMs(alert);
};

export const pruneExpiredImportantAlertsState = (
  state: NotificationCenterState,
  maxItems = 200,
  now = Date.now(),
): NotificationCenterState => {
  const freshAlerts = (Array.isArray(state.importantAlerts) ? state.importantAlerts : [])
    .filter(item => item?.id && isFreshImportantAlert(item, now))
    .sort(compareImportantAlerts)
    .slice(0, Math.max(1, maxItems));

  return {
    unreadCount: freshAlerts.reduce((count, item) => count + (item.read ? 0 : 1), 0),
    importantAlerts: freshAlerts,
  };
};

export const markAllImportantAlertsRead = (
  state: NotificationCenterState,
): NotificationCenterState => {
  if (!state.unreadCount) return state;
  const nextAlerts = state.importantAlerts.map(item =>
    item.read ? item : { ...item, read: true },
  );
  return {
    unreadCount: 0,
    importantAlerts: nextAlerts,
  };
};

export const reduceImportantAlertsState = (
  previous: NotificationCenterState,
  incomingAlerts: ImportantAlert[],
  maxItems = 200,
): NotificationCenterState => {
  const now = Date.now();
  const previousFresh = pruneExpiredImportantAlertsState(previous, maxItems, now);
  const safeIncoming = Array.isArray(incomingAlerts)
    ? incomingAlerts.filter(item => item?.id && isFreshImportantAlert(item, now))
    : [];

  if (safeIncoming.length === 0) {
    return previousFresh;
  }

  const byId = new Map<string, ImportantAlert>();
  previousFresh.importantAlerts.forEach(item => {
    if (!item?.id) return;
    byId.set(item.id, item);
  });

  safeIncoming.forEach(item => {
    if (!item?.id) return;
    const existing = byId.get(item.id);
    if (existing) {
      byId.set(item.id, {
        ...existing,
        ...item,
        read: existing.read,
      });
      return;
    }

    byId.set(item.id, {
      ...item,
      read: Boolean(item.read),
    });
  });

  return pruneExpiredImportantAlertsState(
    {
      unreadCount: 0,
      importantAlerts: Array.from(byId.values()),
    },
    maxItems,
    now,
  );
};

export const normalizeNotificationCenterState = (
  raw: unknown,
): NotificationCenterState => {
  if (!raw || typeof raw !== 'object') return createEmptyNotificationCenterState();
  const candidate = raw as Partial<NotificationCenterState>;
  const rows = Array.isArray(candidate.importantAlerts) ? candidate.importantAlerts : [];
  const importantAlerts = rows
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const typed = item as Partial<ImportantAlert>;
      return {
        id: normalizeText(typed.id),
        type: normalizeText(typed.type) || 'system',
        category: normalizeText(typed.category) || 'unknown',
        severity: typed.severity === 'critical' ? 'critical' : 'warning',
        lat: isFiniteCoord(typed.lat) ? typed.lat : null,
        lon: isFiniteCoord(typed.lon) ? typed.lon : null,
        timestamp: normalizeTimestamp(typed.timestamp),
        source:
          typed.source === 'proximity' ||
          typed.source === 'route' ||
          typed.source === 'sos'
            ? typed.source
            : 'featured',
        read: Boolean(typed.read),
        title: normalizeText(typed.title) || undefined,
        summary: normalizeText(typed.summary) || undefined,
        sourceName: normalizeText(typed.sourceName) || undefined,
        data: typed.data,
      } as ImportantAlert;
    })
    .filter(item => item.id.length > 0);

  let normalized = reduceImportantAlertsState(
    createEmptyNotificationCenterState(),
    importantAlerts.map(item => ({ ...item })),
    200,
  );
  if (importantAlerts.some(item => item.read)) {
    const readIds = new Set(importantAlerts.filter(item => item.read).map(item => item.id));
    normalized.importantAlerts = normalized.importantAlerts.map(item =>
      readIds.has(item.id) ? { ...item, read: true } : item,
    );
    normalized.unreadCount = normalized.importantAlerts.reduce(
      (count, item) => count + (item.read ? 0 : 1),
      0,
    );
  }
  normalized = pruneExpiredImportantAlertsState(normalized, 200);
  return normalized;
};
