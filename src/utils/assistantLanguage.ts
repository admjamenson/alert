import { resolveSupportedLocale } from '../constants/locales';

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const scoreTokens = (normalized: string, tokens: string[]) =>
  tokens.reduce((total, token) => total + (normalized.includes(token) ? 1 : 0), 0);

const detectScriptLocale = (text: string): string | null => {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU';
  return null;
};

const LATIN_HINTS: Array<{ locale: string; tokens: string[] }> = [
  {
    locale: 'pt-BR',
    tokens: [
      ' voce',
      ' você',
      ' minha ',
      ' meu ',
      ' rota',
      ' area',
      ' área',
      ' alerta',
      ' segur',
      ' socorro',
      ' mapa',
      ' clima',
      ' widget',
      ' onde',
      ' preciso',
      ' quero',
    ],
  },
  {
    locale: 'es-ES',
    tokens: [
      ' usted',
      ' donde',
      ' dónde',
      ' ruta',
      ' alerta',
      ' seguridad',
      ' area',
      ' área',
      ' mapa',
      ' necesito',
      ' quiero',
      ' cerca',
      ' ahora',
    ],
  },
  {
    locale: 'fr-FR',
    tokens: [
      ' bonjour',
      ' securite',
      ' sécurité',
      ' risque',
      ' source',
      ' carte',
      ' alerte',
      ' zone',
      ' comment',
      ' ou ',
      ' où ',
    ],
  },
  {
    locale: 'de-DE',
    tokens: [
      ' hallo',
      ' sicher',
      ' risiko',
      ' quelle',
      ' karte',
      ' warn',
      ' route',
      ' bereich',
      ' jetzt',
      ' wie ',
      ' wo ',
    ],
  },
  {
    locale: 'en-US',
    tokens: [
      ' what',
      ' where',
      ' route',
      ' safety',
      ' alerts',
      ' widget',
      ' source',
      ' map',
      ' help',
      ' nearby',
      ' area',
      ' now',
    ],
  },
];

export const detectAssistantLocale = (
  input: string,
  fallbackLocale: string,
  preferredLocale?: string | null,
): string => {
  const explicit = preferredLocale ? resolveSupportedLocale(preferredLocale) : null;
  const scriptLocale = detectScriptLocale(input);
  if (scriptLocale) {
    return resolveSupportedLocale(scriptLocale);
  }

  const normalized = ` ${normalizeText(input)} `;
  const best = LATIN_HINTS.map(candidate => ({
    locale: candidate.locale,
    score: scoreTokens(normalized, candidate.tokens),
  })).sort((left, right) => right.score - left.score)[0];

  if (best && best.score > 0) {
    return resolveSupportedLocale(best.locale);
  }

  if (explicit) {
    return explicit;
  }

  return resolveSupportedLocale(fallbackLocale);
};
