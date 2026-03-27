import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';

const CACHE_PREFIX = '@Alert:ReverseGeocode:v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const GEO_TIMEOUT_MS = 2200;

// Nominatim usage policy asks for a descriptive UA. WeatherService uses the same pattern.
const USER_AGENT = 'AlertApp/1.0 (contact: support@alertapp.com)';

export type ReverseGeocodeResult = {
  countryCode: string | null; // ISO-2 lowercase (from Nominatim)
  countryName: string | null;
  stateName: string | null;
  cityName: string | null;
  countyName: string | null;
  isoStateCode: string | null; // e.g. "BR-DF" (when present)
  providerUsed?: 'nominatim' | 'open-meteo';
};

type CacheEntry = {
  ts: number;
  data: ReverseGeocodeResult;
};

const roundCoord = (value: number, precision = 3) => {
  const p = Math.pow(10, precision);
  return Math.round(value * p) / p;
};

const pickFirst = (...values: Array<unknown>) =>
  values.find(value => typeof value === 'string' && value.trim().length > 0) as
    | string
    | undefined;

const safeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fetchJsonWithTimeout = async (
  url: string,
  options?: { headers?: Record<string, string> },
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: options?.headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const parseNominatim = (json: any): ReverseGeocodeResult => {
  const address = json?.address || {};

  const city = pickFirst(
    address.city,
    address.town,
    address.village,
    address.hamlet,
    address.municipality,
    address.county,
    address.city_district,
    address.suburb,
    address.neighbourhood,
  );

  const isoStateCandidateKey = Object.keys(address).find(k =>
    String(k).toLowerCase().startsWith('iso3166-2'),
  );

  return {
    countryCode: safeString(address.country_code)?.toLowerCase() ?? null,
    countryName: safeString(address.country),
    stateName: safeString(address.state),
    cityName: safeString(city),
    countyName: safeString(address.county),
    isoStateCode: isoStateCandidateKey ? safeString(address[isoStateCandidateKey]) : null,
    providerUsed: 'nominatim',
  };
};

const parseOpenMeteoReverse = (json: any): ReverseGeocodeResult | null => {
  const result = json?.results?.[0];
  if (!result) return null;

  const city = pickFirst(result.name, result.locality, result.admin2, result.admin1);

  return {
    countryCode: safeString(result.country_code)?.toLowerCase() ?? null,
    countryName: safeString(result.country),
    stateName: safeString(result.admin1),
    cityName: safeString(city),
    countyName: safeString(result.admin2),
    isoStateCode: null,
    providerUsed: 'open-meteo',
  };
};

export const ReverseGeocodeService = {
  async reverse(lat: number, lon: number, options?: { force?: boolean }): Promise<ReverseGeocodeResult | null> {
    const key = `${CACHE_PREFIX}${roundCoord(lat)}:${roundCoord(lon)}`;

    if (!options?.force) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const cached = JSON.parse(raw) as CacheEntry;
          if (cached?.ts && cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
            return cached.data;
          }
        }
      } catch {
        // ignore cache errors
      }
    }

    const locale = getLocales()?.[0];
    const languageTag = locale?.languageTag || 'pt-BR';

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}&addressdetails=1`;
    const meteoUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${locale?.languageCode || 'en'}&count=1`;
    try {
      const [nominatimJson, meteoJson] = await Promise.all([
        fetchJsonWithTimeout(nominatimUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': languageTag },
        }),
        fetchJsonWithTimeout(meteoUrl),
      ]);

      const fromNominatim = nominatimJson ? parseNominatim(nominatimJson) : null;
      const fromMeteo = meteoJson ? parseOpenMeteoReverse(meteoJson) : null;

      const data =
        fromNominatim && (fromNominatim.cityName || fromNominatim.stateName)
          ? fromNominatim
          : fromMeteo || fromNominatim;
      if (!data) return null;

      try {
        const entry: CacheEntry = { ts: Date.now(), data };
        await AsyncStorage.setItem(key, JSON.stringify(entry));
      } catch {
        // ignore cache write errors
      }

      return data;
    } catch {
      return null;
    }
  },
};
