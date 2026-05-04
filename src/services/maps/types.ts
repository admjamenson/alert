export type {
  GuardianSuggestion,
  PlaceSuggestion,
  RouteKind,
  RouteOption,
  RouteRequest,
  TrafficLevel,
  TrustMeta,
} from '../../domain/maps/MapModels';

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
