import { AlertNotification } from '../types/notifications';
import { EventHubService } from './EventHubService';
import { SosPrivacyService } from './SosPrivacyService';
import { MONITORING_EVENTS } from '../constants/MonitoringEvents';

const mapAlertToEventId = (title: string, summary?: string) => {
  const text = `${title} ${summary || ''}`.toLowerCase();
  if (text.includes('terremoto') || text.includes('sismo')) return 'earthquake';
  if (text.includes('furac') || text.includes('ciclone')) return 'hurricane';
  if (text.includes('tornado')) return 'tornado';
  if (text.includes('vendaval') || text.includes('vento')) return 'gale';
  if (text.includes('tempest')) return 'storm';
  if (text.includes('chuva') || text.includes('alag') || text.includes('inund'))
    return 'flood';
  if (text.includes('desliz')) return 'landslide';
  if (text.includes('granizo')) return 'hail';
  if (text.includes('calor')) return 'heatwave';
  if (text.includes('neblina')) return 'fog';
  if (text.includes('incend') || text.includes('incênd')) return 'wildfire';
  if (text.includes('maremoto') || text.includes('tsunami')) return 'tsunami';
  if (text.includes('neve') || text.includes('nevasca')) return 'snowstorm';
  if (text.includes('raio')) return 'lightning';
  return null;
};

const mapAlertToEventIdWithData = (alert: AlertNotification) => {
  const data = alert?.data as Record<string, any> | undefined;
  const fromHub = typeof data?.eventType === 'string' ? data.eventType.trim().toLowerCase() : '';
  if (fromHub.length > 0) return fromHub;
  return mapAlertToEventId(String(alert.title || ''), alert.summary);
};

const expandUnavailableTypeAliases = (eventType: string): string[] => {
  const normalized = String(eventType || '').trim().toLowerCase();
  if (!normalized) return [];
  if (normalized === 'cyclone' || normalized === 'hurricane') {
    return ['cyclone', 'hurricane'];
  }
  if (
    normalized === 'wind' ||
    normalized === 'gale' ||
    normalized === 'wind_gust_10' ||
    normalized === 'wind_gust_50'
  ) {
    return ['wind', 'gale', 'wind_gust_10', 'wind_gust_50'];
  }
  if (normalized === 'heatwave' || normalized === 'heat') {
    return ['heatwave', 'heat'];
  }
  return [normalized];
};

const computeUnavailableTypes = (
  providers: Array<{
    ok?: boolean;
    status?: string;
    supportedEventTypes?: string[];
  }>,
) => {
  const statusByType = new Map<string, { anyProvider: boolean; anyOnline: boolean }>();
  providers.forEach(provider => {
    const eventTypes = Array.isArray(provider?.supportedEventTypes)
      ? provider.supportedEventTypes
      : [];
    const online = provider?.ok === true && String(provider?.status || '').toLowerCase() === 'online';
    eventTypes.forEach(type => {
      expandUnavailableTypeAliases(type).forEach(alias => {
        const row = statusByType.get(alias) || { anyProvider: false, anyOnline: false };
        row.anyProvider = true;
        row.anyOnline = row.anyOnline || online;
        statusByType.set(alias, row);
      });
    });
  });

  const unavailable = new Set<string>();
  statusByType.forEach((value, type) => {
    if (value.anyProvider && !value.anyOnline) {
      unavailable.add(type);
    }
  });
  return unavailable;
};

const ALL_MONITORING_TYPE_IDS = Array.from(
  new Set(
    MONITORING_EVENTS.flatMap(event => expandUnavailableTypeAliases(event.id)),
  ),
);

export const MonitoringService = {
  async getActiveEvents(
    lat: number,
    lon: number,
    riskScore: number,
  ): Promise<{
    activeIds: Set<string>;
    summaries: Record<string, string>;
    alerts: AlertNotification[];
    unavailableIds: Set<string>;
    sourceMetaByEventId: Record<
      string,
      {
        sourceName?: string;
        officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
        confidence: number;
      }
    >;
  }> {
    const sosPublicOptIn = await SosPrivacyService.isPublicOptInEnabled().catch(
      () => false,
    );
    const hubResult = await EventHubService.getEventsByLocation({
      latitude: lat,
      longitude: lon,
      radiusKm: 40,
      limit: 180,
      sosPublicOptIn,
    }).catch(() => ({
      alerts: [] as AlertNotification[],
      providers: [] as Array<any>,
      meta: {
        failClosed: true,
        hubAvailable: false,
      },
    }));

    const hubUnavailable = hubResult?.meta?.hubAvailable === false;
    const providers = Array.isArray(hubResult?.providers) ? hubResult.providers : [];
    const providerCoverageMissing = providers.length === 0;

    const unavailableIds =
      hubUnavailable || providerCoverageMissing
        ? new Set(ALL_MONITORING_TYPE_IDS)
        : computeUnavailableTypes(providers);

    // Fail-closed: never invent risk from non-official fallback providers.
    const alerts = Array.isArray(hubResult?.alerts) ? hubResult.alerts : [];
    const activeIds = new Set<string>();
    const summaries: Record<string, string> = {};
    const sourceMetaByEventId: Record<
      string,
      {
        sourceName?: string;
        officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
        confidence: number;
      }
    > = {};

    alerts.forEach(alert => {
      const id = mapAlertToEventIdWithData(alert);
      if (!id) return;
      activeIds.add(id);
      if (!summaries[id]) {
        summaries[id] = String(alert.title || id);
      }

      const trustTier = String((alert?.data as any)?.trustTier || '').toUpperCase();
      const officiality =
        trustTier === 'A'
          ? 'OFFICIAL'
          : trustTier === 'B'
            ? 'VERIFIED'
            : 'REFERENCE';
      const severityText = String((alert?.data as any)?.severity || '').toLowerCase();
      const confidence =
        severityText.includes('critical') || severityText.includes('high')
          ? 0.84
          : severityText.includes('medium')
            ? 0.72
            : 0.62;
      sourceMetaByEventId[id] = {
        sourceName: alert.sourceName,
        officiality,
        confidence,
      };
    });

    return { activeIds, summaries, alerts, unavailableIds, sourceMetaByEventId };
  },
};
