import i18n from '../../i18n';
import {
  AlertAssistantIntent,
  AlertAssistantReplyReadModel,
} from '../../domain/trust/AlertAssistant';
import { GetAlertBrainBriefingQuery } from './GetAlertBrainBriefingQuery';

type ExecuteParams = {
  question: string;
  locale: string;
  timeZone?: string;
  latitude?: number | null;
  longitude?: number | null;
  force?: boolean;
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const hasAny = (text: string, terms: string[]) => terms.some(term => text.includes(term));

const resolveIntent = (question: string): AlertAssistantIntent | 'scope' => {
  const normalized = normalizeText(question);

  if (hasAny(normalized, ['widget', 'widgets', 'fita', 'status local', 'rota widget'])) {
    return 'widgets';
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
    return 'route';
  }
  if (hasAny(normalized, ['sos', 'emergencia', 'panic', 'panico', 'emergency'])) {
    return 'sos';
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
    return 'sources';
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
    return 'privacy';
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
    ])
  ) {
    return 'monitoring';
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
    return 'safety';
  }
  return 'scope';
};

const buildSuggestedPrompts = (t: (key: string) => string) => [
  t('assistant_prompt_area'),
  t('assistant_prompt_widgets'),
  t('assistant_prompt_route'),
  t('assistant_prompt_sos'),
  t('assistant_prompt_sources'),
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

    if (intent === 'safety') {
      if (params.latitude == null || params.longitude == null || !briefing.operational.snapshot) {
        return {
          intent,
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
        intent,
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

    if (intent === 'widgets') {
      return {
        intent,
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

    if (intent === 'route') {
      return {
        intent,
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

    if (intent === 'sos') {
      return {
        intent,
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

    if (intent === 'sources') {
      return {
        intent,
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

    if (intent === 'privacy') {
      return {
        intent,
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

    if (intent === 'monitoring') {
      return {
        intent,
        title: t('assistant_monitoring_title'),
        body: t('assistant_monitoring_body'),
        bullets: [
          t('assistant_monitoring_bullet_satellite'),
          t('assistant_monitoring_bullet_sources'),
          t('assistant_monitoring_bullet_map'),
        ],
        sources,
        trustLabel,
        updatedLabel,
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
