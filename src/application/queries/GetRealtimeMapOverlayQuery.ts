import { MonitoringService } from '../../services/MonitoringService';
import { RiskHeatmap, RiskReportService } from '../../services/RiskReportService';
import { mapAlertToCategory } from '../../services/importantAlertUtils';

export const GetRealtimeMapOverlayQuery = {
  async execute(params: {
    categoryId: string;
    latitude: number | null;
    longitude: number | null;
    contextOnly?: boolean;
    updatedAtOverride?: string | null;
  }): Promise<{
    heatmap: RiskHeatmap;
    activeIds: Set<string>;
    summaries: Record<string, string>;
    sourceNames: string[];
    updatedAt: string | null;
  }> {
    if (
      typeof params.latitude !== 'number' ||
      !Number.isFinite(params.latitude) ||
      typeof params.longitude !== 'number' ||
      !Number.isFinite(params.longitude)
    ) {
      return {
        heatmap: { type: 'FeatureCollection', features: [] },
        activeIds: new Set<string>(),
        summaries: {},
        sourceNames: [],
        updatedAt: null,
      };
    }

    if (params.contextOnly) {
      return {
        heatmap: { type: 'FeatureCollection', features: [] },
        activeIds: new Set<string>(),
        summaries: {},
        sourceNames: [],
        updatedAt: params.updatedAtOverride || new Date().toISOString(),
      };
    }

    const [heatmap, monitoring] = await Promise.all([
      RiskReportService.getHeatmap(
        { latitude: params.latitude, longitude: params.longitude },
        {
          radiusMeters: 4000,
          cellSizeMeters: 220,
        },
      ),
      MonitoringService.getActiveEvents(params.latitude, params.longitude, 0.45),
    ]);

    const categoryAlerts = monitoring.alerts.filter(
      alert => mapAlertToCategory(alert) === params.categoryId,
    );

    return {
      heatmap,
      activeIds: new Set(monitoring.activeIds),
      summaries: monitoring.summaries,
      sourceNames: Array.from(
        new Set(
          categoryAlerts
            .map(alert => String(alert.sourceName || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 3),
      updatedAt: new Date().toISOString(),
    };
  },
};
