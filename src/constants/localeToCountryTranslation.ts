export type CountryTranslationCode =
  | 'common'
  | 'cym'
  | 'deu'
  | 'fra'
  | 'hrv'
  | 'ita'
  | 'jpn'
  | 'nld'
  | 'por'
  | 'rus'
  | 'spa'
  | 'svk'
  | 'fin'
  | 'zho'
  | 'isr';

const localeMap: Record<string, CountryTranslationCode> = {
  pt: 'por',
  en: 'common',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  nl: 'nld',
  ja: 'jpn',
  zh: 'zho',
  ru: 'rus',
  fi: 'fin',
  sk: 'svk',
  hr: 'hrv',
  cy: 'cym',
  he: 'isr',
};

export const resolveCountryTranslation = (
  localeTag: string | null | undefined,
): CountryTranslationCode => {
  const normalized = String(localeTag || '').trim().toLowerCase();
  if (!normalized) return 'common';

  const lang = normalized.split('-')[0];
  return localeMap[lang] || 'common';
};

