import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';
import { AlertNotification } from '../types/notifications';
import i18n from '../i18n';
import { NotificationService } from './NotificationService';
import { normalizeToIsoDateTime } from '../utils/dateTimeFormat';
import { EntitlementService } from './EntitlementService';
import { CostGuard } from './cost/CostGuard';
import CostPolicy from '../domain/cost/CostPolicy';

const WEATHER_CACHE_KEY = '@Alert:WeatherCacheV3';
const LEGACY_WEATHER_CACHE_KEYS = ['@Alert:WeatherCache', '@Alert:WeatherCacheV2'];
const ALERTS_CACHE_KEY = '@Alert:AlertsCache';
const PREALERT_KEY = '@Alert:PreAlertTs';

const WEATHER_CACHE_TTL = 60 * 1000; // 1min
const ALERTS_CACHE_TTL = 15 * 60 * 1000; // 15min
const DIST_THRESHOLD_KM = 1; // 1km
const MAX_RADIUS_KM = 300;
const USER_AGENT = 'AlertApp/1.0 (contact: support@alertapp.com)';
const GEO_TIMEOUT_MS = 2000;
const WEATHER_TIMEOUT_MS = 6500;
const REVERSE_TIMEOUT_MS = 2000;

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

type WeatherIntelligenceSignal = NonNullable<WeatherResult['intelligenceSignal']>;

const getDistanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const isWithinKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  getDistanceKm(a, b) <= DIST_THRESHOLD_KM;

const pickFirst = (...values: Array<string | undefined | null>) =>
  values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
const DEGREE_SYMBOL = '\u00B0';
const REPLACEMENT_CHAR = '\uFFFD';
const CYRILLIC_A = '\u0410';
const CORRUPTED_TEXT_MARKERS = [REPLACEMENT_CHAR, CYRILLIC_A, 'Sensa', 'tщrmica'];

const sanitizeWeatherString = (value: string | undefined | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const next = value
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/\u00C2/g, '')
    .replace(/ï¿½/g, '')
    .replace(/\u0410/g, DEGREE_SYMBOL)
    .replace(/\u00BA/g, DEGREE_SYMBOL)
    .replace(/[Âº°]/g, DEGREE_SYMBOL)
    .replace(/[?Â¿]+(?=\s*$|\/)/g, '')
    .replace(/[^\p{L}\p{N}\s\-_,./:+()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return next || undefined;
};

const extractTemperatureValues = (
  value: string | number | undefined | null,
): number[] => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [value];
  }
  if (typeof value !== 'string') return [];
  const normalized = value
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/\u00C2/g, '')
    .replace(/ï¿½/g, '')
    .replace(/\u0410/g, DEGREE_SYMBOL)
    .replace(/\u00BA/g, DEGREE_SYMBOL)
    .replace(/[Âº°]/g, DEGREE_SYMBOL)
    .replace(/,/g, '.');
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
  return matches.map(item => Number(item)).filter(item => Number.isFinite(item));
};

const formatRoundedTemperature = (value: number | null | undefined): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `${Math.round(Number(value))}${DEGREE_SYMBOL}`;
};

const sanitizeTemperatureValue = (
  value: string | number | undefined | null,
): string | undefined => {
  const [first] = extractTemperatureValues(value);
  return formatRoundedTemperature(first);
};

const sanitizeTemperatureRange = (
  value: string | undefined | null,
  maxTemp?: string,
  minTemp?: string,
): string | undefined => {
  if (maxTemp && minTemp) {
    return `${maxTemp}/${minTemp}`;
  }
  const values = extractTemperatureValues(value);
  if (values.length >= 2) {
    const first = formatRoundedTemperature(values[0]);
    const second = formatRoundedTemperature(values[1]);
    if (first && second) {
      return `${first}/${second}`;
    }
  }
  return undefined;
};

const hasCorruptedWeatherText = (value: string | undefined | null): boolean => {
  if (typeof value !== 'string' || !value) return false;
  return (
    CORRUPTED_TEXT_MARKERS.some(marker => value.includes(marker)) ||
    value.includes(REPLACEMENT_CHAR) ||
    value.includes(CYRILLIC_A) ||
    value.includes('\u00C2') ||
    value.includes('ï¿½') ||
    /\d[?Â¿ï¿½]/.test(value)
  );
};

let legacyWeatherCacheCleared = false;

const clearLegacyWeatherCachesIfNeeded = async () => {
  if (legacyWeatherCacheCleared) return;
  legacyWeatherCacheCleared = true;
  try {
    await AsyncStorage.multiRemove(LEGACY_WEATHER_CACHE_KEYS);
  } catch {
    // ignore storage cleanup failures
  }
};

const sanitizeForecastDays = (days: WeatherResult['forecastDays'] | undefined) =>
  days?.map(day => ({
    ...day,
    dayLabel: sanitizeWeatherString(day.dayLabel) || '',
    icon: sanitizeWeatherString(day.icon) || 'weather-cloudy',
    maxTemp: sanitizeTemperatureValue(day.maxTemp) || '--',
    minTemp: sanitizeTemperatureValue(day.minTemp) || '--',
  }));

const sanitizeWeatherPayload = (data: WeatherResult): WeatherResult => {
  const maxTemp = sanitizeTemperatureValue(data.maxTemp);
  const minTemp = sanitizeTemperatureValue(data.minTemp);
  return {
    ...data,
    city: sanitizeWeatherString(data.city) || '...',
    temp: sanitizeTemperatureValue(data.temp) || '--',
    icon: sanitizeWeatherString(data.icon) || 'weather-cloudy',
    label: sanitizeWeatherString(data.label) || '...',
    feelsLike: sanitizeTemperatureValue(data.feelsLike),
    minTemp,
    maxTemp,
    forecastLabel: sanitizeTemperatureRange(data.forecastLabel, maxTemp, minTemp),
    forecastDays: sanitizeForecastDays(data.forecastDays),
    sunrise: sanitizeWeatherString(data.sunrise),
    sunset: sanitizeWeatherString(data.sunset),
    timeZone: sanitizeWeatherString(data.timeZone),
    intelligenceSignal: data.intelligenceSignal
      ? {
          ...data.intelligenceSignal,
          icon: sanitizeWeatherString(data.intelligenceSignal.icon) || 'weather-cloudy',
          label: sanitizeWeatherString(data.intelligenceSignal.label) || '',
        }
      : null,
  };
};

const hasCorruptedWeatherPayload = (data: WeatherResult | null | undefined): boolean => {
  if (!data) return false;
  return [
    data.city,
    data.temp,
    data.label,
    data.feelsLike,
    data.minTemp,
    data.maxTemp,
    data.forecastLabel,
    data.sunrise,
    data.sunset,
    data.timeZone,
    data.intelligenceSignal?.label,
    data.intelligenceSignal?.icon,
    ...(data.forecastDays || []).flatMap(day => [day.dayLabel, day.icon, day.maxTemp, day.minTemp]),
  ].some(hasCorruptedWeatherText);
};


const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>(resolve => {
    timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result as T | null;
  } catch {
    return null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const resolveCityFromNominatim = (geoData: any) => {
  const address = geoData?.address || {};
  return (
    pickFirst(
      address.city,
      address.town,
      address.village,
      address.hamlet,
      address.municipality,
      address.county,
      address.city_district,
      address.suburb,
      address.neighbourhood,
      address.state_district,
      address.state,
      address.region,
      address.province,
      address.country,
    ) || pickFirst(geoData?.name, geoData?.display_name?.split(',')?.[0])
  );
};

const resolveCityFromMeteo = (reverseData: any) => {
  const result = reverseData?.results?.[0];
  return pickFirst(
    result?.name,
    result?.locality,
    result?.admin2,
    result?.admin1,
    result?.country,
  );
};

const isStormWmoCode = (code: number) => code >= 95 && code <= 99;
const isSnowWmoCode = (code: number) => (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
const isHailWmoCode = (code: number) => code === 79 || (code >= 96 && code <= 99);

const isRainWmoCode = (code: number) =>
  (code >= 51 && code <= 67) || (code >= 80 && code <= 82);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const kmhToMs = (value: number) => value / 3.6;

const normalizeRelativeHumidity = (value: number | null | undefined): number | null => {
  if (!isFiniteNumber(value)) return null;
  return clampNumber(value, 0, 100);
};

const calculateHeatIndexC = (tempC: number, relativeHumidity: number | null): number | null => {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(relativeHumidity)) return null;
  if (tempC < 26 || relativeHumidity < 40) return null;
  const tempF = tempC * 9 / 5 + 32;
  const rh = relativeHumidity;
  const heatIndexF =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;
  return (heatIndexF - 32) * 5 / 9;
};

const calculateWindChillC = (tempC: number, windKmh: number): number | null => {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(windKmh)) return null;
  if (tempC > 10 || windKmh < 4.8) return null;
  return (
    13.12 +
    0.6215 * tempC -
    11.37 * Math.pow(windKmh, 0.16) +
    0.3965 * tempC * Math.pow(windKmh, 0.16)
  );
};

const calculateApparentTemperatureC = (
  tempC: number,
  relativeHumidity: number | null,
  windKmh: number,
): number | null => {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(windKmh) || !isFiniteNumber(relativeHumidity)) {
    return null;
  }
  const vaporPressure =
    (relativeHumidity / 100) *
    6.105 *
    Math.exp((17.27 * tempC) / (237.7 + tempC));
  return tempC + 0.33 * vaporPressure - 0.7 * kmhToMs(windKmh) - 4;
};

const sanitizeFeelsLikeValue = (value: number, tempC: number) =>
  clampNumber(value, tempC - 18, tempC + 18);

const resolveCertifiedFeelsLike = ({
  tempC,
  providerFeelsLikeC,
  relativeHumidity,
  windKmh,
}: {
  tempC: number | null;
  providerFeelsLikeC?: number | null;
  relativeHumidity?: number | null;
  windKmh: number;
}): number | null => {
  if (!isFiniteNumber(tempC)) {
    return isFiniteNumber(providerFeelsLikeC) ? providerFeelsLikeC : null;
  }

  const humidity = normalizeRelativeHumidity(relativeHumidity);
  const heatIndex = calculateHeatIndexC(tempC, humidity);
  const windChill = calculateWindChillC(tempC, windKmh);
  const apparent = calculateApparentTemperatureC(tempC, humidity, windKmh);
  const provider = isFiniteNumber(providerFeelsLikeC) ? providerFeelsLikeC : null;

  const hotWeather = isFiniteNumber(heatIndex);
  const coldWeather = isFiniteNumber(windChill);
  const preferredComputed = hotWeather
    ? heatIndex
    : coldWeather
      ? windChill
      : apparent;

  if (isFiniteNumber(provider) && isFiniteNumber(preferredComputed)) {
    if (Math.abs(provider - preferredComputed) <= 2.5) {
      return sanitizeFeelsLikeValue((provider + preferredComputed) / 2, tempC);
    }
    if (hotWeather || coldWeather) {
      return sanitizeFeelsLikeValue(preferredComputed, tempC);
    }
    return sanitizeFeelsLikeValue(provider, tempC);
  }

  if (isFiniteNumber(preferredComputed)) {
    return sanitizeFeelsLikeValue(preferredComputed, tempC);
  }

  if (isFiniteNumber(provider)) {
    return sanitizeFeelsLikeValue(provider, tempC);
  }

  return tempC;
};

const buildImmediateCurrentSignal = ({
  localeTag,
  currentCode,
  currentPrecipitation,
  currentRain,
  currentShowers,
  currentSnowfall,
}: {
  localeTag: string;
  currentCode: number;
  currentPrecipitation: number;
  currentRain: number;
  currentShowers: number;
  currentSnowfall: number;
}): WeatherIntelligenceSignal | null => {
  const localeKey = localeTag.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const t = i18n.getFixedT(localeKey);
  const activeLiquid = Math.max(currentPrecipitation, currentRain, currentShowers);

  if (isStormWmoCode(currentCode)) {
    return {
      kind: currentCode >= 96 ? 'hail' : 'thunder',
      icon: 'weather-lightning-rainy',
      label: t(currentCode >= 96 ? 'weather_signal_hail' : 'weather_signal_thunder'),
      confidence: 0.97,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isHailWmoCode(currentCode) || activeLiquid >= 0.8 && currentCode >= 95) {
    return {
      kind: 'hail',
      icon: 'weather-hail',
      label: t('weather_signal_hail'),
      confidence: 0.95,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isSnowWmoCode(currentCode) || currentSnowfall >= 0.1) {
    return {
      kind: 'snow',
      icon: currentSnowfall >= 0.6 ? 'weather-snowy-heavy' : 'weather-snowy',
      label: t('weather_signal_snow'),
      confidence: 0.94,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isRainWmoCode(currentCode) || activeLiquid >= 0.1) {
    return {
      kind: 'rain',
      icon: activeLiquid >= 1.2 ? 'weather-pouring' : 'weather-rainy',
      label: t('weather_signal_rain'),
      confidence: activeLiquid >= 0.4 ? 0.92 : 0.84,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  return null;
};

const buildWeatherIntelligenceSignal = ({
  localeTag,
  currentCode,
  hourlyTimes,
  hourlyCodes,
  hourlyRainProbabilities,
  hourlyPrecipitations,
  hourlySnowfalls,
  hourlyRains,
  hourlyShowers,
}: {
  localeTag: string;
  currentCode: number;
  hourlyTimes: string[];
  hourlyCodes: Array<number | null>;
  hourlyRainProbabilities: Array<number | null>;
  hourlyPrecipitations: Array<number | null>;
  hourlySnowfalls: Array<number | null>;
  hourlyRains: Array<number | null>;
  hourlyShowers: Array<number | null>;
}): WeatherIntelligenceSignal | null => {
  const localeKey = localeTag.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const t = i18n.getFixedT(localeKey);

  if (isStormWmoCode(currentCode)) {
    return {
      kind: currentCode >= 96 ? 'hail' : 'thunder',
      icon: 'weather-lightning-rainy',
      label: t(currentCode >= 96 ? 'weather_signal_hail' : 'weather_signal_thunder'),
      confidence: 0.95,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isHailWmoCode(currentCode)) {
    return {
      kind: 'hail',
      icon: 'weather-hail',
      label: t('weather_signal_hail'),
      confidence: 0.94,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isSnowWmoCode(currentCode)) {
    return {
      kind: 'snow',
      icon: currentCode >= 75 ? 'weather-snowy-heavy' : 'weather-snowy',
      label: t('weather_signal_snow'),
      confidence: 0.92,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  if (isRainWmoCode(currentCode)) {
    return {
      kind: 'rain',
      icon: currentCode >= 65 ? 'weather-pouring' : 'weather-rainy',
      label: t('weather_signal_rain'),
      confidence: 0.9,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  const now = Date.now();
  let bestSignal: WeatherIntelligenceSignal | null = null;

  hourlyTimes.slice(0, 6).forEach((timeValue, index) => {
    const atMs = new Date(timeValue).getTime();
    if (!Number.isFinite(atMs)) return;
    const startsInMinutes = Math.max(0, Math.round((atMs - now) / 60000));
    if (startsInMinutes > 180) return;

    const code = Number(hourlyCodes[index] || 0);
    const rainProbability = Number(hourlyRainProbabilities[index] || 0);
    const precipitation = Number(hourlyPrecipitations[index] || 0);
    const snowfall = Number(hourlySnowfalls[index] || 0);
    const rain = Number(hourlyRains[index] || 0);
    const showers = Number(hourlyShowers[index] || 0);
    const liquidPrecipitation = Math.max(precipitation, rain, showers);

    let candidate: WeatherIntelligenceSignal | null = null;

    if (isStormWmoCode(code)) {
      candidate = {
        kind: code >= 96 ? 'hail' : 'lightning',
        icon: 'weather-lightning-rainy',
        label: t(code >= 96 ? 'weather_signal_hail' : 'weather_signal_lightning'),
        confidence: Math.min(0.96, 0.58 + rainProbability / 100 * 0.38),
        startsInMinutes,
        source: 'forecast',
      };
    } else if (isHailWmoCode(code)) {
      candidate = {
        kind: 'hail',
        icon: 'weather-hail',
        label: t('weather_signal_hail'),
        confidence: Math.min(0.94, 0.54 + rainProbability / 100 * 0.36),
        startsInMinutes,
        source: 'forecast',
      };
    } else if (isSnowWmoCode(code) || snowfall >= 0.15) {
      candidate = {
        kind: 'snow',
        icon: 'weather-snowy',
        label: t('weather_signal_snow'),
        confidence: Math.min(0.9, 0.48 + rainProbability / 100 * 0.3),
        startsInMinutes,
        source: 'forecast',
      };
    } else if (
      isRainWmoCode(code) ||
      liquidPrecipitation >= 0.1 ||
      (startsInMinutes <= 90 && rainProbability >= 58) ||
      (startsInMinutes <= 45 && rainProbability >= 46)
    ) {
      candidate = {
        kind: 'rain',
        icon: liquidPrecipitation >= 2 ? 'weather-pouring' : 'weather-rainy',
        label: t('weather_signal_rain'),
        confidence: Math.min(0.92, 0.45 + rainProbability / 100 * 0.42),
        startsInMinutes,
        source: 'forecast',
      };
    }

    if (!candidate) return;
    if (!bestSignal) {
      bestSignal = candidate;
      return;
    }

    const severityRank =
      candidate.kind === 'lightning' || candidate.kind === 'thunder'
        ? 4
        : candidate.kind === 'hail'
          ? 3
          : candidate.kind === 'snow'
            ? 2
            : 1;
    const bestSeverityRank =
      bestSignal.kind === 'lightning' || bestSignal.kind === 'thunder'
        ? 4
        : bestSignal.kind === 'hail'
          ? 3
          : bestSignal.kind === 'snow'
            ? 2
            : 1;
    if (severityRank > bestSeverityRank) {
      bestSignal = candidate;
      return;
    }
    if (severityRank === bestSeverityRank && candidate.startsInMinutes < bestSignal.startsInMinutes) {
      bestSignal = candidate;
    }
  });

  return bestSignal;
};

export const mapWmoToIcon = (code: number, isDay: boolean) => {
  const langTag = getLocales()?.[0]?.languageTag || 'pt-BR';
  const isPt = langTag.toLowerCase().startsWith('pt');
  const labels = isPt
    ? {
        clearDay: 'Céu limpo',
        clearNight: 'Noite limpa',
        partlyDay: 'Parcialmente nublado',
        partlyNight: 'Noite parcialmente nublada',
        overcastDay: 'Nublado',
        overcastNight: 'Noite nublada',
        fog: 'Neblina',
        drizzle: 'Garoa',
        rain: 'Chuva',
        freezingRain: 'Chuva congelante',
        showers: 'Pancadas de chuva',
        snow: 'Neve',
        snowShowers: 'Pancadas de neve',
        hail: 'Granizo',
        thunder: 'Tempestade com raios',
        thunderHail: 'Tempestade com raios e granizo',
      }
    : {
        clearDay: 'Clear sky',
        clearNight: 'Clear night',
        partlyDay: 'Partly cloudy',
        partlyNight: 'Partly cloudy night',
        overcastDay: 'Overcast',
        overcastNight: 'Overcast night',
        fog: 'Fog',
        drizzle: 'Drizzle',
        rain: 'Rain',
        freezingRain: 'Freezing rain',
        showers: 'Rain showers',
        snow: 'Snow',
        snowShowers: 'Snow showers',
        hail: 'Hail',
        thunder: 'Thunderstorm',
        thunderHail: 'Thunderstorm with hail',
      };

  if (code === 0) {
    return {
      icon: isDay ? 'weather-sunny' : 'weather-night',
      label: isDay ? labels.clearDay : labels.clearNight,
    };
  }
  if (code === 1 || code === 2) {
    return {
      icon: isDay ? 'weather-partly-cloudy' : 'weather-night-partly-cloudy',
      label: isDay ? labels.partlyDay : labels.partlyNight,
    };
  }
  if (code === 3) {
    return {
      icon: 'weather-cloudy',
      label: isDay ? labels.overcastDay : labels.overcastNight,
    };
  }
  if (code >= 45 && code <= 48) {
    return { icon: 'weather-fog', label: labels.fog };
  }
  if (code >= 51 && code <= 57) {
    return { icon: 'weather-rainy', label: code >= 56 ? labels.freezingRain : labels.drizzle };
  }
  if (code >= 61 && code <= 67) {
    return {
      icon: code >= 65 ? 'weather-pouring' : 'weather-rainy',
      label: code >= 66 ? labels.freezingRain : labels.rain,
    };
  }
  if (code >= 71 && code <= 77) {
    return { icon: 'weather-snowy', label: labels.snow };
  }
  if (code === 79) {
    return { icon: 'weather-hail', label: labels.hail };
  }
  if (code >= 80 && code <= 82) {
    return { icon: 'weather-rainy', label: labels.showers };
  }
  if (code >= 85 && code <= 86) {
    return { icon: 'weather-snowy-heavy', label: labels.snowShowers };
  }
  if (code === 95) {
    return { icon: 'weather-lightning-rainy', label: labels.thunder };
  }
  if (code >= 96 && code <= 99) {
    return { icon: 'weather-lightning-rainy', label: labels.thunderHail };
  }
  return { icon: 'weather-cloudy', label: isDay ? labels.overcastDay : labels.overcastNight };
};

const shouldPreAlert = (
  items: AlertNotification[],
  riskScore?: number,
) => {
  if (items.length === 0) return false;
  if (typeof riskScore === 'number' && riskScore >= 0.46) return true;
  return items.some(item => {
    const severity = (item as any).severity || '';
    return ['Severe', 'Extreme', 'Major'].includes(severity);
  });
};

export const WeatherService = {
  async getCachedWeather(): Promise<WeatherResult | null> {
    await clearLegacyWeatherCachesIfNeeded();
    const cachedRaw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
    if (!cachedRaw) return null;
    try {
      const cached = JSON.parse(cachedRaw) as WeatherCache;
      const sanitized = cached?.data ? sanitizeWeatherPayload(cached.data) : null;
      if (!sanitized || hasCorruptedWeatherPayload(sanitized)) {
        await AsyncStorage.removeItem(WEATHER_CACHE_KEY);
        return null;
      }
      return sanitized;
    } catch {
      return null;
    }
  },

  async getCurrentWeather(
    lat: number,
    lon: number,
    options?: { force?: boolean },
  ): Promise<WeatherResult> {
    await clearLegacyWeatherCachesIfNeeded();
    const locale = getLocales()?.[0];
    const languageTag = locale?.languageTag || 'pt-BR';
    const language = locale?.languageCode || 'pt';
    const countryCode = locale?.countryCode || 'XX';
    const isPt = languageTag.toLowerCase().startsWith('pt');

    const entitlements = await EntitlementService.getEntitlements().catch(() => null);
    const tier = entitlements?.isPremium ? 'premium' : 'free';
    const recordWeatherCost = async (cacheHit: boolean) => {
      await CostGuard.record({
        feature: 'weather.current',
        provider: 'open-meteo',
        tier,
        region: countryCode,
        costUsd: cacheHit ? 0 : CostPolicy.estimateCost('weather.current'),
        ts: Date.now(),
        cacheHit,
      });
    };

    const budget = await CostGuard.evaluate({
      feature: 'weather.current',
      provider: 'open-meteo',
      tier,
      region: countryCode,
    });

    const cacheTtlMs = WEATHER_CACHE_TTL * budget.cacheTtlMultiplier;

    const cachedRaw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
    let cachedFallback: WeatherResult | null = null;
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as WeatherCache;
        const cachedData = cached?.data ? sanitizeWeatherPayload(cached.data) : null;
        if (!cachedData || hasCorruptedWeatherPayload(cachedData)) {
          await AsyncStorage.removeItem(WEATHER_CACHE_KEY);
          cachedFallback = null;
        } else {
          cachedFallback = cachedData;
          if (
            !options?.force &&
            Date.now() - cached.ts < cacheTtlMs &&
            isWithinKm({ lat: cached.lat, lon: cached.lon }, { lat, lon })
          ) {
            await recordWeatherCost(true);
            return cachedData;
          }
        }
      } catch {
        // ignore cache parse errors
      }
    }

    if (!budget.allow) {
      if (cachedFallback) {
        await recordWeatherCost(true);
        return cachedFallback;
      }
      return sanitizeWeatherPayload({
        city: '...',
        temp: '--',
        wind: 0,
        icon: 'weather-cloudy',
        label: i18n.t('weather_unknown') || '...',
        isDay: true,
        timestamp: new Date().toISOString(),
      });
    }

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,precipitation,rain,showers,snowfall&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation_probability,precipitation,rain,showers,snowfall&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&forecast_days=4&timezone=auto`;
    const legacyWeatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation_probability,precipitation,rain,showers,snowfall&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&forecast_days=4&timezone=auto`;
    const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}&addressdetails=1`;
    const reverseMeteoUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${language}&count=1`;

    let city = '...';
    let temp = '--';
    let wind = 0;
    let icon = 'weather-cloudy';
    let label = '...';
    let isDay = true;
    let minTemp: string | undefined;
    let maxTemp: string | undefined;
    let feelsLike: string | undefined;
    let forecastLabel: string | undefined;
    let forecastDays: WeatherResult['forecastDays'];
    let intelligenceSignal: WeatherIntelligenceSignal | null = null;
    let sunrise: string | undefined;
    let sunset: string | undefined;
    let timeZone: string | undefined;
    let hourlyTimes: string[] = [];
    let hourlyTemps: Array<number | null> = [];
    let hourlyFeels: Array<number | null> = [];
    let hourlyHumidities: Array<number | null> = [];
    let hourlyCodes: Array<number | null> = [];
    let hourlyRainProbabilities: Array<number | null> = [];
    let hourlyPrecipitations: Array<number | null> = [];
    let hourlyRains: Array<number | null> = [];
    let hourlyShowers: Array<number | null> = [];
    let hourlySnowfalls: Array<number | null> = [];
    let closestHourlyIdx: number | null = null;
    let currentCode = 0;
    let currentHumidity: number | null = null;
    let currentPrecipitation = 0;
    let currentRain = 0;
    let currentShowers = 0;
    let currentSnowfall = 0;

    try {
      const weatherPromise = withTimeout(fetch(weatherUrl), WEATHER_TIMEOUT_MS);
      const geoPromise = withTimeout(
        fetch(geoUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': languageTag },
        }),
        GEO_TIMEOUT_MS,
      );

      const [weatherRes, geoRes] = await Promise.all([weatherPromise, geoPromise]);

      if (geoRes && (geoRes as Response).ok) {
        const geoData = await (geoRes as Response).json();
        city = resolveCityFromNominatim(geoData) || city;
      }

      let weatherData: any | null = null;
      if (weatherRes && (weatherRes as Response).ok) {
        try {
          weatherData = await (weatherRes as Response).json();
        } catch {
          weatherData = null;
        }
      }

      if (!weatherData) {
        const legacyRes = await withTimeout(fetch(legacyWeatherUrl), WEATHER_TIMEOUT_MS);
        if (legacyRes && (legacyRes as Response).ok) {
          try {
            weatherData = await (legacyRes as Response).json();
          } catch {
            weatherData = null;
          }
        }
      }

      if (weatherData) {
        if (typeof weatherData.timezone === 'string' && weatherData.timezone.trim()) {
          timeZone = weatherData.timezone.trim();
        }
        const current = weatherData.current || weatherData.current_weather;
        if (current) {
          const code = current?.weather_code ?? current?.weathercode ?? 0;
          currentCode = Number(code) || 0;
          const tempValue =
            typeof current?.temperature_2m === 'number'
              ? current.temperature_2m
              : typeof current?.temperature === 'number'
                ? current.temperature
                : null;
          const windValue =
            typeof current?.wind_speed_10m === 'number'
              ? current.wind_speed_10m
              : typeof current?.windspeed === 'number'
                ? current.windspeed
                : 0;
          isDay = current?.is_day === 1 || current?.is_day === true;
          wind = Number(windValue || 0);
          currentHumidity =
            typeof current?.relative_humidity_2m === 'number'
              ? Number(current.relative_humidity_2m)
              : null;
          currentPrecipitation =
            typeof current?.precipitation === 'number' ? Number(current.precipitation) : 0;
          currentRain = typeof current?.rain === 'number' ? Number(current.rain) : 0;
          currentShowers = typeof current?.showers === 'number' ? Number(current.showers) : 0;
          currentSnowfall =
            typeof current?.snowfall === 'number' ? Number(current.snowfall) : 0;
          const mapped = mapWmoToIcon(currentCode, isDay);
          icon = mapped.icon;
          label = mapped.label;
          if (typeof tempValue === 'number') {
            temp = formatRoundedTemperature(Number(tempValue)) || '--';
          }
          const providerFeelsLike =
            typeof current?.apparent_temperature_2m === 'number'
              ? Number(current.apparent_temperature_2m)
              : typeof current?.apparent_temperature === 'number'
                ? Number(current.apparent_temperature)
                : null;
          feelsLike = formatRoundedTemperature(
            resolveCertifiedFeelsLike({
              tempC: isFiniteNumber(tempValue) ? Number(tempValue) : null,
              providerFeelsLikeC: providerFeelsLike,
              relativeHumidity: currentHumidity,
              windKmh: wind,
            }),
          );
        }

        const hourly = weatherData.hourly;
        hourlyTimes = Array.isArray(hourly?.time) ? hourly.time : [];
        hourlyTemps = Array.isArray(hourly?.temperature_2m)
          ? hourly.temperature_2m
          : Array.isArray(hourly?.temperature)
            ? hourly.temperature
            : [];
        hourlyFeels = Array.isArray(hourly?.apparent_temperature)
          ? hourly.apparent_temperature
          : Array.isArray(hourly?.apparent_temperature_2m)
            ? hourly.apparent_temperature_2m
            : [];
        hourlyHumidities = Array.isArray(hourly?.relative_humidity_2m)
          ? hourly.relative_humidity_2m
          : [];
        hourlyCodes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
        hourlyRainProbabilities = Array.isArray(hourly?.precipitation_probability)
          ? hourly.precipitation_probability
          : [];
        hourlyPrecipitations = Array.isArray(hourly?.precipitation)
          ? hourly.precipitation
          : [];
        hourlyRains = Array.isArray(hourly?.rain) ? hourly.rain : [];
        hourlyShowers = Array.isArray(hourly?.showers) ? hourly.showers : [];
        hourlySnowfalls = Array.isArray(hourly?.snowfall) ? hourly.snowfall : [];
        if (hourlyTimes.length > 0 && (hourlyTemps.length > 0 || hourlyFeels.length > 0)) {
          const now = Date.now();
          let closestIdx = 0;
          let closestDelta = Number.POSITIVE_INFINITY;
          hourlyTimes.forEach((ts, idx) => {
            const timeValue = new Date(ts).getTime();
            if (Number.isNaN(timeValue)) return;
            const delta = Math.abs(timeValue - now);
            if (delta < closestDelta) {
              closestDelta = delta;
              closestIdx = idx;
            }
          });
          closestHourlyIdx = closestIdx;
          const hourlyTemp = hourlyTemps[closestIdx];
          if (typeof hourlyTemp === 'number') {
            temp = formatRoundedTemperature(Number(hourlyTemp)) || '--';
          }
          const providerFeelsLike =
            typeof hourlyFeels[closestIdx] === 'number'
              ? Number(hourlyFeels[closestIdx])
              : null;
          feelsLike = formatRoundedTemperature(
            resolveCertifiedFeelsLike({
              tempC: typeof hourlyTemp === 'number' ? Number(hourlyTemp) : null,
              providerFeelsLikeC: providerFeelsLike,
              relativeHumidity:
                typeof hourlyHumidities[closestIdx] === 'number'
                  ? Number(hourlyHumidities[closestIdx])
                  : currentHumidity,
              windKmh: wind,
            }),
          );
        }

        const hourlyWindowStart = typeof closestHourlyIdx === 'number' ? closestHourlyIdx : 0;
        intelligenceSignal =
          buildImmediateCurrentSignal({
            localeTag: languageTag,
            currentCode,
            currentPrecipitation,
            currentRain,
            currentShowers,
            currentSnowfall,
          }) ||
          buildWeatherIntelligenceSignal({
            localeTag: languageTag,
            currentCode,
            hourlyTimes: hourlyTimes.slice(hourlyWindowStart),
            hourlyCodes: hourlyCodes.slice(hourlyWindowStart),
            hourlyRainProbabilities: hourlyRainProbabilities.slice(hourlyWindowStart),
            hourlyPrecipitations: hourlyPrecipitations.slice(hourlyWindowStart),
            hourlySnowfalls: hourlySnowfalls.slice(hourlyWindowStart),
            hourlyRains: hourlyRains.slice(hourlyWindowStart),
            hourlyShowers: hourlyShowers.slice(hourlyWindowStart),
          });

        const daily = weatherData.daily;
        const dailyTimes: string[] = Array.isArray(daily?.time) ? daily.time : [];
        const dailyMaxArr: Array<number | null> = Array.isArray(daily?.temperature_2m_max)
          ? daily.temperature_2m_max
          : [];
        const dailyMinArr: Array<number | null> = Array.isArray(daily?.temperature_2m_min)
          ? daily.temperature_2m_min
          : [];
        const dailyCodeArr: Array<number | null> = Array.isArray(daily?.weather_code)
          ? daily.weather_code
          : [];
        const dailyRainArr: Array<number | null> = Array.isArray(daily?.precipitation_probability_max)
          ? daily.precipitation_probability_max
          : [];
        const dailySunriseArr: Array<string | null> = Array.isArray(daily?.sunrise) ? daily.sunrise : [];
        const dailySunsetArr: Array<string | null> = Array.isArray(daily?.sunset) ? daily.sunset : [];

        sunrise = typeof dailySunriseArr[0] === 'string' ? dailySunriseArr[0] : undefined;
        sunset = typeof dailySunsetArr[0] === 'string' ? dailySunsetArr[0] : undefined;

        const dailyMax = typeof dailyMaxArr[0] === 'number' ? dailyMaxArr[0] : undefined;
        const dailyMin = typeof dailyMinArr[0] === 'number' ? dailyMinArr[0] : undefined;
        if (typeof dailyMax === 'number') maxTemp = formatRoundedTemperature(dailyMax);
        if (typeof dailyMin === 'number') minTemp = formatRoundedTemperature(dailyMin);
        if ((!maxTemp || !minTemp) && hourlyTemps.length > 0) {
          const startIdx = typeof closestHourlyIdx === 'number' ? closestHourlyIdx : 0;
          const endIdx = Math.min(hourlyTemps.length, startIdx + 24);
          const windowTemps = hourlyTemps
            .slice(startIdx, endIdx)
            .filter(value => typeof value === 'number') as number[];
          if (windowTemps.length > 0) {
            const maxVal = Math.max(...windowTemps);
            const minVal = Math.min(...windowTemps);
            if (!maxTemp) maxTemp = formatRoundedTemperature(maxVal);
            if (!minTemp) minTemp = formatRoundedTemperature(minVal);
          }
        }

        if (maxTemp || minTemp) {
          forecastLabel =
            maxTemp && minTemp ? `${maxTemp}/${minTemp}` : maxTemp || minTemp || '';
        }

        const forecastStart = 1;
        forecastDays = dailyTimes.slice(forecastStart, forecastStart + 3).map((dateStr, index) => {
          const dataIndex = index + forecastStart;
          const date = new Date(dateStr);
          const fallbackWeekdays: Record<string, string[]> = {
            pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
            en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
          };

          const langKey = (language || languageTag || 'en').toLowerCase();
          const langGroup = langKey.startsWith('pt')
            ? 'pt'
            : langKey.startsWith('es')
              ? 'es'
              : 'en';

          const weekdayIndex = date.getDay();
          const localeWeekdayRaw = date.toLocaleDateString(languageTag, { weekday: 'short' });
          let dayLabel = String(localeWeekdayRaw || '')
            .replace('.', '')
            .trim();

          // Some Android JSC builds ignore `weekday` options and return a numeric date.
          // When that happens, fall back to a deterministic abbreviation.
          if (!dayLabel || /\d/.test(dayLabel)) {
            dayLabel = (fallbackWeekdays[langGroup] || fallbackWeekdays.en)[weekdayIndex] || '';
          }
          if (dayLabel) {
            dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
          }
          const dayCode =
            typeof dailyCodeArr[dataIndex] === 'number' ? Number(dailyCodeArr[dataIndex]) : currentCode;
          const mappedDay = mapWmoToIcon(dayCode, true);
          const maxValue =
            typeof dailyMaxArr[dataIndex] === 'number' ? dailyMaxArr[dataIndex] : null;
          const minValue =
            typeof dailyMinArr[dataIndex] === 'number' ? dailyMinArr[dataIndex] : null;
          const rainValue =
            typeof dailyRainArr[dataIndex] === 'number' ? dailyRainArr[dataIndex] : null;
          return {
            dayLabel,
            icon: mappedDay.icon,
            maxTemp: formatRoundedTemperature(maxValue) || '--',
            minTemp: formatRoundedTemperature(minValue) || '--',
            rainChance: typeof rainValue === 'number' ? Math.round(rainValue) : null,
          };
        });
      } else if (cachedFallback) {
        await recordWeatherCost(true);
        let fallbackCity = cachedFallback.city;
        if (!fallbackCity || fallbackCity === '...') {
          try {
            const reverseRes = await withTimeout(fetch(reverseMeteoUrl), REVERSE_TIMEOUT_MS);
            if (reverseRes && (reverseRes as Response).ok) {
              const reverseData = await (reverseRes as Response).json();
              const resolved = resolveCityFromMeteo(reverseData);
              if (resolved) {
                fallbackCity = resolved;
              }
            }
          } catch {
            // ignore reverse lookup errors
          }
        }
        if (fallbackCity && fallbackCity !== cachedFallback.city) {
          return { ...cachedFallback, city: fallbackCity, timestamp: new Date().toISOString() };
        }
        return cachedFallback;
      }
    } catch {
      // ignore here; try fallback below
    }

    if (
      (label === '...' || temp === '--') &&
      cachedFallback
    ) {
      await recordWeatherCost(true);
      return cachedFallback;
    }

    if (!city || city === '...') {
      try {
        const reverseRes = await withTimeout(fetch(reverseMeteoUrl), REVERSE_TIMEOUT_MS);
        if (reverseRes && (reverseRes as Response).ok) {
          const reverseData = await (reverseRes as Response).json();
          city = resolveCityFromMeteo(reverseData) || city;
        }
      } catch {
        // ignore fallback errors
      }
    }

    const data = sanitizeWeatherPayload({
      city,
      temp,
      wind,
      icon,
      label,
      feelsLike,
      minTemp,
      maxTemp,
      forecastLabel,
      forecastDays,
      isDay,
      sunrise,
      sunset,
      timeZone,
      intelligenceSignal,
      timestamp: new Date().toISOString(),
    });

    if (hasCorruptedWeatherPayload(data)) {
      await AsyncStorage.removeItem(WEATHER_CACHE_KEY);
      return data;
    }

    const cache: WeatherCache = { lat, lon, ts: Date.now(), data };
    await AsyncStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
    await recordWeatherCost(false);

    return data;
  },

  async getAlerts(
    lat: number,
    lon: number,
    riskScore?: number,
    options?: { force?: boolean },
  ): Promise<AlertNotification[]> {
    const cachedRaw = await AsyncStorage.getItem(ALERTS_CACHE_KEY);
    if (!options?.force && cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as AlertsCache;
        if (
          Date.now() - cached.ts < ALERTS_CACHE_TTL &&
          isWithinKm({ lat: cached.lat, lon: cached.lon }, { lat, lon })
        ) {
          return cached.data;
        }
      } catch {
        // ignore cache parse errors
      }
    }

    const noaaUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
    const usgsUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=200&orderby=time`;
    const gdacsUrl = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/';

    const results = await Promise.allSettled([
      fetch(noaaUrl, { headers: { 'User-Agent': USER_AGENT } }),
      fetch(usgsUrl),
      fetch(gdacsUrl),
    ]);

    const alerts: AlertNotification[] = [];

    if (results[0].status === 'fulfilled' && results[0].value.ok) {
      try {
        const data = await results[0].value.json();
        const features = data?.features || [];
        features.forEach((f: any, idx: number) => {
          const props = f?.properties || {};
          alerts.push({
            id: f?.id || `noaa-${idx}`,
            type: 'hazard',
            title: props.event || 'Alerta meteorológico',
            summary: props.headline || props.description || 'Alerta ativo',
            timestamp: props.sent || new Date().toISOString(),
            sourceName: 'NOAA',
            sourceUrl: props.uri || props.web,
          });
          (alerts[alerts.length - 1] as any).severity = props.severity;
        });
      } catch {
        // ignore
      }
    }

    if (results[1].status === 'fulfilled' && results[1].value.ok) {
      try {
        const data = await results[1].value.json();
        const features = data?.features || [];
        features.forEach((f: any, idx: number) => {
          const props = f?.properties || {};
          const mag = Number(props.mag || 0);
          const severity = mag >= 7 ? 'Extreme' : mag >= 5 ? 'Severe' : mag >= 4 ? 'Moderate' : 'Minor';
          alerts.push({
            id: f?.id || `usgs-${idx}`,
            type: 'hazard',
            title: `Terremoto M${mag.toFixed(1)} - ${props.place || 'RegiÃ£o'}`,
            summary: props.title || 'Atividade sÃ­smica detectada',
            timestamp: props.time ? new Date(props.time).toISOString() : new Date().toISOString(),
            sourceName: 'USGS',
            sourceUrl: props.url,
          });
          (alerts[alerts.length - 1] as any).severity = severity;
        });
      } catch {
        // ignore
      }
    }

    if (results[2].status === 'fulfilled' && results[2].value.ok) {
      try {
        const data = await results[2].value.json();
        const items = data?.features || data?.result || data?.events || [];
        items.forEach((item: any, idx: number) => {
          const props = item?.properties || item;
          const coords = item?.geometry?.coordinates;
          const eventLat = props?.lat || (coords ? coords[1] : undefined);
          const eventLon = props?.lon || (coords ? coords[0] : undefined);
          if (eventLat && eventLon) {
            const distance = getDistanceKm(
              { lat, lon },
              { lat: Number(eventLat), lon: Number(eventLon) },
            );
            if (distance > MAX_RADIUS_KM) return;
          }
          alerts.push({
            id: props?.eventid || `gdacs-${idx}`,
            type: 'hazard',
            title: props?.eventname || 'Alerta global',
            summary: props?.alertlevel || props?.description || 'Alerta internacional',
            timestamp: normalizeToIsoDateTime(props?.eventdate) || new Date().toISOString(),
            sourceName: 'GDACS',
            sourceUrl: props?.url || 'https://www.gdacs.org',
          });
        });
      } catch {
        // ignore
      }
    }

    const cache: AlertsCache = { lat, lon, ts: Date.now(), data: alerts };
    await AsyncStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(cache));

    if (shouldPreAlert(alerts, riskScore)) {
      const lastRaw = await AsyncStorage.getItem(PREALERT_KEY);
      const lastTs = lastRaw ? Number(lastRaw) : 0;
      if (!lastTs || Date.now() - lastTs > ALERTS_CACHE_TTL) {
        await NotificationService.add({
          id: `prealert-${Date.now()}`,
          type: 'system',
          title: 'Pre-alerta',
          summary: 'Atividade de risco detectada na sua região.',
          timestamp: new Date().toISOString(),
          sourceName: 'Alert',
        });
        await AsyncStorage.setItem(PREALERT_KEY, String(Date.now()));
      }
    }

    return alerts;
  },

  hasNearbySos(alerts: AlertNotification[]): boolean {
    return alerts.some(item =>
      item.type === 'sos' ||
      (item.title || '').toLowerCase().includes('sos'),
    );
  },
};

