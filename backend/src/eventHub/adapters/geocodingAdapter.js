const { fetchJsonWithRetry } = require('../fetcher');

const OPEN_METEO_SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_REVERSE_URL = 'https://geocoding-api.open-meteo.com/v1/reverse';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const pickFirst = (...values) =>
  values.find(
    value => typeof value === 'string' && value.trim().length > 0,
  ) || '';

const safeString = value => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeLanguage = locale => {
  const raw = String(locale || 'en').trim();
  if (!raw) return 'en';
  return raw;
};

const toSearchResult = (row, index) => {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const name = String(row?.name || '').trim();
  if (!name) return null;

  const parts = [row?.admin1, row?.country]
    .map(part => String(part || '').trim())
    .filter(Boolean);

  return {
    id: String(row?.id || `geo-${latitude}:${longitude}:${index}`),
    name,
    address: parts.length > 0 ? `${name}, ${parts.join(', ')}` : name,
    latitude,
    longitude,
    countryCode: safeString(row?.country_code)?.toUpperCase() || null,
    providerId: 'alert_backend',
    sourceName: 'Alert Maps',
    connectionStatus: 'online',
  };
};

const parseNominatimReverse = json => {
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
  const isoStateCandidateKey = Object.keys(address).find(key =>
    String(key || '').toLowerCase().startsWith('iso3166-2'),
  );

  return {
    countryCode: safeString(address.country_code)?.toUpperCase() || null,
    countryName: safeString(address.country),
    stateName: safeString(address.state),
    cityName: safeString(city),
    countyName: safeString(address.county),
    isoStateCode: isoStateCandidateKey
      ? safeString(address[isoStateCandidateKey])
      : null,
    providerUsed: 'alert_backend',
  };
};

const parseOpenMeteoReverse = json => {
  const result = Array.isArray(json?.results) ? json.results[0] : null;
  if (!result) return null;

  const city = pickFirst(
    result.name,
    result.locality,
    result.admin2,
    result.admin1,
  );

  return {
    countryCode: safeString(result.country_code)?.toUpperCase() || null,
    countryName: safeString(result.country),
    stateName: safeString(result.admin1),
    cityName: safeString(city),
    countyName: safeString(result.admin2),
    isoStateCode: null,
    providerUsed: 'alert_backend',
  };
};

const buildPlaceFromReverse = ({ latitude, longitude, primary, fallback }) => {
  const row = primary || fallback;
  if (!row) return null;

  const name = pickFirst(row.cityName, row.countyName, row.stateName, row.countryName);
  if (!name) return null;

  const addressParts = [row.stateName, row.countryName]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  return {
    id: `reverse-${Number(latitude).toFixed(5)}:${Number(longitude).toFixed(5)}`,
    name,
    address: addressParts.length > 0 ? `${name}, ${addressParts.join(', ')}` : name,
    latitude: Number(latitude),
    longitude: Number(longitude),
    countryCode: safeString(row.countryCode)?.toUpperCase() || null,
    providerId: 'alert_backend',
    sourceName: 'Alert Maps',
    connectionStatus: 'online',
  };
};

const searchPlaces = async (
  { query, locale, countryCode },
  { userAgent } = {},
) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return [];

  const params = [
    `name=${encodeURIComponent(safeQuery)}`,
    'count=8',
    `language=${encodeURIComponent(normalizeLanguage(locale))}`,
    'format=json',
  ];
  const safeCountryCode = String(countryCode || '').trim().toUpperCase();
  if (safeCountryCode) {
    params.push(`countryCode=${encodeURIComponent(safeCountryCode)}`);
  }

  const response = await fetchJsonWithRetry(
    `${OPEN_METEO_SEARCH_URL}?${params.join('&')}`,
    {
      cacheKey: `geo-search:${safeQuery.toLowerCase()}:${safeCountryCode}:${normalizeLanguage(
        locale,
      ).toLowerCase()}`,
      cacheTtlMs: 5 * 60 * 1000,
      retries: 1,
      retryDelayMs: 120,
      timeoutMs: 2200,
      rateLimitKey: 'geo-search',
      maxPerMinute: 120,
      headers: {
        'User-Agent': userAgent,
      },
    },
  );

  if (!response.ok || !Array.isArray(response.json?.results)) {
    return [];
  }

  return response.json.results
    .map((row, index) => toSearchResult(row, index))
    .filter(Boolean);
};

const reverseGeocode = async (
  { latitude, longitude, locale },
  { userAgent } = {},
) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const safeLocale = normalizeLanguage(locale);
  const [nominatimResponse, openMeteoResponse] = await Promise.all([
    fetchJsonWithRetry(
      `${NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=10&lat=${encodeURIComponent(
        String(lat),
      )}&lon=${encodeURIComponent(String(lon))}&addressdetails=1`,
      {
        cacheKey: `geo-reverse-nominatim:${lat.toFixed(3)}:${lon.toFixed(
          3,
        )}:${safeLocale.toLowerCase()}`,
        cacheTtlMs: 30 * 60 * 1000,
        retries: 1,
        retryDelayMs: 120,
        timeoutMs: 1800,
        rateLimitKey: 'geo-reverse-nominatim',
        maxPerMinute: 90,
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': safeLocale,
        },
      },
    ),
    fetchJsonWithRetry(
      `${OPEN_METEO_REVERSE_URL}?latitude=${encodeURIComponent(
        String(lat),
      )}&longitude=${encodeURIComponent(String(lon))}&language=${encodeURIComponent(
        safeLocale,
      )}&count=1`,
      {
        cacheKey: `geo-reverse-openmeteo:${lat.toFixed(3)}:${lon.toFixed(
          3,
        )}:${safeLocale.toLowerCase()}`,
        cacheTtlMs: 30 * 60 * 1000,
        retries: 1,
        retryDelayMs: 120,
        timeoutMs: 1800,
        rateLimitKey: 'geo-reverse-openmeteo',
        maxPerMinute: 90,
        headers: {
          'User-Agent': userAgent,
        },
      },
    ),
  ]);

  const nominatim = nominatimResponse.ok
    ? parseNominatimReverse(nominatimResponse.json)
    : null;
  const openMeteo = openMeteoResponse.ok
    ? parseOpenMeteoReverse(openMeteoResponse.json)
    : null;

  const adminContext =
    nominatim && (nominatim.cityName || nominatim.stateName)
      ? {
          ...openMeteo,
          ...nominatim,
          providerUsed: 'alert_backend',
        }
      : openMeteo || nominatim;

  if (!adminContext) {
    return null;
  }

  return {
    place: buildPlaceFromReverse({
      latitude: lat,
      longitude: lon,
      primary: adminContext,
      fallback: openMeteo,
    }),
    adminContext,
  };
};

module.exports = {
  searchPlaces,
  reverseGeocode,
};
