import type {
  RouteAdvisory,
  RouteMode,
  RoutePrecision,
} from '../route/RouteModels';

export type TrustMeta = {
  sourceName?: string;
  updatedAt?: string;
  connectionStatus: 'online' | 'degraded' | 'offline';
  providerId: string;
};

export type PlaceSuggestion = {
  id?: string;
  name: string;
  address: string;
  coordinate: [number, number];
  countryCode?: string;
  distanceMeters?: number;
  trust?: TrustMeta;
};

export type GuardianSuggestion = {
  id: string;
  name: string;
  coordinate: [number, number];
  distanceMeters?: number;
  phone?: string;
  avatarUri?: string;
  lastLocation?: [number, number];
  lastUpdatedAt?: string;
};

export type RouteKind = 'fastest' | 'shortest' | 'safest' | 'alternative';

export type TrafficLevel = 'low' | 'medium' | 'high' | 'unknown';

export type RouteOption = {
  id: string;
  kind: RouteKind;
  title: string;
  etaMin: number;
  distanceKm: number;
  geometry: Array<[number, number]>;
  safetyScore?: number;
  trafficLevel?: TrafficLevel;
  trust?: TrustMeta;
  routeMode: RouteMode;
  precision: RoutePrecision;
  degraded: boolean;
  providerAvailable: boolean;
  providerId?: string;
  reasonCode?: string | null;
  advisory?: RouteAdvisory | null;
};

export type RouteRequest = {
  from: [number, number];
  to: [number, number];
  locale: string;
  transportMode?: 'car' | 'bus' | 'motorcycle' | 'bike' | 'walk';
  worldview?: string;
  riskPenalty?: number;
};
