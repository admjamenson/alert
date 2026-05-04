export type RouteTransportMode =
  | 'car'
  | 'bus'
  | 'motorcycle'
  | 'bike'
  | 'walk';

export type RouteMode =
  | 'provider'
  | 'estimated_straight_line'
  | 'unavailable';

export type RoutePrecision = 'high' | 'low' | 'none';

export type RouteAdvisory = {
  code: string;
  severity: 'info' | 'warning';
};

export type DefaultRouteDestination = {
  latitude: number;
  longitude: number;
  label?: string;
  transportMode?: RouteTransportMode;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type RouteDetails = {
  line: Array<[number, number]>;
  distanceKm?: number;
  durationMin?: number;
  transportMode?: RouteTransportMode;
  routeMode: RouteMode;
  precision: RoutePrecision;
  degraded: boolean;
  providerAvailable: boolean;
  providerId?: string;
  reasonCode?: string | null;
  advisory?: RouteAdvisory | null;
};
