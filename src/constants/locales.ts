const stripAccents = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const BASE_LOCALES = [
  {
    code: 'af-ZA',
    nativeName: 'Afrikaans (Suid-Afrika)',
    englishName: 'Afrikaans (South Africa)',
    shortLabel: 'AF',
    rtl: false,
  },
  {
    code: 'sq-AL',
    nativeName: 'Shqip (Shqiperi)',
    englishName: 'Albanian (Albania)',
    shortLabel: 'SQ',
    rtl: false,
  },
  {
    code: 'de-DE',
    nativeName: 'Deutsch (Deutschland)',
    englishName: 'German (Germany)',
    shortLabel: 'DE',
    rtl: false,
  },
  {
    code: 'am-ET',
    nativeName: '\u12a0\u121b\u122d\u129b (\u12a2\u1275\u12ee\u1335\u12eb)',
    englishName: 'Amharic (Ethiopia)',
    shortLabel: 'AM',
    rtl: false,
  },
  {
    code: 'ar-SA',
    nativeName:
      '\u0627\u0644\u0639\u0631\u0628\u064a\u0629 (\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629)',
    englishName: 'Arabic (Saudi Arabia)',
    shortLabel: 'AR',
    rtl: true,
  },
  {
    code: 'az-AZ',
    nativeName: 'Az\u0259rbaycan dili (Az\u0259rbaycan)',
    englishName: 'Azerbaijani (Azerbaijan)',
    shortLabel: 'AZ',
    rtl: false,
  },
  {
    code: 'bn-BD',
    nativeName:
      '\u09ac\u09be\u0982\u09b2\u09be (\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6)',
    englishName: 'Bengali (Bangladesh)',
    shortLabel: 'BN',
    rtl: false,
  },
  {
    code: 'bg-BG',
    nativeName:
      '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438 (\u0411\u044a\u043b\u0433\u0430\u0440\u0438\u044f)',
    englishName: 'Bulgarian (Bulgaria)',
    shortLabel: 'BG',
    rtl: false,
  },
  {
    code: 'kn-IN',
    nativeName: '\u0c95\u0ca8\u0ccd\u0ca8\u0ca1 (\u0cad\u0cbe\u0cb0\u0ca4)',
    englishName: 'Kannada (India)',
    shortLabel: 'KN',
    rtl: false,
  },
  {
    code: 'ca-ES',
    nativeName: 'Catala (Espanya)',
    englishName: 'Catalan (Spain)',
    shortLabel: 'CA',
    rtl: false,
  },
  {
    code: 'kk-KZ',
    nativeName:
      '\u049a\u0430\u0437\u0430\u049b \u0442\u0456\u043b\u0456 (\u049a\u0430\u0437\u0430\u049b\u0441\u0442\u0430\u043d)',
    englishName: 'Kazakh (Kazakhstan)',
    shortLabel: 'KK',
    rtl: false,
  },
  {
    code: 'cs-CZ',
    nativeName: 'Cestina (Cesko)',
    englishName: 'Czech (Czechia)',
    shortLabel: 'CS',
    rtl: false,
  },
  {
    code: 'zh-CN',
    nativeName:
      '\u4e2d\u6587\uff08\u7b80\u4f53\uff0c\u4e2d\u56fd\u5927\u9646\uff09',
    englishName: 'Chinese (Simplified)',
    shortLabel: 'ZH',
    rtl: false,
  },
  {
    code: 'zh-TW',
    nativeName: '\u4e2d\u6587\uff08\u7e41\u9ad4\uff0c\u53f0\u7063\uff09',
    englishName: 'Chinese (Traditional)',
    shortLabel: 'ZH',
    rtl: false,
  },
  {
    code: 'zh-HK',
    nativeName: '\u4e2d\u6587\uff08\u9999\u6e2f\uff09',
    englishName: 'Chinese (Hong Kong)',
    shortLabel: 'ZH',
    rtl: false,
  },
  {
    code: 'ko-KR',
    nativeName: '\ud55c\uad6d\uc5b4 (\ub300\ud55c\ubbfc\uad6d)',
    englishName: 'Korean (South Korea)',
    shortLabel: 'KO',
    rtl: false,
  },
  {
    code: 'hr-HR',
    nativeName: 'Hrvatski (Hrvatska)',
    englishName: 'Croatian (Croatia)',
    shortLabel: 'HR',
    rtl: false,
  },
  {
    code: 'da-DK',
    nativeName: 'Dansk (Danmark)',
    englishName: 'Danish (Denmark)',
    shortLabel: 'DA',
    rtl: false,
  },
  {
    code: 'sk-SK',
    nativeName: 'Slovencina (Slovensko)',
    englishName: 'Slovak (Slovakia)',
    shortLabel: 'SK',
    rtl: false,
  },
  {
    code: 'sl-SI',
    nativeName: 'Slovenscina (Slovenija)',
    englishName: 'Slovenian (Slovenia)',
    shortLabel: 'SL',
    rtl: false,
  },
  {
    code: 'es-ES',
    nativeName: 'Espanol (Espana)',
    englishName: 'Spanish (Spain)',
    shortLabel: 'ES',
    rtl: false,
  },
  {
    code: 'et-EE',
    nativeName: 'Eesti (Eesti)',
    englishName: 'Estonian (Estonia)',
    shortLabel: 'ET',
    rtl: false,
  },
  {
    code: 'fil-PH',
    nativeName: 'Filipino (Pilipinas)',
    englishName: 'Filipino (Philippines)',
    shortLabel: 'FIL',
    rtl: false,
  },
  {
    code: 'fi-FI',
    nativeName: 'Suomi (Suomi)',
    englishName: 'Finnish (Finland)',
    shortLabel: 'FI',
    rtl: false,
  },
  {
    code: 'fr-FR',
    nativeName: 'Francais (France)',
    englishName: 'French (France)',
    shortLabel: 'FR',
    rtl: false,
  },
  {
    code: 'el-GR',
    nativeName:
      '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac (\u0395\u03bb\u03bb\u03ac\u03b4\u03b1)',
    englishName: 'Greek (Greece)',
    shortLabel: 'EL',
    rtl: false,
  },
  {
    code: 'gu-IN',
    nativeName: '\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0 (\u0aad\u0abe\u0ab0\u0aa4)',
    englishName: 'Gujarati (India)',
    shortLabel: 'GU',
    rtl: false,
  },
  {
    code: 'he-IL',
    nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea (\u05d9\u05e9\u05e8\u05d0\u05dc)',
    englishName: 'Hebrew (Israel)',
    shortLabel: 'HE',
    rtl: true,
  },
  {
    code: 'hi-IN',
    nativeName: '\u0939\u093f\u0928\u094d\u0926\u0940 (\u092d\u093e\u0930\u0924)',
    englishName: 'Hindi (India)',
    shortLabel: 'HI',
    rtl: false,
  },
  {
    code: 'nl-NL',
    nativeName: 'Nederlands (Nederland)',
    englishName: 'Dutch (Netherlands)',
    shortLabel: 'NL',
    rtl: false,
  },
  {
    code: 'hu-HU',
    nativeName: 'Magyar (Magyarorszag)',
    englishName: 'Hungarian (Hungary)',
    shortLabel: 'HU',
    rtl: false,
  },
  {
    code: 'id-ID',
    nativeName: 'Bahasa Indonesia (Indonesia)',
    englishName: 'Indonesian (Indonesia)',
    shortLabel: 'ID',
    rtl: false,
  },
  {
    code: 'en-US',
    nativeName: 'English (United States)',
    englishName: 'English (United States)',
    shortLabel: 'EN',
    rtl: false,
  },
  {
    code: 'en-GB',
    nativeName: 'English (United Kingdom)',
    englishName: 'English (United Kingdom)',
    shortLabel: 'EN',
    rtl: false,
  },
  {
    code: 'ga-IE',
    nativeName: 'Gaeilge (Eire)',
    englishName: 'Irish (Ireland)',
    shortLabel: 'GA',
    rtl: false,
  },
  {
    code: 'it-IT',
    nativeName: 'Italiano (Italia)',
    englishName: 'Italian (Italy)',
    shortLabel: 'IT',
    rtl: false,
  },
  {
    code: 'ja-JP',
    nativeName: '\u65e5\u672c\u8a9e (\u65e5\u672c)',
    englishName: 'Japanese (Japan)',
    shortLabel: 'JA',
    rtl: false,
  },
  {
    code: 'lo-LA',
    nativeName: '\u0ea5\u0eb2\u0ea7 (\u0ea5\u0eb2\u0ea7)',
    englishName: 'Lao (Laos)',
    shortLabel: 'LO',
    rtl: false,
  },
  {
    code: 'lv-LV',
    nativeName: 'Latviesu (Latvija)',
    englishName: 'Latvian (Latvia)',
    shortLabel: 'LV',
    rtl: false,
  },
  {
    code: 'lt-LT',
    nativeName: 'Lietuviu (Lietuva)',
    englishName: 'Lithuanian (Lithuania)',
    shortLabel: 'LT',
    rtl: false,
  },
  {
    code: 'mk-MK',
    nativeName:
      '\u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0441\u043a\u0438 (\u0421\u0435\u0432\u0435\u0440\u043d\u0430 \u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0438\u0458\u0430)',
    englishName: 'Macedonian (North Macedonia)',
    shortLabel: 'MK',
    rtl: false,
  },
  {
    code: 'ml-IN',
    nativeName: '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02 (\u0d07\u0d28\u0d4d\u0d24\u0d4d\u0d2f)',
    englishName: 'Malayalam (India)',
    shortLabel: 'ML',
    rtl: false,
  },
  {
    code: 'ms-MY',
    nativeName: 'Bahasa Melayu (Malaysia)',
    englishName: 'Malay (Malaysia)',
    shortLabel: 'MS',
    rtl: false,
  },
  {
    code: 'mr-IN',
    nativeName: '\u092e\u0930\u093e\u0920\u0940 (\u092d\u093e\u0930\u0924)',
    englishName: 'Marathi (India)',
    shortLabel: 'MR',
    rtl: false,
  },
  {
    code: 'nb-NO',
    nativeName: 'Norsk Bokmal (Norge)',
    englishName: 'Norwegian Bokmal (Norway)',
    shortLabel: 'NB',
    rtl: false,
  },
  {
    code: 'pa-IN',
    nativeName: '\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40 (\u0a2d\u0a3e\u0a30\u0a24)',
    englishName: 'Punjabi (India)',
    shortLabel: 'PA',
    rtl: false,
  },
  {
    code: 'fa-IR',
    nativeName: '\u0641\u0627\u0631\u0633\u06cc (\u0627\u06cc\u0631\u0627\u0646)',
    englishName: 'Persian (Iran)',
    shortLabel: 'FA',
    rtl: true,
  },
  {
    code: 'pl-PL',
    nativeName: 'Polski (Polska)',
    englishName: 'Polish (Poland)',
    shortLabel: 'PL',
    rtl: false,
  },
  {
    code: 'pt-BR',
    nativeName: 'Portugues (Brasil)',
    englishName: 'Portuguese (Brazil)',
    shortLabel: 'PT',
    rtl: false,
  },
  {
    code: 'pt-PT',
    nativeName: 'Portugues (Portugal)',
    englishName: 'Portuguese (Portugal)',
    shortLabel: 'PT',
    rtl: false,
  },
  {
    code: 'ro-RO',
    nativeName: 'Romana (Romania)',
    englishName: 'Romanian (Romania)',
    shortLabel: 'RO',
    rtl: false,
  },
  {
    code: 'ru-RU',
    nativeName: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439 (\u0420\u043e\u0441\u0441\u0438\u044f)',
    englishName: 'Russian (Russia)',
    shortLabel: 'RU',
    rtl: false,
  },
  {
    code: 'sr-RS',
    nativeName: '\u0421\u0440\u043f\u0441\u043a\u0438 (\u0421\u0440\u0431\u0438\u0458\u0430)',
    englishName: 'Serbian (Serbia)',
    shortLabel: 'SR',
    rtl: false,
  },
  {
    code: 'sw-KE',
    nativeName: 'Kiswahili (Kenya)',
    englishName: 'Swahili (Kenya)',
    shortLabel: 'SW',
    rtl: false,
  },
  {
    code: 'sv-SE',
    nativeName: 'Svenska (Sverige)',
    englishName: 'Swedish (Sweden)',
    shortLabel: 'SV',
    rtl: false,
  },
  {
    code: 'th-TH',
    nativeName: '\u0e44\u0e17\u0e22 (\u0e44\u0e17\u0e22)',
    englishName: 'Thai (Thailand)',
    shortLabel: 'TH',
    rtl: false,
  },
  {
    code: 'ta-IN',
    nativeName: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd (\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf\u0bbe)',
    englishName: 'Tamil (India)',
    shortLabel: 'TA',
    rtl: false,
  },
  {
    code: 'te-IN',
    nativeName:
      '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41 (\u0c2d\u0c3e\u0c30\u0c24\u0c26\u0c47\u0c36\u0c02)',
    englishName: 'Telugu (India)',
    shortLabel: 'TE',
    rtl: false,
  },
  {
    code: 'tr-TR',
    nativeName: 'Turkce (Turkiye)',
    englishName: 'Turkish (Turkey)',
    shortLabel: 'TR',
    rtl: false,
  },
  {
    code: 'uk-UA',
    nativeName:
      '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430 (\u0423\u043a\u0440\u0430\u0457\u043d\u0430)',
    englishName: 'Ukrainian (Ukraine)',
    shortLabel: 'UK',
    rtl: false,
  },
  {
    code: 'ur-PK',
    nativeName: '\u0627\u0631\u062f\u0648 (\u067e\u0627\u06a9\u0633\u062a\u0627\u0646)',
    englishName: 'Urdu (Pakistan)',
    shortLabel: 'UR',
    rtl: true,
  },
  {
    code: 'uz-UZ',
    nativeName: 'Ozbek (Ozbekiston)',
    englishName: 'Uzbek (Uzbekistan)',
    shortLabel: 'UZ',
    rtl: false,
  },
  {
    code: 'vi-VN',
    nativeName: 'Tieng Viet (Viet Nam)',
    englishName: 'Vietnamese (Vietnam)',
    shortLabel: 'VI',
    rtl: false,
  },
] as const;

type BaseLocale = (typeof BASE_LOCALES)[number];
export type SupportedLocaleCode = BaseLocale['code'];
export type SupportedLocale = BaseLocale & { searchable: string };

export const SUPPORTED_LOCALES: SupportedLocale[] = BASE_LOCALES.map(locale => ({
  ...locale,
  searchable: stripAccents(
    `${locale.nativeName} ${locale.englishName} ${locale.code} ${locale.shortLabel}`,
  ),
}));

export const SUPPORTED_LOCALE_CODES = SUPPORTED_LOCALES.map(locale => locale.code);
export const DEFAULT_LOCALE_CODE: SupportedLocaleCode = 'en-US';

export const normalizeSearchTerm = (value: string): string => stripAccents(value || '');

export const getLocaleMeta = (code: string | null | undefined): SupportedLocale | undefined => {
  if (!code) return undefined;
  const normalized = String(code).trim().toLowerCase();
  return SUPPORTED_LOCALES.find(item => item.code.toLowerCase() === normalized);
};

export const resolveSupportedLocale = (code: string | null | undefined): SupportedLocaleCode => {
  if (!code) return DEFAULT_LOCALE_CODE;
  const normalized = String(code).trim();
  if (!normalized) return DEFAULT_LOCALE_CODE;

  const directMatch = getLocaleMeta(normalized);
  if (directMatch) return directMatch.code;

  const lower = normalized.toLowerCase();
  const byLanguage = SUPPORTED_LOCALES.find(item =>
    item.code.toLowerCase().startsWith(`${lower.split('-')[0]}-`),
  );
  return (byLanguage?.code || DEFAULT_LOCALE_CODE) as SupportedLocaleCode;
};

