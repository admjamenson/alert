import { SupportFaqEntry } from '../../domain/support/SupportAssistant';

const FAQ_ENTRIES: SupportFaqEntry[] = [
  {
    id: 'notifications',
    keywords: ['notificacao', 'notificacoes', 'notification', 'notifications'],
    responseKey: 'support_faq_notifications',
  },
  {
    id: 'settings',
    keywords: ['configuracoes', 'configuracao', 'settings', 'preferencias'],
    responseKey: 'support_faq_settings',
  },
  {
    id: 'subscription',
    keywords: ['assinatura', 'plano', 'premium', 'subscription', 'plan'],
    responseKey: 'support_faq_subscription',
  },
  {
    id: 'billing',
    keywords: ['cobranca', 'pagamento', 'billing', 'charge', 'fatura'],
    responseKey: 'support_faq_billing',
  },
  {
    id: 'widgets',
    keywords: ['widget', 'widgets'],
    responseKey: 'support_faq_widgets',
  },
  {
    id: 'language',
    keywords: ['idioma', 'language', 'lingua'],
    responseKey: 'support_faq_language',
  },
  {
    id: 'update',
    keywords: ['atualizar', 'atualizacao', 'update', 'atualização'],
    responseKey: 'support_faq_update',
  },
  {
    id: 'permissions',
    keywords: ['permissao', 'permissao de localizacao', 'permissions', 'permissao de notificacao'],
    responseKey: 'support_faq_permissions',
  },
  {
    id: 'compatibility',
    keywords: ['compatibilidade', 'dispositivo', 'device', 'android', 'ios'],
    responseKey: 'support_faq_compatibility',
  },
];

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const LocalSupportFaqRepository = {
  findMatch(question: string): SupportFaqEntry | null {
    const normalized = normalizeText(question);
    if (!normalized) return null;
    return (
      FAQ_ENTRIES.find(entry =>
        entry.keywords.some(keyword => normalized.includes(keyword)),
      ) || null
    );
  },
};
