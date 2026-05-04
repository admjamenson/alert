import AsyncStorage from '@react-native-async-storage/async-storage';

import { GuardianSuggestion, PlaceSuggestion, RouteOption } from './types';

const RECENT_PLACES_KEY = '@Alert:Map:RecentPlaces';
const FAVORITE_PLACES_KEY = '@Alert:Map:FavoritePlaces';
const LAST_VIEWPORT_KEY = '@Alert:Map:Viewport';
const RECENT_ROUTES_PREFIX = '@Alert:Map:RecentRoute:';
const GUARDIANS_KEY = '@guardians_list';

const ROUTE_TTL_MS = 20 * 60 * 1000;
const MAX_RECENT = 15;
const MAX_FAVORITES = 25;

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const normalizeGuardianLocation = (value: any): [number, number] | undefined => {
  if (!value) return undefined;

  const lat = Number(value.latitude ?? value.lat ?? value.location?.latitude ?? value.location?.lat);
  const lon = Number(value.longitude ?? value.lon ?? value.lng ?? value.location?.longitude ?? value.location?.lon ?? value.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return [lon, lat];
};

const routeCacheKey = (from: [number, number], to: [number, number]) => {
  const value = `${from[0].toFixed(4)},${from[1].toFixed(4)}:${to[0].toFixed(4)},${to[1].toFixed(4)}`;
  return `${RECENT_ROUTES_PREFIX}${value}`;
};

const isCacheableRoute = (route: RouteOption | null | undefined): route is RouteOption => {
  if (!route) return false;
  if (route.routeMode !== 'provider') return false;
  if (route.precision !== 'high') return false;
  if (route.degraded) return false;
  if (!route.providerAvailable) return false;
  if (!Array.isArray(route.geometry) || route.geometry.length < 2) return false;
  return true;
};

export const OfflineCacheService = {
  async getRecentPlaces(): Promise<PlaceSuggestion[]> {
    const parsed = safeParse<PlaceSuggestion[]>(await AsyncStorage.getItem(RECENT_PLACES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  },

  async pushRecentPlace(place: PlaceSuggestion): Promise<void> {
    const current = await this.getRecentPlaces();
    const deduped = current.filter(item => item.id !== place.id);
    const next = [place, ...deduped].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
  },

  async getFavoritePlaces(): Promise<PlaceSuggestion[]> {
    const parsed = safeParse<PlaceSuggestion[]>(await AsyncStorage.getItem(FAVORITE_PLACES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  },

  async toggleFavoritePlace(place: PlaceSuggestion): Promise<'added' | 'removed'> {
    const favorites = await this.getFavoritePlaces();
    const exists = favorites.some(item => item.id === place.id);
    if (exists) {
      const next = favorites.filter(item => item.id !== place.id);
      await AsyncStorage.setItem(FAVORITE_PLACES_KEY, JSON.stringify(next));
      return 'removed';
    }

    const next = [place, ...favorites].slice(0, MAX_FAVORITES);
    await AsyncStorage.setItem(FAVORITE_PLACES_KEY, JSON.stringify(next));
    return 'added';
  },

  async setLastViewport(viewport: { center: [number, number]; zoom: number }): Promise<void> {
    await AsyncStorage.setItem(
      LAST_VIEWPORT_KEY,
      JSON.stringify({ ...viewport, ts: Date.now() }),
    );
  },

  async getLastViewport(): Promise<{ center: [number, number]; zoom: number } | null> {
    const parsed = safeParse<{ center: [number, number]; zoom: number }>(
      await AsyncStorage.getItem(LAST_VIEWPORT_KEY),
    );
    if (!parsed || !Array.isArray(parsed.center) || parsed.center.length !== 2) return null;
    if (!Number.isFinite(Number(parsed.zoom))) return null;
    return parsed;
  },

  async saveRoute(from: [number, number], to: [number, number], routes: RouteOption[]): Promise<void> {
    if (!Array.isArray(routes) || routes.length === 0) return;
    if (!routes.every(route => isCacheableRoute(route))) return;
    const key = routeCacheKey(from, to);
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ ts: Date.now(), routes }),
    );
  },

  async getRoute(from: [number, number], to: [number, number]): Promise<RouteOption[] | null> {
    const key = routeCacheKey(from, to);
    const parsed = safeParse<{ ts: number; routes: RouteOption[] }>(await AsyncStorage.getItem(key));
    if (!parsed || !Array.isArray(parsed.routes)) return null;
    if (Date.now() - Number(parsed.ts) > ROUTE_TTL_MS) return null;
    const cacheableRoutes = parsed.routes.filter(route => isCacheableRoute(route));
    return cacheableRoutes.length > 0 ? cacheableRoutes : null;
  },

  async getGuardians(): Promise<GuardianSuggestion[]> {
    const parsed = safeParse<any[]>(await AsyncStorage.getItem(GUARDIANS_KEY));
    if (!Array.isArray(parsed)) return [];

    const mapped: Array<GuardianSuggestion | null> = parsed.map(item => {
        const id = String(item?.id ?? item?.recordID ?? item?.remoteId ?? item?.phone ?? '').trim();
        if (!id) return null;
        const coordinate = normalizeGuardianLocation(item);
        if (!coordinate) return null;

        const name =
          String(item?.name ?? item?.displayName ?? item?.fromName ?? item?.title ?? '').trim() ||
          'Guardian';

        return {
          id,
          name,
          coordinate,
          phone: item?.phone || item?.phoneNumber || undefined,
          avatarUri: item?.avatarUri || undefined,
          lastLocation: coordinate,
          lastUpdatedAt:
            typeof item?.lastUpdatedAt === 'string'
              ? item.lastUpdatedAt
              : typeof item?.updatedAt === 'string'
                ? item.updatedAt
                : undefined,
        };
      });

    return mapped.filter((item): item is GuardianSuggestion => item !== null);
  },
};

export default OfflineCacheService;
