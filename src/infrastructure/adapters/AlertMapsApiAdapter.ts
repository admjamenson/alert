import { fetchAlertApiJson } from '../http/AlertApiClient';

export type BackendPlaceSuggestion = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  countryCode?: string | null;
  providerId?: string;
  sourceName?: string;
  connectionStatus?: 'online' | 'degraded' | 'offline';
};

export type BackendReverseGeocodePayload = {
  place: BackendPlaceSuggestion | null;
  adminContext: {
    countryCode?: string | null;
    countryName?: string | null;
    stateName?: string | null;
    cityName?: string | null;
    countyName?: string | null;
    isoStateCode?: string | null;
    providerUsed?: string;
  } | null;
};

export const AlertMapsApiAdapter = {
  async searchPlaces(params: {
    query: string;
    locale: string;
    countryCode?: string;
    near?: [number, number];
  }): Promise<BackendPlaceSuggestion[]> {
    const payload = await fetchAlertApiJson<{ results?: BackendPlaceSuggestion[] }>(
      'api/v1/maps/geocode/search',
      {
        params: {
          q: params.query,
          locale: params.locale,
          country: params.countryCode,
          lat: params.near ? params.near[1].toFixed(5) : undefined,
          lon: params.near ? params.near[0].toFixed(5) : undefined,
        },
        timeoutMs: 2600,
      },
    );
    return Array.isArray(payload?.results) ? payload.results : [];
  },

  async reversePlace(params: {
    latitude: number;
    longitude: number;
    locale: string;
  }): Promise<BackendReverseGeocodePayload> {
    return fetchAlertApiJson<BackendReverseGeocodePayload>(
      'api/v1/maps/geocode/reverse',
      {
        params: {
          lat: params.latitude.toFixed(5),
          lon: params.longitude.toFixed(5),
          locale: params.locale,
        },
        timeoutMs: 2400,
      },
    );
  },
};
