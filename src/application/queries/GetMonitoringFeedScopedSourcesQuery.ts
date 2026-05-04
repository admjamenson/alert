import {
  mapMonitoringEventToDomain,
  OfficialSourcesResolver,
} from '../../services/OfficialSourcesResolver';
import { AdminContextService } from '../../services/AdminContextService';

export const GetMonitoringFeedScopedSourcesQuery = {
  async execute(params: {
    latitude: number | null;
    longitude: number | null;
    locale: string;
    monitoringType: string;
    targetLevel: 'MUNICIPAL' | 'STATE' | 'COUNTRY';
    force?: boolean;
  }): Promise<{
    sources: Array<{
      name: string;
      url?: string;
      officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
    }>;
    fallbackApplied: boolean;
    freshestAt?: string;
  }> {
    if (
      typeof params.latitude !== 'number' ||
      !Number.isFinite(params.latitude) ||
      typeof params.longitude !== 'number' ||
      !Number.isFinite(params.longitude)
    ) {
      return { sources: [], fallbackApplied: true, freshestAt: undefined };
    }

    try {
      const context = await AdminContextService.resolveFromLocation(
        params.latitude,
        params.longitude,
        {
          forceRefresh: params.force,
          locale: params.locale,
        },
      );

      if (!context) {
        return { sources: [], fallbackApplied: true, freshestAt: undefined };
      }

      const monitoringDomain = mapMonitoringEventToDomain(params.monitoringType);
      const resolved = await OfficialSourcesResolver.resolveOfficialSources(context, [
        monitoringDomain as any,
      ]);
      const scopedLevel =
        resolved.levels.find(level => level.level === params.targetLevel) ||
        resolved.levels[resolved.levels.length - 1];

      if (!scopedLevel) {
        return { sources: [], fallbackApplied: true, freshestAt: undefined };
      }

      const domainSources = scopedLevel.sources.filter(
        source => source.monitoringDomain === monitoringDomain,
      );
      const chosen = (domainSources.length > 0 ? domainSources : scopedLevel.sources).slice(0, 3);

      return {
        sources: chosen.map(source => ({
          name: String(source.name || '').trim(),
          url: typeof source.url === 'string' ? source.url : undefined,
          officiality:
            source.officiality === 'OFFICIAL'
              ? 'OFFICIAL'
              : scopedLevel.fallbackApplied || domainSources.length === 0
                ? 'REFERENCE'
                : 'VERIFIED',
        })),
        fallbackApplied: Boolean(scopedLevel.fallbackApplied || domainSources.length === 0),
        freshestAt: scopedLevel.freshestAt || undefined,
      };
    } catch {
      return { sources: [], fallbackApplied: true, freshestAt: undefined };
    }
  },
};
