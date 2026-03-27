import { APP_CONFIG } from '../../core/config';
import OfflineCacheService from './OfflineCacheService';
import ProviderRouter from './ProviderRouter';
import { PlaceSuggestion } from './types';

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

const getApiBaseUrl = () => {
  const globalOverride = (globalThis as any)?.ALERT_API_URL || (globalThis as any)?.__ALERT_API_URL__;
  const envOverride = typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return (globalOverride || envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const toLanguageCode = (locale: string) => {
  const safe = (locale || 'en').toLowerCase();
  const [lang] = safe.split('-');
  return lang || 'en';
};

const titleCase = (value: string) => {
  return value
    .split(' ')
    .filter(Boolean)
    .map(item => item[0].toUpperCase() + item.slice(1))
    .join(' ');
};

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
  const nextDistance = Math.round(distanceMeters(near, item.coordinate));
  return {
    ...item,
    distanceMeters: nextDistance,
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
    case 'backend':
      score += 80;
      break;
    case 'open-meteo':
      score += 40;
      break;
    case 'photon':
      score += 25;
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
) => {
  return [...items]
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
};

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
  worldview?: string;
}): PlaceSuggestion => {
  const nearDistance = params.near
    ? Math.round(distanceMeters(params.near, params.coordinate))
    : undefined;

  return {
    id: params.id,
    name: params.name,
    address: params.address,
    coordinate: params.coordinate,
    countryCode: params.countryCode,
    distanceMeters: nearDistance,
    trust: {
      sourceName: params.sourceName,
      updatedAt: new Date().toISOString(),
      connectionStatus: params.connectionStatus,
      providerId: params.providerId,
      worldview: params.worldview,
    },
  };
};

const backendSearch = async (input: SearchInput): Promise<PlaceSuggestion[] | null> => {
  const base = getApiBaseUrl();
  if (!base) return null;

  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  const query = [
    `q=${encodeURIComponent(input.query)}`,
    `locale=${encodeURIComponent(input.locale)}`,
    input.countryCode ? `country=${encodeURIComponent(input.countryCode)}` : null,
    input.worldview ? `worldview=${encodeURIComponent(input.worldview)}` : null,
    input.near ? `lat=${encodeURIComponent(String(input.near[1]))}` : null,
    input.near ? `lon=${encodeURIComponent(String(input.near[0]))}` : null,
  ]
    .filter(Boolean)
    .join('&');

  const url = `${trimmed}/v1/maps/geocode/autocomplete?${query}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as any;
  const items: any[] = Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json?.features)
      ? json.features
      : [];

  if (items.length === 0) return null;

  return items
    .map(item => {
      const lon = Number(item?.lon ?? item?.longitude ?? item?.center?.[0] ?? item?.geometry?.coordinates?.[0]);
      const lat = Number(item?.lat ?? item?.latitude ?? item?.center?.[1] ?? item?.geometry?.coordinates?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const name =
        String(item?.name ?? item?.title ?? item?.properties?.name ?? item?.text ?? '').trim() ||
        titleCase(input.query);

      const address =
        String(item?.address ?? item?.full_address ?? item?.place_name ?? item?.properties?.label ?? '').trim() ||
        name;

      return toPlace({
        id: String(item?.id ?? `${lat},${lon}`),
        name,
        address,
        coordinate: [lon, lat],
        countryCode: item?.countryCode ?? item?.country_code,
        sourceName: 'Alert Maps',
        providerId: 'backend',
        connectionStatus: 'online',
        near: input.near,
        worldview: input.worldview,
      });
    })
    .filter((item): item is PlaceSuggestion => Boolean(item));
};

const openMeteoSearch = async (input: SearchInput): Promise<PlaceSuggestion[] | null> => {
  const lang = toLanguageCode(input.locale);
  const params = [
    `name=${encodeURIComponent(input.query)}`,
    'count=8',
    `language=${encodeURIComponent(lang)}`,
    'format=json',
  ];
  if (input.countryCode) params.push(`countryCode=${encodeURIComponent(input.countryCode.toUpperCase())}`);

  const url = `https://geocoding-api.open-meteo.com/v1/search?${params.join('&')}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as any;
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  if (rows.length === 0) return null;

  return rows
    .map((row, index) => {
      const lat = Number(row?.latitude);
      const lon = Number(row?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const name = String(row?.name || '').trim();
      const parts = [row?.admin1, row?.country]
        .map(part => String(part || '').trim())
        .filter(Boolean);
      const address = parts.length > 0 ? `${name}, ${parts.join(', ')}` : name;

      return toPlace({
        id: `meteo-${row?.id ?? `${lat}:${lon}:${index}`}`,
        name,
        address,
        coordinate: [lon, lat],
        countryCode: row?.country_code,
        sourceName: 'Open-Meteo',
        providerId: 'open-meteo',
        connectionStatus: 'online',
        near: input.near,
        worldview: input.worldview,
      });
    })
    .filter((item): item is PlaceSuggestion => Boolean(item));
};

const photonSearch = async (input: SearchInput): Promise<PlaceSuggestion[] | null> => {
  const lang = toLanguageCode(input.locale);
  const params = [
    `q=${encodeURIComponent(input.query)}`,
    'limit=8',
    `lang=${encodeURIComponent(lang)}`,
  ];

  if (input.near) {
    params.push(`lon=${encodeURIComponent(String(input.near[0]))}`);
    params.push(`lat=${encodeURIComponent(String(input.near[1]))}`);
  }

  const url = `https://photon.komoot.io/api/?${params.join('&')}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as any;
  const features: any[] = Array.isArray(json?.features) ? json.features : [];
  if (features.length === 0) return null;

  return features
    .map((feature, index) => {
      const lon = Number(feature?.geometry?.coordinates?.[0]);
      const lat = Number(feature?.geometry?.coordinates?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const props = feature?.properties || {};
      const name = String(props?.name || '').trim() || titleCase(input.query);
      const address = [props?.street, props?.housenumber, props?.city, props?.country]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(', ');

      return toPlace({
        id: `photon-${props?.osm_id ?? `${lat}:${lon}:${index}`}`,
        name,
        address: address || name,
        coordinate: [lon, lat],
        countryCode: props?.countrycode,
        sourceName: 'Photon',
        providerId: 'photon',
        connectionStatus: 'online',
        near: input.near,
        worldview: input.worldview,
      });
    })
    .filter((item): item is PlaceSuggestion => Boolean(item));
};

const openMeteoReverse = async (input: ReverseInput): Promise<PlaceSuggestion | null> => {
  const lang = toLanguageCode(input.locale);
  const [lon, lat] = input.coordinate;
  const url =
    `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}&language=${encodeURIComponent(lang)}&count=1`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = (await res.json()) as any;
  const row = Array.isArray(json?.results) ? json.results[0] : null;
  if (!row) return null;

  const name = String(row?.name || '').trim() || 'Selected location';
  const parts = [row?.admin1, row?.country]
    .map(part => String(part || '').trim())
    .filter(Boolean);

  return toPlace({
    id: `reverse-${lat}:${lon}`,
    name,
    address: parts.length > 0 ? `${name}, ${parts.join(', ')}` : name,
    coordinate: [lon, lat],
    countryCode: row?.country_code,
    sourceName: 'Open-Meteo',
    providerId: 'open-meteo-reverse',
    connectionStatus: 'online',
    worldview: input.worldview,
  });
};

export const GeocodingService = {
  async search(input: SearchInput): Promise<PlaceSuggestion[]> {
    const query = input.query.trim();
    const cached = await OfflineCacheService.getRecentPlaces();
    const normalizedQuery = query.toLowerCase();
    const cachedRecent = cached
      .map(item => ({
        ...withNearDistance(item, input.near),
        trust: {
          ...item.trust,
          providerId: 'recent-local',
          sourceName: item.trust?.sourceName || 'Alert recent',
          connectionStatus: item.trust?.connectionStatus || 'online',
        },
      }));
    const cachedMatch = cachedRecent
      .filter(item => {
        if (!normalizedQuery) return true;
        const hay = `${item.name} ${item.address}`.toLowerCase();
        return hay.includes(normalizedQuery);
      });
    const contextualRecent = dedupePlaces([...cachedMatch, ...cachedRecent]);

    if (query.length === 0) {
      return sortPlacesBySearchContext(contextualRecent, input).slice(0, 8);
    }

    const providerResult = await ProviderRouter.execute(
      [
        {
          id: 'backend-geocoding',
          timeoutMs: 1300,
          cooldownMs: 45_000,
          execute: backendSearch,
        },
        {
          id: 'open-meteo-geocoding',
          timeoutMs: 1200,
          cooldownMs: 20_000,
          execute: openMeteoSearch,
        },
        {
          id: 'photon-geocoding',
          timeoutMs: 1200,
          cooldownMs: 20_000,
          execute: photonSearch,
        },
      ],
      input,
      { maxRetriesPerProvider: 1 },
    );

    if (!providerResult?.data || providerResult.data.length === 0) {
      return sortPlacesBySearchContext(contextualRecent, input).slice(0, 8);
    }

    const providerPlaces = providerResult.data.map(item => ({
        ...item,
        trust: {
          ...item.trust,
          connectionStatus: providerResult.connectionStatus,
          providerId: providerResult.providerId,
        },
    }));

    const merged = dedupePlaces([
      ...providerPlaces,
      ...(query.length < 2 ? contextualRecent : cachedMatch),
    ]);
    return sortPlacesBySearchContext(merged, input).slice(0, 8);
  },

  async reverse(input: ReverseInput): Promise<PlaceSuggestion | null> {
    const providerResult = await ProviderRouter.execute(
      [
        {
          id: 'open-meteo-reverse',
          timeoutMs: 1200,
          cooldownMs: 20_000,
          execute: openMeteoReverse,
        },
      ],
      input,
      { maxRetriesPerProvider: 0 },
    );

    if (!providerResult?.data) return null;

    return {
      ...providerResult.data,
      trust: {
        ...providerResult.data.trust,
        connectionStatus: providerResult.connectionStatus,
        providerId: providerResult.providerId,
      },
    };
  },
};

export default GeocodingService;
