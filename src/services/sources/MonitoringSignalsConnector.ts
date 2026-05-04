import { MonitoringService } from '../MonitoringService';
import {
  extractAlertCoordinate,
  mapAlertToCategory,
} from '../importantAlertUtils';
import { normalizeToIsoDateTime } from '../../utils/dateTimeFormat';
import { AlertSignal, AlertSignalSeverity } from '../../types/alertIntelligence';
import { AlertSignalsConnector } from './types';

const severityFromAlert = (alert: Record<string, any>): AlertSignalSeverity => {
  const raw = String(
    alert?.severity ||
      (alert?.data as Record<string, any> | undefined)?.severity ||
      '',
  )
    .trim()
    .toLowerCase();
  if (raw.includes('critical') || raw.includes('extreme')) return 'critical';
  if (raw.includes('high') || raw.includes('severe')) return 'high';
  if (raw.includes('medium') || raw.includes('moderate')) return 'medium';
  return 'low';
};

const confidenceBySeverity: Record<AlertSignalSeverity, number> = {
  low: 0.62,
  medium: 0.74,
  high: 0.86,
  critical: 0.93,
};

const freshnessFromTimestamp = (timestamp?: string): AlertSignal['freshness'] => {
  const parsedMs = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsedMs)) return 'UNKNOWN';
  const ageMs = Math.max(0, Date.now() - parsedMs);
  if (ageMs <= 10 * 60 * 1000) return 'FRESH';
  if (ageMs <= 45 * 60 * 1000) return 'STALE';
  return 'UNKNOWN';
};

export const MonitoringSignalsConnector: AlertSignalsConnector = {
  id: 'monitoring-events',
  supportsCategory(category) {
    if (!category) return true;
    const normalized = String(category).trim().toLowerCase();
    return normalized !== 'pandemic' && normalized !== 'epidemic';
  },
  async fetchSignals(context) {
    const { latitude, longitude, category } = context;
    const safeLatitude = Number(latitude);
    const safeLongitude = Number(longitude);
    if (!Number.isFinite(safeLatitude) || !Number.isFinite(safeLongitude)) {
      return [];
    }
    const monitoring = await MonitoringService.getActiveEvents(
      safeLatitude,
      safeLongitude,
      0.55,
    );
    const targetCategory = String(category || '').trim().toLowerCase();
    const rows = Array.isArray(monitoring?.alerts) ? monitoring.alerts : [];

    const signals: AlertSignal[] = [];
    rows.forEach((alert, index) => {
      const categoryId = mapAlertToCategory(alert);
      if (targetCategory && targetCategory !== categoryId) return;
      const coord = extractAlertCoordinate(alert as any);
      if (!coord) return;
      const severity = severityFromAlert(alert as any);
      const timestamp = normalizeToIsoDateTime(alert.timestamp) || new Date().toISOString();
      const sourceName = String(alert.sourceName || '').trim() || 'Alert Aggregated Feed';
      const signalId =
        String(alert.id || '').trim() ||
        `monitoring-${categoryId || 'event'}-${timestamp}-${index}`;

      signals.push({
        id: signalId,
        category: categoryId || targetCategory || 'other',
        severity,
        geometry: {
          type: 'Point',
          coordinates: [coord.longitude, coord.latitude],
        },
        timestamp,
        sourceName,
        sourceUrl: typeof alert.sourceUrl === 'string' ? alert.sourceUrl : undefined,
        confidence: confidenceBySeverity[severity],
        officiality: 'VERIFIED',
        freshness: freshnessFromTimestamp(timestamp),
        summary: typeof alert.summary === 'string' ? alert.summary : undefined,
      });
    });

    return signals;
  },
};

export default MonitoringSignalsConnector;
