import { getAlertApiBaseUrl } from '../../core/config';

export type TrafficSegment = {
  id: string;
  geometry: Array<[number, number]>;
  congestion: 'low' | 'medium' | 'high';
};

export type TrafficSnapshot = {
  available: boolean;
  sourceName: string;
  updatedAt: string;
  segments: TrafficSegment[];
};

const getApiBaseUrl = () => getAlertApiBaseUrl();

export const TrafficService = {
  async getSnapshot(
    bounds?: [number, number, number, number],
    locale?: string,
  ): Promise<TrafficSnapshot | null> {
    const base = getApiBaseUrl();
    if (!base) return null;

    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
    const query = [
      bounds ? `bbox=${encodeURIComponent(bounds.join(','))}` : null,
      locale ? `locale=${encodeURIComponent(locale)}` : null,
    ]
      .filter(Boolean)
      .join('&');

    const url = `${trimmed}/v1/maps/traffic${query ? `?${query}` : ''}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = (await res.json()) as TrafficSnapshot;
      if (!json || !Array.isArray(json.segments)) return null;
      return json;
    } catch {
      return null;
    }
  },

  estimateRouteTrafficLevel(
    distanceKm: number,
    etaMin: number,
  ): 'low' | 'medium' | 'high' | 'unknown' {
    if (
      !Number.isFinite(distanceKm) ||
      !Number.isFinite(etaMin) ||
      distanceKm <= 0
    ) {
      return 'unknown';
    }

    const pace = etaMin / distanceKm;
    if (pace <= 1.9) return 'low';
    if (pace <= 2.8) return 'medium';
    return 'high';
  },
};

export default TrafficService;
