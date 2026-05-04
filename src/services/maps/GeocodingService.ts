import OfflineCacheService from './OfflineCacheService';
import { PlaceSuggestion } from './types';
import { AlertMapsApiAdapter } from '../../infrastructure/adapters/AlertMapsApiAdapter';

type SearchInput = {
  query: string;
  locale: string;
  near?: [number, number];
  countryCode?: string;
  worldview?: string;
};

type ReverseInput = {
  coordinate: [number, number];
  locale: string;
  worldview?: string;
};

const toRad = (value: number) => (value * Math.PI) / 180;

const distanceMeters = (a: [number, number], b: [number, number]) => {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const titleCase = (value: string) =>
  value
    .split(' ')
    .filter(Boolean)
    .map(item => item[0].toUpperCase() + item.slice(1))
    .join(' ');

const normalizeSearchValue = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const hasMunicipalIntent = (value: string) => {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return false;
  return [
    'prefeitura',
    'city hall',
    'municipal',
    'municipio',
    'mairie',
    'ayuntamiento',
    'gemeinde',
    'governo',
  ].some(token => normalized.includes(token));
};

const withNearDistance = (
  item: PlaceSuggestion,
  near?: [number, number],
): PlaceSuggestion => {
  if (!near) return item;
  return {
    ...item,
    distanceMeters: Math.round(distanceMeters(near, item.coordinate)),
  };
};

const scorePlaceSuggestion = (
  item: PlaceSuggestion,
  query: string,
  near?: [number, number],
  countryCode?: string,
) => {
  const normalizedQuery = normalizeSearchValue(query);
  const normalizedName = normalizeSearchValue(item.name);
  const normalizedAddress = normalizeSearchValue(item.address);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const civicIntent = hasMunicipalIntent(query);

  let score = 0;

  if (normalizedName === normalizedQuery) score += 2200;
  if (normalizedAddress === normalizedQuery) score += 1800;
  if (normalizedName.startsWith(normalizedQuery)) score += 1200;
  if (normalizedAddress.startsWith(normalizedQuery)) score += 800;
  if (normalizedName.includes(normalizedQuery)) score += 650;
  if (normalizedAddress.includes(normalizedQuery)) score += 420;

  queryTokens.forEach(token => {
    if (normalizedName.startsWith(token)) score += 180;
    else if (normalizedName.includes(token)) score += 110;

    if (normalizedAddress.startsWith(token)) score += 120;
    else if (normalizedAddress.includes(token)) score += 70;
  });

  if (civicIntent) {
    const civicHaystack = `${normalizedName} ${normalizedAddress}`;
    if (
      [
        'prefeitura',
        'city hall',
        'municipal',
        'municipio',
        'mairie',
        'ayuntamiento',
        'governo',
      ].some(token => civicHaystack.includes(token))
    ) {
      score += 260;
    }
  }

  const effectiveDistance =
    typeof item.distanceMeters === 'number' && Number.isFinite(item.distanceMeters)
      ? item.distanceMeters
      : near
        ? Math.round(distanceMeters(near, item.coordinate))
        : undefined;

  if (typeof effectiveDistance === 'number') {
    if (effectiveDistance <= 1000) score += 900;
    else if (effectiveDistance <= 5000) score += 700;
    else if (effectiveDistance <= 15000) score += 520;
    else if (effectiveDistance <= 30000) score += 300;
    else if (effectiveDistance <= 80000) score += 120;
    else score -= Math.min(160, Math.round(effectiveDistance / 2500));
  }

  const normalizedCountry = String(countryCode || '').trim().toUpperCase();
  const placeCountry = String(item.countryCode || '').trim().toUpperCase();
  if (normalizedCountry && placeCountry && normalizedCountry === placeCountry) {
    score += 140;
  }

  switch (item.trust?.providerId) {
    case 'alert_backend':
      score += 80;
      break;
    case 'recent-local':
      score += 120;
      break;
    default:
      break;
  }

  return score;
};

const dedupePlaces = (items: PlaceSuggestion[]) => {
  const unique = new Map<string, PlaceSuggestion>();
  items.forEach(item => {
    const key = [
      normalizeSearchValue(item.name),
      normalizeSearchValue(item.address),
      item.coordinate[0].toFixed(4),
      item.coordinate[1].toFixed(4),
    ].join('|');
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  });
  return Array.from(unique.values());
};

const sortPlacesBySearchContext = (
  items: PlaceSuggestion[],
  input: SearchInput,
) =>
  [...items]
    .map(item => withNearDistance(item, input.near))
    .sort((left, right) => {
      const scoreDelta =
        scorePlaceSuggestion(right, input.query, input.near, input.countryCode) -
        scorePlaceSuggestion(left, input.query, input.near, input.countryCode);
      if (scoreDelta !== 0) return scoreDelta;

      const leftDistance =
        typeof left.distanceMeters === 'number' && Number.isFinite(left.distanceMeters)
          ? left.distanceMeters
          : Number.MAX_SAFE_INTEGER;
      const rightDistance =
        typeof right.distanceMeters === 'number' && Number.isFinite(right.distanceMeters)
          ? right.distanceMeters
          : Number.MAX_SAFE_INTEGER;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;

      return left.name.localeCompare(right.name, input.locale, {
        sensitivity: 'base',
      });
    });

const toPlace = (params: {
  id: string;
  name: string;
  address: string;
  coordinate: [number, number];
  countryCode?: string;
  sourceName: string;
  providerId: string;
  connectionStatus: 'online' | 'degraded';
  near?: [number, number];
}): PlaceSuggestion => ({
  id: params.id,
  name: params.name,
  address: params.address,
  coordinate: params.coordinate,
  countryCode: params.countryCode,
  distanceMeters: params.near
    ? Math.round(distanceMeters(params.near, params.coordinate))
    : undefined,
  trust: {
    sourceName: params.sourceName,
    updatedAt: new Date().toISOString(),
    connectionStatus: params.connectionStatus,
    providerId: params.providerId,
  },
});

export const GeocodingService = {
  async search(input: SearchInput): Promise<PlaceSuggestion[]> {
    const query = input.query.trim();
    const cached = await OfflineCacheService.getRecentPlaces();
    const normalizedQuery = query.toLowerCase();
    const cachedRecent = cached.map(item => ({
      ...withNearDistance(item, input.near),
      trust: {
        ...item.trust,
        providerId: 'recent-local',
        sourceName: item.trust?.sourceName || 'Alert recent',
        connectionStatus: item.trust?.connectionStatus || 'online',
      },
    }));
    const cachedMatch = cachedRecent.filter(item => {
      if (!normalizedQuery) return true;
      const haystack = `${item.name} ${item.address}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    const contextualRecent = dedupePlaces([...cachedMatch, ...cachedRecent]);

    if (query.length === 0) {
      return sortPlacesBySearchContext(contextualRecent, input).slice(0, 8);
    }

    try {
      const results = await AlertMapsApiAdapter.searchPlaces({
        query,
        locale: input.locale,
        countryCode: input.countryCode,
        near: input.near,
      });
      const providerPlaces = results
        .map(item => {
          const longitude = Number(item?.longitude);
          const latitude = Number(item?.latitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
          }
          const name = String(item?.name || '').trim() || titleCase(query);
          const address = String(item?.address || '').trim() || name;
          return toPlace({
            id: String(item?.id || `${latitude},${longitude}`),
            name,
            address,
            coordinate: [longitude, latitude],
            countryCode: item?.countryCode || undefined,
            sourceName: String(item?.sourceName || 'Alert Maps'),
            providerId: 'alert_backend',
            connectionStatus:
              item?.connectionStatus === 'degraded' ? 'degraded' : 'online',
            near: input.near,
          });
        })
        .filter((item): item is PlaceSuggestion => Boolean(item));

      if (providerPlaces.length === 0) {
        return sortPlacesBySearchContext(contextualRecent, input).slice(0, 8);
      }

      const merged = dedupePlaces([
        ...providerPlaces,
        ...(query.length < 2 ? contextualRecent : cachedMatch),
      ]);
      return sortPlacesBySearchContext(merged, input).slice(0, 8);
    } catch {
      return sortPlacesBySearchContext(contextualRecent, input).slice(0, 8);
    }
  },

  async reverse(input: ReverseInput): Promise<PlaceSuggestion | null> {
    try {
      const payload = await AlertMapsApiAdapter.reversePlace({
        latitude: input.coordinate[1],
        longitude: input.coordinate[0],
        locale: input.locale,
      });
      const place = payload?.place;
      if (!place) return null;

      const longitude = Number(place.longitude);
      const latitude = Number(place.latitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return toPlace({
        id: String(place.id || `reverse-${latitude}:${longitude}`),
        name: String(place.name || '').trim() || 'Selected location',
        address:
          String(place.address || '').trim() ||
          String(place.name || '').trim() ||
          'Selected location',
        coordinate: [longitude, latitude],
        countryCode: place.countryCode || undefined,
        sourceName: String(place.sourceName || 'Alert Maps'),
        providerId: 'alert_backend',
        connectionStatus:
          place.connectionStatus === 'degraded' ? 'degraded' : 'online',
      });
    } catch {
      return null;
    }
  },
};

export default GeocodingService;
