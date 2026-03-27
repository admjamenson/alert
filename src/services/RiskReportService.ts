import AsyncStorage from '@react-native-async-storage/async-storage';

const REPORTS_KEY = '@Alert:RiskReports';

const MAX_REPORTS = 400;
const TTL_DAYS = 30;

const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const DEDUPE_RADIUS_M = 60;

export type RiskReportSource = 'self' | 'guardian' | 'quick_action';

export type RiskReport = {
  id: string;
  kind: 'sos';
  latitude: number;
  longitude: number;
  severity: number; // 1..3
  source: RiskReportSource;
  timestamp: string; // ISO
};

type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { score: number; count: number };
};

export type RiskHeatmap = {
  type: 'FeatureCollection';
  features: PointFeature[];
};

const parseList = (raw: string | null): RiskReport[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RiskReport[]) : [];
  } catch {
    return [];
  }
};

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toRad = (v: number) => (v * Math.PI) / 180;

const distanceMeters = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const pruneReports = (items: RiskReport[]): RiskReport[] => {
  const now = Date.now();
  const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;
  const filtered = items.filter(item => {
    const ts = Date.parse(item.timestamp);
    if (!Number.isFinite(ts)) return false;
    return now - ts <= ttlMs;
  });
  filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return filtered.slice(0, MAX_REPORTS);
};

const decayWeight = (timestampIso: string): number => {
  const ts = Date.parse(timestampIso);
  if (!Number.isFinite(ts)) return 0.5;
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  // Soft decay so recent reports weigh more, but older ones still matter.
  return Math.exp(-ageDays / 10);
};

export const RiskReportService = {
  async getAll(): Promise<RiskReport[]> {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    return pruneReports(parseList(raw));
  },

  async addSosActivation(
    location: { latitude: number; longitude: number } | null | undefined,
    source: RiskReportSource = 'self',
  ): Promise<void> {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!isFiniteCoord(latitude) || !isFiniteCoord(longitude)) return;

    const now = new Date();
    const report: RiskReport = {
      id: `risk-sos-${now.getTime()}`,
      kind: 'sos',
      latitude,
      longitude,
      severity: 3,
      source,
      timestamp: now.toISOString(),
    };

    const list = await this.getAll();
    const last = list[0];
    if (last?.kind === 'sos') {
      const lastTs = Date.parse(last.timestamp);
      if (
        Number.isFinite(lastTs) &&
        Date.now() - lastTs < DEDUPE_WINDOW_MS &&
        distanceMeters(
          { lat: last.latitude, lon: last.longitude },
          { lat: report.latitude, lon: report.longitude },
        ) < DEDUPE_RADIUS_M
      ) {
        return;
      }
    }

    const next = pruneReports([report, ...list]);
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(next));
  },

  async getHeatmap(
    center: { latitude: number; longitude: number } | null | undefined,
    options?: { radiusMeters?: number; cellSizeMeters?: number },
  ): Promise<RiskHeatmap> {
    const latitude = Number(center?.latitude);
    const longitude = Number(center?.longitude);
    if (!isFiniteCoord(latitude) || !isFiniteCoord(longitude)) {
      return { type: 'FeatureCollection', features: [] };
    }

    const radiusMeters = Math.max(300, Number(options?.radiusMeters ?? 2500));
    const cellSizeMeters = Math.max(120, Number(options?.cellSizeMeters ?? 240));

    const list = await this.getAll();
    const nearby = list.filter(item => {
      const dist = distanceMeters(
        { lat: latitude, lon: longitude },
        { lat: item.latitude, lon: item.longitude },
      );
      return dist <= radiusMeters;
    });

    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(toRad(latitude));
    const stepLat = cellSizeMeters / metersPerDegLat;
    const stepLon = cellSizeMeters / Math.max(1, metersPerDegLon);

    const cells = new Map<string, { lat: number; lon: number; score: number; count: number }>();
    for (const item of nearby) {
      const cellLat = Math.floor(item.latitude / stepLat);
      const cellLon = Math.floor(item.longitude / stepLon);
      const key = `${cellLat}:${cellLon}`;
      const centerLat = (cellLat + 0.5) * stepLat;
      const centerLon = (cellLon + 0.5) * stepLon;
      const weight = Math.max(0.2, decayWeight(item.timestamp));
      const inc = Math.max(1, item.severity) * weight;

      const prev = cells.get(key);
      if (!prev) {
        cells.set(key, { lat: centerLat, lon: centerLon, score: inc, count: 1 });
      } else {
        prev.score += inc;
        prev.count += 1;
      }
    }

    const features: PointFeature[] = [];
    for (const cell of cells.values()) {
      if (cell.score < 0.7) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cell.lon, cell.lat] },
        properties: {
          score: Math.round(cell.score * 10) / 10,
          count: cell.count,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  },
};

