import { AlertNotification } from '../types/notifications';
import {
  Coordinate,
  extractAlertCoordinate,
  isWithinRadiusKm,
  mapAlertToCategory,
} from './importantAlertUtils';

export type ImportantWeatherCategory =
  | 'storm'
  | 'lightning'
  | 'hail'
  | 'snowstorm'
  | 'flood';

const IMPORTANT_WEATHER_CATEGORIES = new Set<ImportantWeatherCategory>([
  'storm',
  'lightning',
  'hail',
  'snowstorm',
  'flood',
]);

const WEATHER_IMPORTANT_BUCKET_MS = 15 * 60 * 1000;
const WEATHER_IMPORTANT_DEDUPE_RADIUS_KM = 8;

const normalizeText = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

export const normalizeImportantWeatherCategory = (
  value?: string | null,
): ImportantWeatherCategory | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized === 'hurricane' || normalized === 'tornado') return 'storm';
  if (!IMPORTANT_WEATHER_CATEGORIES.has(normalized as ImportantWeatherCategory)) {
    return null;
  }
  return normalized as ImportantWeatherCategory;
};

const bucketizeWeatherTimestamp = (timestamp?: string, nowMs = Date.now()): number => {
  const sourceTime = Date.parse(String(timestamp || ''));
  const safeTime = Number.isFinite(sourceTime) ? sourceTime : nowMs;
  return Math.floor(safeTime / WEATHER_IMPORTANT_BUCKET_MS);
};

const buildWeatherImportantAlertId = ({
  category,
  latitude,
  longitude,
  timestamp,
  nowMs,
}: {
  category: ImportantWeatherCategory;
  latitude: number;
  longitude: number;
  timestamp?: string;
  nowMs?: number;
}): string => {
  const latKey = Number(latitude).toFixed(2);
  const lonKey = Number(longitude).toFixed(2);
  const bucket = bucketizeWeatherTimestamp(timestamp, nowMs);
  return `weather-important:${category}:${latKey}:${lonKey}:${bucket}`;
};

const hasEquivalentExternalWeatherAlert = (
  alerts: AlertNotification[],
  category: ImportantWeatherCategory,
  location: Coordinate,
): boolean =>
  alerts.some(alert => {
    const existingCategory = normalizeImportantWeatherCategory(mapAlertToCategory(alert));
    if (!existingCategory || existingCategory !== category) {
      return false;
    }

    const syntheticSource = normalizeText(
      (alert.data as Record<string, unknown> | undefined)?.syntheticSource,
    );
    if (syntheticSource === 'weather nowcast') {
      return true;
    }

    const coord = extractAlertCoordinate(alert as AlertNotification & Record<string, unknown>);
    if (!coord) {
      return false;
    }

    return isWithinRadiusKm(coord, location, WEATHER_IMPORTANT_DEDUPE_RADIUS_KM);
  });

export const buildWeatherImportantAlertCandidateFromSignal = ({
  alerts,
  category,
  label,
  latitude,
  longitude,
  localeTag,
  timestamp,
  nowMs,
}: {
  alerts: AlertNotification[];
  category?: string | null;
  label: string;
  latitude: number;
  longitude: number;
  localeTag: string;
  timestamp?: string;
  nowMs?: number;
}): AlertNotification | null => {
  const normalizedCategory = normalizeImportantWeatherCategory(category);
  if (!normalizedCategory) {
    return null;
  }

  const location = {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };

  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return null;
  }

  if (hasEquivalentExternalWeatherAlert(alerts, normalizedCategory, location)) {
    return null;
  }

  return {
    id: buildWeatherImportantAlertId({
      category: normalizedCategory,
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp,
      nowMs,
    }),
    type: 'hazard',
    title: label,
    summary: label,
    timestamp: timestamp || new Date(nowMs || Date.now()).toISOString(),
    data: {
      eventType: normalizedCategory,
      locale: localeTag,
      syntheticSource: 'weather_nowcast',
      location,
    },
  };
};
