type SupportScopeResult = {
  allowed: boolean;
  reason?: 'sensitive' | 'human' | 'unknown';
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const includesAny = (text: string, terms: string[]) =>
  terms.some(term => text.includes(term));

const SENSITIVE_TERMS = [
  'senha',
  'password',
  'token',
  'codigo',
  'codigo de verificacao',
  'código de verificacao',
  '2fa',
  'autenticacao',
  'auth',
  'login',
  'credencial',
  'dados privados',
  'dados pessoais',
  'localizacao precisa',
  'localizacao',
  'histórico',
  'historico',
  'sos',
  'emergencia',
  'emergency',
  'crime',
  'policia',
  'medical',
  'medico',
  'legal',
  'fraude',
  'antifraude',
  'anti-fraude',
  'score',
  'risco interno',
  'arquitetura',
  'logs internos',
  'infraestrutura',
  'segredo',
  'confidencial',
];

const HUMAN_TERMS = [
  'falar com humano',
  'falar com pessoa',
  'falar com equipe',
  'atendente',
  'suporte humano',
  'email',
  'e-mail',
  'contato',
  'assistencia',
  'assistência',
];

export const SupportPolicy = {
  evaluate(question: string): SupportScopeResult {
    const normalized = normalizeText(question);
    if (!normalized) return { allowed: false, reason: 'unknown' };
    if (includesAny(normalized, SENSITIVE_TERMS)) {
      return { allowed: false, reason: 'sensitive' };
    }
    if (includesAny(normalized, HUMAN_TERMS)) {
      return { allowed: false, reason: 'human' };
    }
    return { allowed: true };
  },
};
