import { AlertSignal } from '../../types/alertIntelligence';
import {
  RiskReport,
  RiskReportService,
  RiskReportSource,
} from '../RiskReportService';

export type CrowdScope = 'CITY' | 'STATE' | 'COUNTRY';

const MAX_SIGNAL_AGE_MS = 12 * 60 * 60 * 1000;
const RADIUS_BY_SCOPE_KM: Record<CrowdScope, number> = {
  CITY: 6,
  STATE: 20,
  COUNTRY: 45,
};

const toRad = (v: number) => (v * Math.PI) / 180;

const distanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const severityFromReport = (report: RiskReport): AlertSignal['severity'] => {
  if (report.severity >= 3) return 'high';
  if (report.severity >= 2) return 'medium';
  return 'low';
};

const freshnessFromDate = (timestamp: string): AlertSignal['freshness'] => {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) return 'UNKNOWN';
  const age = Date.now() - parsed;
  if (age <= 20 * 60 * 1000) return 'FRESH';
  if (age <= 90 * 60 * 1000) return 'STALE';
  return 'UNKNOWN';
};

const groupedConsensusBonus = (reports: RiskReport[]) => {
  const byBucket = new Map<string, Set<string>>();
  reports.forEach(report => {
    const timeBucket = Math.floor(Date.parse(report.timestamp) / (30 * 60 * 1000));
    const latBucket = Number(report.latitude.toFixed(2));
    const lonBucket = Number(report.longitude.toFixed(2));
    const key = `${latBucket}:${lonBucket}:${timeBucket}`;
    const set = byBucket.get(key) || new Set<string>();
    set.add(report.source);
    byBucket.set(key, set);
  });
  const consensusByKey = new Map<string, number>();
  byBucket.forEach((sources, key) => {
    consensusByKey.set(key, sources.size >= 2 ? 0.12 : 0);
  });
  return consensusByKey;
};

export const CrowdReports = {
  async getSignals(params: {
    latitude: number;
    longitude: number;
    scope: CrowdScope;
  }): Promise<AlertSignal[]> {
    const all = await RiskReportService.getAll();
    const radiusKm = RADIUS_BY_SCOPE_KM[params.scope];
    const recent = all.filter(report => {
      const ts = Date.parse(report.timestamp);
      if (!Number.isFinite(ts)) return false;
      if (Date.now() - ts > MAX_SIGNAL_AGE_MS) return false;
      return (
        distanceKm(
          { lat: params.latitude, lon: params.longitude },
          { lat: report.latitude, lon: report.longitude },
        ) <= radiusKm
      );
    });

    if (recent.length === 0) return [];

    const consensusByKey = groupedConsensusBonus(recent);
    return recent.slice(0, 80).map((report, index) => {
      const timeBucket = Math.floor(Date.parse(report.timestamp) / (30 * 60 * 1000));
      const latBucket = Number(report.latitude.toFixed(2));
      const lonBucket = Number(report.longitude.toFixed(2));
      const key = `${latBucket}:${lonBucket}:${timeBucket}`;
      const bonus = consensusByKey.get(key) || 0;
      const confidence = Math.max(0.25, Math.min(0.7, 0.42 + bonus));

      return {
        id: `crowd-${report.id || index}`,
        category: 'sos_nearby',
        severity: severityFromReport(report),
        geometry: {
          type: 'Point',
          coordinates: [report.longitude, report.latitude],
        },
        timestamp: report.timestamp,
        sourceName: 'Alert Community',
        sourceUrl: undefined,
        confidence,
        officiality: 'REFERENCE',
        freshness: freshnessFromDate(report.timestamp),
        summary: '',
      } as AlertSignal;
    });
  },

  async pushReport(params: {
    latitude: number;
    longitude: number;
    source?: RiskReportSource;
  }): Promise<void> {
    await RiskReportService.addSosActivation(
      {
        latitude: params.latitude,
        longitude: params.longitude,
      },
      params.source || 'quick_action',
    );
  },
};

export default CrowdReports;
