export type TrustMeta = {
  sourceName: string;
  updatedAt: string;
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
};

export type RouteRequest = {
  from: [number, number];
  to: [number, number];
  locale: string;
  worldview?: string;
  riskPenalty?: number;
};

export type ProviderCandidate<TInput, TOutput> = {
  id: string;
  timeoutMs: number;
  cooldownMs?: number;
  execute: (input: TInput) => Promise<TOutput | null>;
};

export type ProviderRunResult<TOutput> = {
  data: TOutput;
  providerId: string;
  connectionStatus: 'online' | 'degraded';
  attempts: number;
};
