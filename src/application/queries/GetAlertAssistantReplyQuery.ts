import i18n from '../../i18n';
import {
  AlertAssistantIntent,
  AlertAssistantReplyReadModel,
} from '../../domain/trust/AlertAssistant';
import { GetAlertBrainBriefingQuery } from './GetAlertBrainBriefingQuery';
import { MONITORING_EVENTS } from '../../constants/MonitoringEvents';

type ExecuteParams = {
  question: string;
  locale: string;
  timeZone?: string;
  latitude?: number;
  longitude?: number;
  force?: boolean;
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const hasAny = (text: string, terms: string[]) => terms.some(term => text.includes(term));

type IntentBase = Exclude<AlertAssistantIntent, 'event_detail'>;

type ResolvedIntent =
  | { type: IntentBase }
  | { type: 'event_detail'; category: string };

const EVENT_KEYWORDS: Array<{ id: string; terms: string[] }> = [
  { id: 'earthquake', terms: ['earthquake', 'terremoto', 'sismo'] },
  { id: 'tsunami', terms: ['tsunami', 'maremoto'] },
  { id: 'epidemic', terms: ['epidemia', 'epidemic'] },
  { id: 'pandemic', terms: ['pandemia', 'pandemic'] },
  { id: 'energy_outage', terms: ['energia', 'apagao', 'apagão', 'queda de energia', 'energia eletrica'] },
  { id: 'water_outage', terms: ['falta de agua', 'falta de água', 'water outage', 'agua'] },
  { id: 'heat', terms: ['calor', 'heat'] },
  { id: 'heatwave', terms: ['onda de calor', 'heatwave'] },
  { id: 'wind', terms: ['vento', 'wind', 'vendaval'] },
  { id: 'wind_gust_10', terms: ['rajada 10', 'rajada 10km', 'wind gust 10'] },
  { id: 'wind_gust_50', terms: ['rajada 50', 'rajada 50km', 'wind gust 50'] },
  { id: 'storm', terms: ['tempestade', 'storm'] },
  { id: 'lightning', terms: ['raio', 'raios', 'lightning'] },
  { id: 'cyclone', terms: ['ciclone', 'cyclone'] },
  { id: 'tornado', terms: ['tornado'] },
  { id: 'hurricane', terms: ['furacao', 'furacão', 'hurricane'] },
  { id: 'landslide', terms: ['deslizamento', 'landslide'] },
  { id: 'snowstorm', terms: ['nevasca', 'snowstorm'] },
  { id: 'wildfire', terms: ['incendio florestal', 'incêndio florestal', 'wildfire'] },
  { id: 'hail', terms: ['granizo', 'hail'] },
  { id: 'meteor', terms: ['meteoro', 'meteor'] },
  { id: 'fog', terms: ['neblina', 'fog'] },
  { id: 'drought', terms: ['seca', 'seca extrema', 'drought'] },
  { id: 'gale', terms: ['vendaval', 'gale'] },
  { id: 'volcano', terms: ['vulcao', 'vulcão', 'volcano'] },
  { id: 'high_tide', terms: ['mare alta', 'maré alta', 'high tide'] },
  { id: 'sandstorm', terms: ['tempestade de areia', 'sandstorm'] },
  { id: 'downdraft', terms: ['downdraft', 'corrente descendente'] },
  { id: 'volcanic_cloud', terms: ['nuvem de vulcao', 'nuvem de vulcão', 'volcanic cloud'] },
  { id: 'rogue_waves', terms: ['rogue waves', 'onda rogue', 'onda gigante'] },
  { id: 'dust_devils', terms: ['redemoinho de poeira', 'dust devil'] },
];

const resolveEventCategory = (normalized: string): string | null => {
  for (const entry of EVENT_KEYWORDS) {
    if (hasAny(normalized, entry.terms)) return entry.id;
  }
  return null;
};

const resolveIntent = (question: string): ResolvedIntent | 'scope' => {
  const normalized = normalizeText(question);
  const eventCategory = resolveEventCategory(normalized);
  if (eventCategory) {
    return { type: 'event_detail', category: eventCategory };
  }

  if (hasAny(normalized, ['widget', 'widgets', 'fita', 'status local', 'rota widget'])) {
    return { type: 'widgets' };
  }
  if (
    hasAny(normalized, [
      'rota',
      'trajeto',
      'eta',
      'destino',
      'route',
      'carro',
      'onibus',
      'moto',
      'bike',
      'a pe',
      'walk',
      'bus',
    ])
  ) {
    return { type: 'route' };
  }
  if (hasAny(normalized, ['sos', 'emergencia', 'panic', 'panico', 'emergency'])) {
    return { type: 'sos' };
  }
  if (
    hasAny(normalized, [
      'fonte',
      'fontes',
      'source',
      'sources',
      'oficial',
      'verificado',
      'verified',
      'confianca',
      'confidence',
      'freshness',
      'atualizado',
    ])
  ) {
    return { type: 'sources' };
  }
  if (
    hasAny(normalized, [
      'privacidade',
      'privacy',
      'dados',
      'data',
      'localizacao',
      'localização',
      'token',
      'pii',
    ])
  ) {
    return { type: 'privacy' };
  }
  if (
    hasAny(normalized, [
      'mapa',
      'map',
      'satelite',
      'satellite',
      'monitoramento',
      'monitoring',
      'camada',
      'layer',
      'alerta',
      'alertas',
      'clima',
      'tempo',
      'weather',
    ])
  ) {
    return { type: 'monitoring' };
  }
  if (
    hasAny(normalized, [
      'risco',
      'status',
      'area',
      'perto',
      'agora',
      'alerta',
      'alertas',
      'seguro',
      'minha area',
      'my area',
      'safety',
    ])
  ) {
    return { type: 'safety' };
  }
  return 'scope';
};

const buildSuggestedPrompts = (t: (key: string) => string) => [
  t('assistant_prompt_area'),
  t('assistant_prompt_widgets'),
  t('assistant_prompt_route'),
  t('assistant_prompt_sos'),
  t('assistant_prompt_sources'),
  t('assistant_prompt_monitoring'),
];

const trustKeyByStatus = {
  online: 'assistant_trust_online',
  stale: 'assistant_trust_stale',
  offline: 'assistant_trust_offline',
  unavailable: 'assistant_trust_unavailable',
} as const;

const riskKeyByLevel = {
  high: 'assistant_risk_high',
  medium: 'assistant_risk_medium',
  low: 'assistant_risk_low',
} as const;

const formatUpdatedLabel = (
  updatedAt: string | undefined,
  locale: string,
  timeZone: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (!updatedAt) return undefined;
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      timeZone: timeZone || 'UTC',
    }).format(new Date(updatedAt));
    return t('assistant_reply_updated_label', { value: formatted });
  } catch {
    return undefined;
  }
};

export const GetAlertAssistantReplyQuery = {
  async execute(params: ExecuteParams): Promise<AlertAssistantReplyReadModel> {
    const t = i18n.getFixedT(params.locale);
    const briefing = await GetAlertBrainBriefingQuery.execute({
      latitude: params.latitude,
      longitude: params.longitude,
      locale: params.locale,
      timeZone: params.timeZone,
      force: params.force,
    });
    const intent = resolveIntent(params.question);
    const sources = briefing.sources.slice(0, 3).map(source => ({
      name: source.name,
      url: source.url,
    }));
    const suggestedPrompts = buildSuggestedPrompts(t);
    const trustLabel = t(trustKeyByStatus[briefing.trustStatus]);
    const updatedLabel = formatUpdatedLabel(
      briefing.updatedAt,
      params.locale,
      params.timeZone,
      t,
    );
    const riskLevel = briefing.operational.snapshot?.riskLevel;
    const riskLabel = riskLevel ? t(riskKeyByLevel[riskLevel]) : t('assistant_risk_unknown');
    const signalCountLabel = t('assistant_reply_signal_count', {
      count: briefing.signalCount,
    });
    const sourceCountLabel = t('assistant_reply_source_count', {
      count: briefing.sourceCount,
    });

    if (intent === 'scope') {
      return {
        intent: 'general',
        title: t('assistant_scope_title'),
        body: t('assistant_scope_body'),
        bullets: [
          t('assistant_scope_bullet_area'),
          t('assistant_scope_bullet_sources'),
          t('assistant_scope_bullet_route'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'safety') {
      if (params.latitude === undefined || params.longitude === undefined || !briefing.operational.snapshot) {
        return {
          intent: 'safety',
          title: t('assistant_safety_title'),
          body: t('assistant_safety_no_location_body'),
          bullets: [t('assistant_safety_no_location_bullet')],
          sources: [],
          trustLabel,
          updatedLabel,
          suggestedPrompts,
        };
      }
      return {
        intent: 'safety',
        title: t('assistant_safety_title'),
        body: t('assistant_safety_body', {
          risk: riskLabel,
          summary:
            briefing.headline || briefing.summary || t('assistant_safety_summary_empty'),
        }),
        bullets: [
          signalCountLabel,
          sourceCountLabel,
          briefing.action || t('assistant_safety_action_empty'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'widgets') {
      return {
        intent: 'widgets',
        title: t('assistant_widgets_title'),
        body: t('assistant_widgets_body'),
        bullets: [
          t('assistant_widgets_bullet_status'),
          t('assistant_widgets_bullet_route'),
          t('assistant_widgets_bullet_local'),
          t('assistant_widgets_bullet_ticker'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'route') {
      return {
        intent: 'route',
        title: t('assistant_route_title'),
        body: t('assistant_route_body'),
        bullets: [
          t('assistant_route_bullet_modal'),
          t('assistant_route_bullet_eta'),
          t('assistant_route_bullet_risk'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'sos') {
      return {
        intent: 'sos',
        title: t('assistant_sos_title'),
        body: t('assistant_sos_body'),
        bullets: [
          t('assistant_sos_bullet_guardians'),
          t('assistant_sos_bullet_location'),
          t('assistant_sos_bullet_fail_soft'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'sources') {
      return {
        intent: 'sources',
        title: t('assistant_sources_title'),
        body: t('assistant_sources_body', { trust: trustLabel }),
        bullets: [
          sourceCountLabel,
          updatedLabel || t('assistant_reply_updated_unknown'),
          t('assistant_sources_bullet_confidence'),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'privacy') {
      return {
        intent: 'privacy',
        title: t('assistant_privacy_title'),
        body: t('assistant_privacy_body'),
        bullets: [
          t('assistant_privacy_bullet_minimization'),
          t('assistant_privacy_bullet_client'),
          t('assistant_privacy_bullet_sensitive'),
        ],
        sources: [],
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'monitoring') {
      const snapshot = briefing.operational.snapshot;
      const eventLabels = MONITORING_EVENTS.map(event =>
        t(`monitoring_event_${event.id}`),
      ).filter(Boolean);
      const listSample = eventLabels.slice(0, 10).join(', ');
      const snapshotLabel = snapshot
        ? t('assistant_monitoring_snapshot', {
            active: snapshot.activeSituationCount,
            monitored: snapshot.monitoredSituationCount,
          })
        : t('assistant_monitoring_snapshot_unavailable');
      return {
        intent: 'monitoring',
        title: t('assistant_monitoring_overview_title'),
        body: t('assistant_monitoring_overview_body', {
          summary: briefing.summary || briefing.headline || t('assistant_safety_summary_empty'),
          risk: riskLabel,
        }),
        bullets: [
          snapshotLabel,
          signalCountLabel,
          sourceCountLabel,
          t('assistant_monitoring_events_list', { list: listSample }),
        ],
        sources,
        trustLabel,
        updatedLabel,
        suggestedPrompts,
      };
    }

    if (intent.type === 'event_detail') {
      const categoryBriefing = await GetAlertBrainBriefingQuery.execute({
        latitude: params.latitude,
        longitude: params.longitude,
        locale: params.locale,
        timeZone: params.timeZone,
        force: params.force,
        category: intent.category,
      });
      const eventLabel = t(`monitoring_event_${intent.category}`);
      const eventSummary =
        categoryBriefing.summary ||
        categoryBriefing.headline ||
        t('assistant_event_summary_empty', { event: eventLabel });
      const eventSignalCountLabel = t('assistant_reply_signal_count', {
        count: categoryBriefing.signalCount,
      });
      const eventSourceCountLabel = t('assistant_reply_source_count', {
        count: categoryBriefing.sourceCount,
      });
      const eventTrustLabel = t(trustKeyByStatus[categoryBriefing.trustStatus]);
      const eventUpdatedLabel = formatUpdatedLabel(
        categoryBriefing.updatedAt,
        params.locale,
        params.timeZone,
        t,
      );
      const eventSources = categoryBriefing.sources.slice(0, 3).map(source => ({
        name: source.name,
        url: source.url,
      }));

      return {
        intent: 'event_detail',
        title: t('assistant_event_title', { event: eventLabel }),
        body: t('assistant_event_body', {
          event: eventLabel,
          summary: eventSummary,
        }),
        bullets: [
          eventSignalCountLabel,
          eventSourceCountLabel,
          categoryBriefing.action || t('assistant_event_action_empty', { event: eventLabel }),
        ],
        sources: eventSources,
        trustLabel: eventTrustLabel,
        updatedLabel: eventUpdatedLabel,
        suggestedPrompts,
      };
    }

    return {
      intent: 'general',
      title: t('assistant_scope_title'),
      body: t('assistant_general_body', {
        risk: riskLabel,
        summary: briefing.headline || briefing.summary || t('assistant_safety_summary_empty'),
      }),
      bullets: [
        t('assistant_general_bullet_area'),
        t('assistant_general_bullet_sources'),
        t('assistant_general_bullet_route'),
      ],
      sources,
      trustLabel,
      updatedLabel,
      suggestedPrompts,
    };
  },
};
