import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';
import { AlertMapsApiAdapter } from '../infrastructure/adapters/AlertMapsApiAdapter';

const CACHE_PREFIX = '@Alert:ReverseGeocode:v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ReverseGeocodeResult = {
  countryCode: string | null;
  countryName: string | null;
  stateName: string | null;
  cityName: string | null;
  countyName: string | null;
  isoStateCode: string | null;
  providerUsed?: 'alert_backend';
};

type CacheEntry = {
  ts: number;
  data: ReverseGeocodeResult;
};

const roundCoord = (value: number, precision = 3) => {
  const p = Math.pow(10, precision);
  return Math.round(value * p) / p;
};

export const ReverseGeocodeService = {
  async reverse(
    lat: number,
    lon: number,
    options?: { force?: boolean },
  ): Promise<ReverseGeocodeResult | null> {
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

    try {
      const locale = getLocales()?.[0];
      const payload = await AlertMapsApiAdapter.reversePlace({
        latitude: lat,
        longitude: lon,
        locale: locale?.languageTag || 'pt-BR',
      });
      const context = payload?.adminContext;
      if (!context) return null;

      const data: ReverseGeocodeResult = {
        countryCode:
          typeof context.countryCode === 'string'
            ? context.countryCode.toLowerCase()
            : null,
        countryName:
          typeof context.countryName === 'string' ? context.countryName : null,
        stateName:
          typeof context.stateName === 'string' ? context.stateName : null,
        cityName: typeof context.cityName === 'string' ? context.cityName : null,
        countyName:
          typeof context.countyName === 'string' ? context.countyName : null,
        isoStateCode:
          typeof context.isoStateCode === 'string'
            ? context.isoStateCode
            : null,
        providerUsed: 'alert_backend',
      };

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
