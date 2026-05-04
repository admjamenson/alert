import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNLocalize from 'react-native-localize';

export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type DistanceUnit = 'kilometer' | 'mile';
export type SpeedUnit = 'kmh' | 'mph';

export type RegionalUnits = {
  countryCode: string;
  temperature: TemperatureUnit;
  distance: DistanceUnit;
  speed: SpeedUnit;
};

const FAHRENHEIT_COUNTRIES = new Set(['US', 'LR', 'MM']);
const MILE_DISTANCE_COUNTRIES = new Set(['US', 'GB', 'LR', 'MM']);

const parseCountryCode = (locale?: string | null): string => {
  const normalized = String(locale || '')
    .replace(/_/g, '-')
    .trim();
  const parts = normalized.split('-').filter(Boolean);
  const region = parts.find(
    part => /^[A-Za-z]{2}$/.test(part) && part !== parts[0],
  );
  return String(region || '').toUpperCase();
};

const getDeviceLocaleTag = (): string | null => {
  const locales = RNLocalize.getLocales();
  if (Array.isArray(locales) && locales.length > 0) {
    return locales[0]?.languageTag ?? null;
  }
  return null;
};

export const resolveRegionalUnits = (
  locale?: string | null,
  countryCode?: string | null,
): RegionalUnits => {
  const resolvedCountry = String(
    countryCode ||
      parseCountryCode(locale) ||
      parseCountryCode(getDeviceLocaleTag()),
  )
    .trim()
    .toUpperCase();
  const temperature = FAHRENHEIT_COUNTRIES.has(resolvedCountry)
    ? 'fahrenheit'
    : 'celsius';
  const distance = MILE_DISTANCE_COUNTRIES.has(resolvedCountry)
    ? 'mile'
    : 'kilometer';
  return {
    countryCode: resolvedCountry || 'GLOBAL',
    temperature,
    distance,
    speed: distance === 'mile' ? 'mph' : 'kmh',
  };
};

export const getUserTemperaturePreference =
  async (): Promise<TemperatureUnit | null> => {
    try {
      const stored = await AsyncStorage.getItem('user_temperature_unit');
      if (stored === 'celsius' || stored === 'fahrenheit') {
        return stored;
      }
      return null; // auto
    } catch {
      return null;
    }
  };

export const setUserTemperaturePreference = async (
  unit: TemperatureUnit | 'auto',
): Promise<void> => {
  try {
    if (unit === 'auto') {
      await AsyncStorage.removeItem('user_temperature_unit');
    } else {
      await AsyncStorage.setItem('user_temperature_unit', unit);
    }
  } catch {
    // ignore
  }
};

export const formatTemperatureCelsius = (
  valueC: number | null | undefined,
  locale?: string | null,
  countryCode?: string | null,
  userPreference?: TemperatureUnit | null,
): string => {
  if (typeof valueC !== 'number' || !Number.isFinite(valueC)) return '';
  const units = resolveRegionalUnits(locale, countryCode);
  const effectiveUnit = userPreference || units.temperature;
  if (effectiveUnit === 'fahrenheit') {
    return `${Math.round(celsiusToFahrenheit(valueC))}\u00B0F`;
  }
  return `${Math.round(valueC)}\u00B0C`;
};

export const celsiusToFahrenheit = (valueC: number): number =>
  valueC * (9 / 5) + 32;

export const formatDistanceMeters = (
  meters: number | null | undefined,
  locale?: string | null,
  countryCode?: string | null,
): string => {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return '';
  const units = resolveRegionalUnits(locale, countryCode);
  if (units.distance === 'mile') {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toLocaleString(locale || undefined, {
      maximumFractionDigits: miles >= 10 ? 0 : 1,
    })} mi`;
  }
  const km = meters / 1000;
  if (km < 1) return `${Math.round(meters)} m`;
  return `${km.toLocaleString(locale || undefined, {
    maximumFractionDigits: km >= 10 ? 0 : 1,
  })} km`;
};
