import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';

import i18n from '../i18n';
import { AlertNotification } from '../types/notifications';
import { NotificationService } from './NotificationService';
import { AlertFeedsApiAdapter } from '../infrastructure/adapters/AlertFeedsApiAdapter';

const WEATHER_CACHE_KEY = '@Alert:WeatherCacheV4';
const ALERTS_CACHE_KEY = '@Alert:RiskFeedCacheV1';
const PREALERT_KEY = '@Alert:PreAlertTs';
const WEATHER_CACHE_TTL_MS = 60 * 1000;
const ALERTS_CACHE_TTL_MS = 15 * 60 * 1000;
const PREALERT_TTL_MS = 15 * 60 * 1000;
const DIST_THRESHOLD_KM = 1;

type WeatherCache = {
  lat: number;
  lon: number;
  ts: number;
  data: WeatherResult;
};

type AlertsCache = {
  lat: number;
  lon: number;
  ts: number;
  data: AlertNotification[];
};

export type WeatherResult = {
  city: string;
  temp: string;
  wind: number;
  icon: string;
  label: string;
  feelsLike?: string;
  minTemp?: string;
  maxTemp?: string;
  forecastLabel?: string;
  forecastDays?: Array<{
    dayLabel: string;
    icon: string;
    maxTemp: string;
    minTemp: string;
    rainChance?: number | null;
  }>;
  isDay: boolean;
  sunrise?: string;
  sunset?: string;
  timeZone?: string;
  intelligenceSignal?: {
    kind: 'rain' | 'snow' | 'hail' | 'lightning' | 'thunder';
    icon: string;
    label: string;
    confidence: number;
    startsInMinutes: number;
    source: 'current' | 'forecast';
  } | null;
  timestamp: string;
};

const WEATHER_LABEL_FALLBACKS: Record<string, string> = {
  weather_clear_sky_day: 'Céu limpo',
  weather_clear_sky_night: 'Noite limpa',
  weather_partly_cloudy: 'Parcialmente nublado',
  weather_overcast: 'Nublado',
  weather_fog: 'Neblina',
  weather_rain: 'Chuva',
  weather_showers: 'Pancadas',
  weather_snow: 'Neve',
  weather_snow_showers: 'Nevasca',
  weather_hail: 'Granizo',
  weather_signal_rain: 'Chuva próxima',
  weather_signal_snow: 'Neve próxima',
  weather_signal_hail: 'Granizo próximo',
  weather_signal_lightning: 'Raios próximos',
  weather_signal_thunder: 'Trovoadas próximas',
};

const getDistanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
};

const isWithinKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  getDistanceKm(a, b) <= DIST_THRESHOLD_KM;

const formatTemperature = (value: number | null | undefined): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `${Math.round(value)}°`;
};

const getLocaleTag = () => getLocales()?.[0]?.languageTag || 'pt-BR';

const translateWeatherKey = (key: string | undefined): string => {
  if (!key) return '';
  const localeTag = getLocaleTag();
  const translator = i18n.getFixedT(localeTag.toLowerCase().startsWith('pt') ? 'pt' : 'en');
  return translator(key, {
    defaultValue: WEATHER_LABEL_FALLBACKS[key] || key,
  });
};

const formatForecastDayLabel = (dateValue: string, localeTag: string): string => {
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return '';
  const raw = date.toLocaleDateString(localeTag, { weekday: 'short' });
  const normalized = String(raw || '')
    .replace('.', '')
    .trim();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const toWeatherResult = (
  feed: Awaited<ReturnType<typeof AlertFeedsApiAdapter.getWeatherFeed>>,
): WeatherResult => {
  const localeTag = getLocaleTag();
  const current = feed.current;
  const daily = feed.daily || { forecastDays: [] };
  const forecastDays = Array.isArray(daily.forecastDays)
    ? daily.forecastDays.map(day => ({
        dayLabel: formatForecastDayLabel(day.date, localeTag),
        icon: String(day.icon || 'weather-cloudy'),
        maxTemp: formatTemperature(day.maxTempC) || '--',
        minTemp: formatTemperature(day.minTempC) || '--',
        rainChance:
          typeof day.rainChance === 'number' ? Math.round(day.rainChance) : null,
      }))
    : [];
  const maxTemp = formatTemperature(daily.maxTempC);
  const minTemp = formatTemperature(daily.minTempC);

  return {
    city: String(feed.location?.city || '').trim() || '...',
    temp: formatTemperature(current?.tempC) || '--',
    wind: Number(current?.windKmh || 0),
    icon: String(current?.icon || 'weather-cloudy'),
    label: translateWeatherKey(current?.labelKey),
    feelsLike: formatTemperature(current?.apparentTempC),
    minTemp,
    maxTemp,
    forecastLabel:
      maxTemp && minTemp ? `${maxTemp}/${minTemp}` : maxTemp || minTemp || '',
    forecastDays,
    isDay: Boolean(current?.isDay),
    sunrise: typeof daily.sunrise === 'string' ? daily.sunrise : undefined,
    sunset: typeof daily.sunset === 'string' ? daily.sunset : undefined,
    timeZone:
      typeof feed.location?.timezone === 'string'
        ? feed.location.timezone
        : undefined,
    intelligenceSignal: feed.intelligenceSignal
      ? {
          ...feed.intelligenceSignal,
          label: translateWeatherKey(feed.intelligenceSignal.labelKey),
        }
      : null,
    timestamp: new Date().toISOString(),
  };
};

export const mapWmoToIcon = (_code: number, _isDay: boolean) => ({
  icon: 'weather-cloudy',
  label: translateWeatherKey('weather_overcast'),
});

const shouldPreAlert = (items: AlertNotification[], riskScore?: number) => {
  if (items.length === 0) return false;
  if (typeof riskScore === 'number' && riskScore >= 0.46) return true;
  return items.some(item => {
    const severity = String((item as any)?.severity || '');
    return ['Severe', 'Extreme', 'Major'].includes(severity);
  });
};

export const WeatherService = {
  async getCachedWeather(): Promise<WeatherResult | null> {
    const cachedRaw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
    if (!cachedRaw) return null;
    try {
      const cached = JSON.parse(cachedRaw) as WeatherCache;
      return cached?.data || null;
    } catch {
      return null;
    }
  },

  async getCurrentWeather(
    lat: number,
    lon: number,
    options?: { force?: boolean },
  ): Promise<WeatherResult> {
    const cachedRaw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
    let cached: WeatherCache | null = null;

    if (cachedRaw) {
      try {
        cached = JSON.parse(cachedRaw) as WeatherCache;
      } catch {
        cached = null;
      }
    }

    if (
      !options?.force &&
      cached &&
      Date.now() - cached.ts < WEATHER_CACHE_TTL_MS &&
      isWithinKm({ lat: cached.lat, lon: cached.lon }, { lat, lon })
    ) {
      return cached.data;
    }

    try {
      const feed = await AlertFeedsApiAdapter.getWeatherFeed({
        latitude: lat,
        longitude: lon,
        locale: getLocaleTag(),
      });
      const data = toWeatherResult(feed);
      const cache: WeatherCache = { lat, lon, ts: Date.now(), data };
      await AsyncStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
      return data;
    } catch {
      if (cached?.data) return cached.data;
      return {
        city: '...',
        temp: '--',
        wind: 0,
        icon: 'weather-cloudy',
        label: '',
        isDay: true,
        timestamp: new Date().toISOString(),
      };
    }
  },

  async getAlerts(
    lat: number,
    lon: number,
    riskScore?: number,
    options?: { force?: boolean },
  ): Promise<AlertNotification[]> {
    const cachedRaw = await AsyncStorage.getItem(ALERTS_CACHE_KEY);
    let cached: AlertsCache | null = null;

    if (cachedRaw) {
      try {
        cached = JSON.parse(cachedRaw) as AlertsCache;
      } catch {
        cached = null;
      }
    }

    if (
      !options?.force &&
      cached &&
      Date.now() - cached.ts < ALERTS_CACHE_TTL_MS &&
      isWithinKm({ lat: cached.lat, lon: cached.lon }, { lat, lon })
    ) {
      return cached.data;
    }

    try {
      const payload = await AlertFeedsApiAdapter.getRiskFeed({
        latitude: lat,
        longitude: lon,
        riskScore,
      });
      const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
      const cache: AlertsCache = { lat, lon, ts: Date.now(), data: alerts };
      await AsyncStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(cache));

      const shouldNotify =
        Boolean(payload.preAlert?.shouldNotify) || shouldPreAlert(alerts, riskScore);
      if (shouldNotify) {
        const lastRaw = await AsyncStorage.getItem(PREALERT_KEY);
        const lastTs = lastRaw ? Number(lastRaw) : 0;
        if (!lastTs || Date.now() - lastTs > PREALERT_TTL_MS) {
          const localeTag = getLocaleTag();
          const translator = i18n.getFixedT(
            localeTag.toLowerCase().startsWith('pt') ? 'pt' : 'en',
          );
          await NotificationService.add({
            id: `prealert-${Date.now()}`,
            type: 'system',
            title: translator('weather_prealert_title', {
              defaultValue: 'Pre-alerta',
            }),
            summary: translator('weather_prealert_body', {
              defaultValue: 'Atividade de risco detectada na sua região.',
            }),
            timestamp: new Date().toISOString(),
            sourceName: 'Alert',
          });
          await AsyncStorage.setItem(PREALERT_KEY, String(Date.now()));
        }
      }

      return alerts;
    } catch {
      return cached?.data || [];
    }
  },

  hasNearbySos(alerts: AlertNotification[]): boolean {
    return alerts.some(item =>
      item.type === 'sos' || String(item.title || '').toLowerCase().includes('sos'),
    );
  },
};
