import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_FEATURED_EVENT_IDS,
  FEATURED_EVENTS_KEY,
} from '../constants/MonitoringEvents';
import { AlertNotification } from '../types/notifications';
import { RouteDestinationService } from './RouteDestinationService';
import {
  Coordinate,
  ImportantAlert,
  NotificationCenterState,
  classifyImportantAlerts,
  createEmptyNotificationCenterState,
  markAllImportantAlertsRead,
  normalizeNotificationCenterState,
  pruneExpiredImportantAlertsState,
  reduceImportantAlertsState,
} from './importantAlertUtils';
import { NotificationService } from './NotificationService';

const IMPORTANT_ALERTS_STATE_KEY = '@Alert:ImportantNotificationCenterStateV1';
const LAST_LOCATION_KEY = '@Alert:LastLocation';
const MAX_IMPORTANT_ALERTS = 200;
const IMPORTANT_ALERT_NOTIFICATION_WINDOW_MS = 5 * 60 * 1000;

type IngestOptions = {
  currentLocation?: Coordinate | null;
  targetLocation?: Coordinate | null;
  userHighlights?: string[] | null;
};

type Listener = (state: NotificationCenterState) => void;

let cachedState: NotificationCenterState | null = null;
let hydratePromise: Promise<NotificationCenterState> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<Listener>();
const lastImportantNotificationAt = new Map<string, number>();

const enqueueWrite = <T,>(task: () => Promise<T>): Promise<T> => {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const emit = (state: NotificationCenterState) => {
  listeners.forEach(listener => {
    try {
      listener(state);
    } catch {
      // ignore listener errors
    }
  });
};

const persistState = async (state: NotificationCenterState): Promise<void> => {
  cachedState = state;
  await AsyncStorage.setItem(IMPORTANT_ALERTS_STATE_KEY, JSON.stringify(state));
  emit(state);
};

const readStateFromStorage = async (): Promise<NotificationCenterState> => {
  try {
    const raw = await AsyncStorage.getItem(IMPORTANT_ALERTS_STATE_KEY);
    if (!raw) return createEmptyNotificationCenterState();
    return normalizeNotificationCenterState(JSON.parse(raw));
  } catch {
    return createEmptyNotificationCenterState();
  }
};

const loadState = async (): Promise<NotificationCenterState> => {
  if (cachedState) return cachedState;
  if (!hydratePromise) {
    hydratePromise = readStateFromStorage().then(state => {
      cachedState = state;
      return state;
    });
  }
  return hydratePromise;
};

const getFreshState = async (): Promise<NotificationCenterState> => {
  const state = await loadState();
  const next = pruneExpiredImportantAlertsState(state, MAX_IMPORTANT_ALERTS);
  if (!sameStateSnapshot(state, next)) {
    await persistState(next);
    return next;
  }
  return state;
};

const readUserHighlights = async (
  override?: string[] | null,
): Promise<string[]> => {
  if (Array.isArray(override)) {
    return override.filter((item): item is string => typeof item === 'string');
  }
  try {
    const raw = await AsyncStorage.getItem(FEATURED_EVENTS_KEY);
    if (!raw) return [...DEFAULT_FEATURED_EVENT_IDS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_FEATURED_EVENT_IDS];
    const rows = parsed.filter((item: unknown): item is string => typeof item === 'string');
    return rows.length > 0 ? rows : [...DEFAULT_FEATURED_EVENT_IDS];
  } catch {
    return [...DEFAULT_FEATURED_EVENT_IDS];
  }
};

const readCurrentLocation = async (
  override?: Coordinate | null,
): Promise<Coordinate | null> => {
  if (
    override &&
    Number.isFinite(override.latitude) &&
    Number.isFinite(override.longitude)
  ) {
    return {
      latitude: Number(override.latitude),
      longitude: Number(override.longitude),
    };
  }

  try {
    const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Coordinate>;
    const latitude = Number(parsed?.latitude);
    const longitude = Number(parsed?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
};

const readTargetLocation = async (
  override?: Coordinate | null,
): Promise<Coordinate | null> => {
  if (
    override &&
    Number.isFinite(override.latitude) &&
    Number.isFinite(override.longitude)
  ) {
    return {
      latitude: Number(override.latitude),
      longitude: Number(override.longitude),
    };
  }

  try {
    const destination = await RouteDestinationService.getDefaultDestination();
    if (!destination) return null;
    const latitude = Number(destination.latitude);
    const longitude = Number(destination.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
};

const sameStateSnapshot = (
  a: NotificationCenterState,
  b: NotificationCenterState,
): boolean => {
  if (a.unreadCount !== b.unreadCount) return false;
  if (a.importantAlerts.length !== b.importantAlerts.length) return false;
  for (let i = 0; i < a.importantAlerts.length; i += 1) {
    const left = a.importantAlerts[i];
    const right = b.importantAlerts[i];
    if (
      left.id !== right.id ||
      left.read !== right.read ||
      left.timestamp !== right.timestamp ||
      left.severity !== right.severity ||
      left.source !== right.source
    ) {
      return false;
    }
  }
  return true;
};

const classifyWithContext = async (
  alerts: AlertNotification[],
  options?: IngestOptions,
): Promise<ImportantAlert[]> => {
  const [userHighlights, currentLocation, targetLocation] = await Promise.all([
    readUserHighlights(options?.userHighlights),
    readCurrentLocation(options?.currentLocation),
    readTargetLocation(options?.targetLocation),
  ]);

  return classifyImportantAlerts(alerts, {
    userHighlights,
    currentLocation,
    targetLocation,
    radiusKm: 5,
  });
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeRateLimitText = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 48)
    : '';

const buildImportantAlertNotification = (item: ImportantAlert): AlertNotification => ({
  id: item.id,
  type: item.type === 'sos' ? 'system' : 'hazard',
  title:
    item.title ||
    (item.severity === 'critical'
      ? 'Alerta critico perto de voce'
      : 'Atencao na sua area'),
  summary:
    item.summary ||
    (item.source === 'proximity' || item.source === 'route' || item.source === 'sos'
      ? 'SOS a ate 5 km'
      : 'Alerta destacado ativo'),
  timestamp: item.timestamp || new Date().toISOString(),
  sourceName: item.sourceName || 'Alert',
  data: {
    ...(isObjectRecord(item.data) ? item.data : {}),
    kind: 'important_alert',
    importantMeta: {
      source: item.source,
      severity: item.severity,
      category: item.category,
    },
  },
});

const shouldSkipNotificationByRateLimit = (item: ImportantAlert): boolean => {
  const bypassRateLimit =
    item.severity === 'critical' &&
    (item.source === 'proximity' || item.source === 'route' || item.source === 'sos');

  if (bypassRateLimit) return false;

  const now = Date.now();
  const latKey = Number.isFinite(item.lat) ? Number(item.lat).toFixed(2) : '';
  const lonKey = Number.isFinite(item.lon) ? Number(item.lon).toFixed(2) : '';
  const textKey =
    normalizeRateLimitText(item.title) ||
    normalizeRateLimitText(item.summary) ||
    normalizeRateLimitText(item.category);
  const key = `${item.category}:${item.source}:${item.severity}:${latKey}:${lonKey}:${textKey}`;
  const last = lastImportantNotificationAt.get(key) || 0;
  if (now - last < IMPORTANT_ALERT_NOTIFICATION_WINDOW_MS) {
    return true;
  }
  lastImportantNotificationAt.set(key, now);
  return false;
};

const notifyNewImportantAlerts = async (alerts: ImportantAlert[]): Promise<void> => {
  if (!Array.isArray(alerts) || alerts.length === 0) return;

  const existing = await NotificationService.getAll();
  const existingIds = new Set(existing.map(item => String(item?.id || '')));

  for (const alert of alerts) {
    if (!alert?.id || alert.read) continue;
    if (existingIds.has(alert.id)) continue;
    if (shouldSkipNotificationByRateLimit(alert)) continue;
    try {
      await NotificationService.add(buildImportantAlertNotification(alert));
      existingIds.add(alert.id);
    } catch {
      // Do not fail ingestion if local notification persistence fails.
    }
  }
};

export const ImportantAlertsService = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    if (cachedState) {
      void getFreshState().then(listener).catch(() => listener(cachedState!));
    } else {
      void getFreshState().then(listener).catch(() => {});
    }
    return () => {
      listeners.delete(listener);
    };
  },

  async getState(): Promise<NotificationCenterState> {
    return getFreshState();
  },

  async getUnreadCount(): Promise<number> {
    const state = await getFreshState();
    return state.unreadCount;
  },

  async classifyAlerts(
    alerts: AlertNotification[],
    options?: IngestOptions,
  ): Promise<ImportantAlert[]> {
    return classifyWithContext(Array.isArray(alerts) ? alerts : [], options);
  },

  async ingestAlerts(
    alerts: AlertNotification[],
    options?: IngestOptions,
  ): Promise<{ state: NotificationCenterState; importantAlerts: ImportantAlert[] }> {
    const safeAlerts = Array.isArray(alerts) ? alerts : [];
    const importantAlerts = await classifyWithContext(safeAlerts, options);

    if (importantAlerts.length === 0) {
      const state = await getFreshState();
      return { state, importantAlerts };
    }

    return enqueueWrite(async () => {
      const previous = await getFreshState();
      const next = reduceImportantAlertsState(previous, importantAlerts, MAX_IMPORTANT_ALERTS);
      const previousIds = new Set(previous.importantAlerts.map(item => item.id));
      const newlyAddedImportantAlerts = next.importantAlerts.filter(
        item => !previousIds.has(item.id),
      );
      if (!sameStateSnapshot(previous, next)) {
        await persistState(next);
      }
      await notifyNewImportantAlerts(newlyAddedImportantAlerts);
      return { state: next, importantAlerts };
    });
  },

  async markAllRead(): Promise<NotificationCenterState> {
    return enqueueWrite(async () => {
      const previous = await getFreshState();
      const next = markAllImportantAlertsRead(previous);
      if (!sameStateSnapshot(previous, next)) {
        await persistState(next);
      }
      return next;
    });
  },
};
