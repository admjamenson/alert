import { GetEpidemicFeedQuery } from './GetEpidemicFeedQuery';
import { MonitoringService } from '../../services/MonitoringService';

export const GetMonitoringScreenSnapshotQuery = {
  async execute(params: {
    latitude: number | null;
    longitude: number | null;
    riskScore: number;
  }) {
    if (
      typeof params.latitude !== 'number' ||
      !Number.isFinite(params.latitude) ||
      typeof params.longitude !== 'number' ||
      !Number.isFinite(params.longitude)
    ) {
      return {
        activeIds: new Set<string>(),
        unavailableIds: new Set<string>(),
        summaries: {} as Record<string, string>,
        sourceMetaByEventId: {} as Record<
          string,
          {
            sourceName?: string;
            officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
            confidence: number;
          }
        >,
        pandemicSnapshot: null,
        epidemicSnapshot: null,
      };
    }

    const [monitoring, pandemicSnapshot, epidemicSnapshot] = await Promise.all([
      MonitoringService.getActiveEvents(
        params.latitude,
        params.longitude,
        params.riskScore,
      ).catch(() => null),
      GetEpidemicFeedQuery.execute({
        latitude: params.latitude,
        longitude: params.longitude,
        mode: 'pandemic',
        window: '7d',
      }).catch(() => null),
      GetEpidemicFeedQuery.execute({
        latitude: params.latitude,
        longitude: params.longitude,
        mode: 'epidemic',
        window: '7d',
      }).catch(() => null),
    ]);

    return {
      activeIds: monitoring?.activeIds || new Set<string>(),
      unavailableIds: monitoring?.unavailableIds || new Set<string>(),
      summaries: monitoring?.summaries || {},
      sourceMetaByEventId: monitoring?.sourceMetaByEventId || {},
      pandemicSnapshot,
      epidemicSnapshot,
    };
  },
};
