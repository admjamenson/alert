import { fetchAlertApiJson } from '../http/AlertApiClient';
import type { AlertNotification } from '../../types/notifications';

type EpidemicMode = 'pandemic' | 'epidemic';
type EpidemicWindow = '7d' | 'all';

export type BackendEpidemicSnapshot = {
  available?: boolean;
  sourceTier?: 1 | 2 | 3;
  disease?: { id: string; name: string };
  rollups?: {
    country?: {
      name: string;
      metrics?: Record<string, number | null>;
      trend?: string | null;
      asOf?: string;
    };
    state?: {
      name: string;
      metrics?: Record<string, number | null>;
      trend?: string | null;
      asOf?: string;
    };
    municipal?: {
      name: string;
      metrics?: Record<string, number | null>;
      trend?: string | null;
      asOf?: string;
    };
  };
  freshness?: {
    asOf?: string;
    fetchedAt?: string;
    stalenessSec?: number;
    status?: 'FRESH' | 'STALE' | 'UNKNOWN';
    refreshPolicy?: 'AUTO_60S' | 'AUTO_5M' | 'MANUAL';
  };
  sources?: Array<{
    name: string;
    url: string;
    tier: 1 | 2 | 3;
    authorityLevel: 'WHO' | 'federal' | 'state' | 'municipal';
  }>;
  confidence?: number;
  reason?: string;
};

export type BackendWeatherFeed = {
  available: boolean;
  location: {
    city: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    tempC: number | null;
    apparentTempC: number | null;
    humidity: number | null;
    windKmh: number;
    weatherCode: number;
    icon: string;
    labelKey: string;
    isDay: boolean;
    precipitation: number;
    rain: number;
    showers: number;
    snowfall: number;
  } | null;
  daily: {
    maxTempC?: number | null;
    minTempC?: number | null;
    sunrise?: string;
    sunset?: string;
    forecastDays: Array<{
      date: string;
      weatherCode: number;
      icon: string;
      labelKey: string;
      maxTempC: number | null;
      minTempC: number | null;
      rainChance?: number | null;
    }>;
  };
  intelligenceSignal: {
    kind: 'rain' | 'snow' | 'hail' | 'lightning' | 'thunder';
    icon: string;
    labelKey: string;
    confidence: number;
    startsInMinutes: number;
    source: 'current' | 'forecast';
  } | null;
  freshness: {
    fetchedAt: string;
    cacheTtlSec: number;
    status: 'FRESH' | 'STALE' | 'UNKNOWN';
  };
};

export type BackendRiskFeed = {
  alerts: AlertNotification[];
  providers?: Array<{
    providerId: string;
    status: string;
    ok: boolean;
    stale: boolean;
    trustTier: 'A' | 'B' | 'C';
    supportedEventTypes: string[];
  }>;
  preAlert?: {
    shouldNotify: boolean;
    reasonCodes: string[];
  };
  meta?: {
    generatedAt?: string;
    failClosed?: boolean;
    cacheHit?: boolean;
    hubAvailable?: boolean;
  };
};

export const AlertFeedsApiAdapter = {
  async getWeatherFeed(params: {
    latitude: number;
    longitude: number;
    locale?: string;
  }): Promise<BackendWeatherFeed> {
    return fetchAlertApiJson<BackendWeatherFeed>('api/v1/weather/feed', {
      params: {
        lat: params.latitude.toFixed(5),
        lon: params.longitude.toFixed(5),
        locale: params.locale,
      },
      timeoutMs: 2800,
    });
  },

  async getRiskFeed(params: {
    latitude: number;
    longitude: number;
    riskScore?: number;
    radiusKm?: number;
    limit?: number;
  }): Promise<BackendRiskFeed> {
    return fetchAlertApiJson<BackendRiskFeed>('api/v1/risk/feed', {
      params: {
        lat: params.latitude.toFixed(5),
        lon: params.longitude.toFixed(5),
        riskScore:
          typeof params.riskScore === 'number'
            ? params.riskScore.toFixed(2)
            : undefined,
        radiusKm: params.radiusKm,
        limit: params.limit,
      },
      timeoutMs: 2600,
    });
  },

  async getEpidemicFeed(params: {
    latitude: number;
    longitude: number;
    mode: EpidemicMode;
    window: EpidemicWindow;
  }): Promise<BackendEpidemicSnapshot> {
    const disease = params.mode === 'pandemic' ? 'covid19' : 'influenza';
    return fetchAlertApiJson<BackendEpidemicSnapshot>('api/v1/epidemic/feed', {
      params: {
        lat: params.latitude.toFixed(5),
        lon: params.longitude.toFixed(5),
        locale: 'en',
        disease,
        metric: 'cases',
        window: params.window,
        normalize: 'count',
      },
      timeoutMs: 3200,
    });
  },
};
