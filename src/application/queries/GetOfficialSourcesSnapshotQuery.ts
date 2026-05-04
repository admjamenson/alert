import AsyncStorage from '@react-native-async-storage/async-storage';

import { FEATURED_EVENTS_KEY } from '../../constants/MonitoringEvents';
import { AdminContextService } from '../../services/AdminContextService';
import {
  OfficialSourcesResolver,
  resolveDomainsFromEventIds,
} from '../../services/OfficialSourcesResolver';
import {
  MonitoringDomain,
  ResolvedSourcesByLevel,
} from '../../types/officialSources';

const DEFAULT_DOMAINS: MonitoringDomain[] = [
  'HEALTH',
  'WEATHER',
  'DISASTER',
  'INFRA',
  'SECURITY',
];

const normalizeFeaturedEvents = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
};

const loadMonitoringDomains = async (): Promise<MonitoringDomain[]> => {
  try {
    const raw = await AsyncStorage.getItem(FEATURED_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const eventIds = normalizeFeaturedEvents(parsed);
    const domains = resolveDomainsFromEventIds(eventIds);
    return domains.length > 0 ? domains : DEFAULT_DOMAINS;
  } catch {
    return DEFAULT_DOMAINS;
  }
};

export const GetOfficialSourcesSnapshotQuery = {
  async execute(params: {
    latitude?: number | null;
    longitude?: number | null;
    locale?: string;
    forceRefresh?: boolean;
  }): Promise<{
    resolved: ResolvedSourcesByLevel | null;
    errorCode?: 'official_sources_context_unavailable' | 'official_sources_load_error';
  }> {
    try {
      const [domains, context] = await Promise.all([
        loadMonitoringDomains(),
        typeof params.latitude === 'number' && typeof params.longitude === 'number'
          ? AdminContextService.resolveFromLocation(params.latitude, params.longitude, {
              forceRefresh: params.forceRefresh,
              locale: params.locale,
            })
          : AdminContextService.getCachedContext(),
      ]);

      if (!context) {
        return {
          resolved: null,
          errorCode: 'official_sources_context_unavailable',
        };
      }

      const resolved = await OfficialSourcesResolver.resolveOfficialSources(
        context,
        domains,
      );
      return { resolved };
    } catch {
      return {
        resolved: null,
        errorCode: 'official_sources_load_error',
      };
    }
  },
};
