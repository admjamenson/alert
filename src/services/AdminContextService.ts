import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';
import { GeocodingService } from './maps/GeocodingService';
import { ReverseGeocodeService } from './ReverseGeocodeService';
import { UserAdminContext } from '../types/officialSources';

const ADMIN_CONTEXT_STORAGE_KEY = '@Alert:UserAdminContext:v1';
const ADMIN_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;

type AdminContextCachePayload = {
  savedAtMs: number;
  data: UserAdminContext;
};

const normalizeCode = (value: string | null | undefined) => {
  const safe = String(value || '').trim();
  return safe ? safe.toUpperCase() : null;
};

const normalizeName = (value: string | null | undefined) => {
  const safe = String(value || '').trim();
  return safe || null;
};

const normalizeLocale = () => getLocales()?.[0]?.languageTag || 'en-US';

const parseCachePayload = (raw: string | null): AdminContextCachePayload | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminContextCachePayload;
    if (!parsed || typeof parsed.savedAtMs !== 'number' || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
};

const buildContext = (params: {
  countryCode?: string | null;
  countryName?: string | null;
  admin1Code?: string | null;
  admin1Name?: string | null;
  admin2Name?: string | null;
  admin3Name?: string | null;
  providerUsed?: UserAdminContext['providerUsed'];
  locale?: string;
}): UserAdminContext => ({
  countryCode: normalizeCode(params.countryCode),
  countryNameLocalized: normalizeName(params.countryName),
  admin1Code: normalizeCode(params.admin1Code),
  admin1NameLocalized: normalizeName(params.admin1Name),
  admin2NameLocalized: normalizeName(params.admin2Name),
  admin3NameLocalized: normalizeName(params.admin3Name),
  resolvedAt: new Date().toISOString(),
  providerUsed: params.providerUsed || 'unknown',
  locale: params.locale || normalizeLocale(),
});

const resolveWithReverseGeocode = async (
  lat: number,
  lon: number,
  locale: string,
): Promise<UserAdminContext | null> => {
  const geo = await ReverseGeocodeService.reverse(lat, lon);
  if (!geo) return null;
  return buildContext({
    countryCode: geo.countryCode,
    countryName: geo.countryName,
    admin1Code: geo.isoStateCode,
    admin1Name: geo.stateName,
    admin2Name: geo.cityName || geo.countyName,
    admin3Name: geo.countyName,
    providerUsed:
      geo.providerUsed === 'nominatim' || geo.providerUsed === 'open-meteo'
        ? geo.providerUsed
        : 'nominatim',
    locale,
  });
};

const resolveWithFallbackReverse = async (
  lat: number,
  lon: number,
  locale: string,
): Promise<UserAdminContext | null> => {
  const place = await GeocodingService.reverse({
    coordinate: [lon, lat],
    locale,
  });
  if (!place) return null;
  return buildContext({
    countryCode: place.countryCode || null,
    countryName: null,
    admin1Code: null,
    admin1Name: null,
    admin2Name: place.name,
    admin3Name: null,
    providerUsed: 'open-meteo',
    locale,
  });
};

const persistContext = async (context: UserAdminContext): Promise<void> => {
  const payload: AdminContextCachePayload = {
    savedAtMs: Date.now(),
    data: context,
  };
  await AsyncStorage.setItem(ADMIN_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
};

export const AdminContextService = {
  async getCachedContext(): Promise<UserAdminContext | null> {
    const raw = await AsyncStorage.getItem(ADMIN_CONTEXT_STORAGE_KEY);
    const payload = parseCachePayload(raw);
    if (!payload) return null;
    if (Date.now() - payload.savedAtMs > ADMIN_CONTEXT_TTL_MS) return null;
    return payload.data;
  },

  async resolveFromLocation(
    lat: number,
    lon: number,
    options?: { forceRefresh?: boolean; locale?: string },
  ): Promise<UserAdminContext | null> {
    const forceRefresh = Boolean(options?.forceRefresh);
    const locale = options?.locale || normalizeLocale();

    if (!forceRefresh) {
      const cached = await this.getCachedContext();
      if (cached) return cached;
    }

    const primary = await resolveWithReverseGeocode(lat, lon, locale);
    if (primary) {
      await persistContext(primary);
      return primary;
    }

    const fallback = await resolveWithFallbackReverse(lat, lon, locale);
    if (fallback) {
      await persistContext(fallback);
      return fallback;
    }

    return null;
  },
};

export default AdminContextService;
