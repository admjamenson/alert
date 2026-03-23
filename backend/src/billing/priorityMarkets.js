const COUNTRY_MARKET_CONFIG = Object.freeze({
  AE: { currency: 'AED', locale: 'ar-AE' },
  AT: { currency: 'EUR', locale: 'de-AT' },
  AU: { currency: 'AUD', locale: 'en-AU' },
  BE: { currency: 'EUR', locale: 'fr-BE' },
  BR: { currency: 'BRL', locale: 'pt-BR' },
  CA: { currency: 'CAD', locale: 'en-CA' },
  CH: { currency: 'CHF', locale: 'de-CH' },
  CN: { currency: 'CNY', locale: 'zh-CN' },
  CO: { currency: 'COP', locale: 'es-CO' },
  CZ: { currency: 'CZK', locale: 'cs-CZ' },
  DE: { currency: 'EUR', locale: 'de-DE' },
  DK: { currency: 'DKK', locale: 'da-DK' },
  ES: { currency: 'EUR', locale: 'es-ES' },
  FI: { currency: 'EUR', locale: 'fi-FI' },
  FR: { currency: 'EUR', locale: 'fr-FR' },
  GB: { currency: 'GBP', locale: 'en-GB' },
  HK: { currency: 'HKD', locale: 'zh-HK' },
  HU: { currency: 'HUF', locale: 'hu-HU' },
  IE: { currency: 'EUR', locale: 'en-IE' },
  IL: { currency: 'ILS', locale: 'he-IL' },
  IN: { currency: 'INR', locale: 'en-IN' },
  IT: { currency: 'EUR', locale: 'it-IT' },
  JP: { currency: 'JPY', locale: 'ja-JP' },
  KR: { currency: 'KRW', locale: 'ko-KR' },
  LU: { currency: 'EUR', locale: 'fr-LU' },
  MY: { currency: 'MYR', locale: 'ms-MY' },
  NL: { currency: 'EUR', locale: 'nl-NL' },
  NO: { currency: 'NOK', locale: 'nb-NO' },
  NZ: { currency: 'NZD', locale: 'en-NZ' },
  PL: { currency: 'PLN', locale: 'pl-PL' },
  PT: { currency: 'EUR', locale: 'pt-PT' },
  SA: { currency: 'SAR', locale: 'ar-SA' },
  SE: { currency: 'SEK', locale: 'sv-SE' },
  SG: { currency: 'SGD', locale: 'en-SG' },
  US: { currency: 'USD', locale: 'en-US' },
});

const PRIORITY_CITIES_BY_COUNTRY = Object.freeze({
  AE: ['abu dhabi'],
  AT: ['vienna'],
  AU: ['brisbane', 'melbourne', 'perth', 'sydney'],
  BE: ['brussels'],
  BR: ['sao paulo'],
  CA: ['calgary', 'montreal', 'toronto', 'vancouver'],
  CH: ['basel', 'geneva', 'zurich'],
  CN: [
    'chengdu',
    'dongguan',
    'foshan',
    'fuzhou',
    'hefei',
    'jinan',
    'nantong',
    "xi'an",
    'quanzhou',
    'zhengzhou',
  ],
  CO: ['bogota'],
  CZ: ['prague'],
  DE: ['berlin', 'dusseldorf', 'hamburg', 'munich'],
  DK: ['copenhagen'],
  ES: ['madrid'],
  FI: ['helsinki'],
  FR: ['lyon', 'paris'],
  GB: ['birmingham', 'london', 'manchester'],
  HK: ['hong kong'],
  HU: ['budapest'],
  IE: ['dublin'],
  IL: ['tel aviv'],
  IN: ['hyderabad', 'mumbai'],
  IT: ['milan'],
  JP: ['fukuoka', 'nagoya', 'tokyo'],
  KR: ['busan', 'seoul'],
  LU: ['luxembourg'],
  MY: ['kuala lumpur'],
  NL: ['amsterdam'],
  NO: ['oslo'],
  NZ: ['auckland'],
  PL: ['warsaw'],
  PT: ['porto'],
  SA: ['mecca', 'riyadh'],
  SE: ['stockholm'],
  SG: ['singapore'],
  US: [
    'atlanta',
    'austin',
    'boston',
    'charlotte',
    'chicago',
    'columbus',
    'dallas',
    'denver',
    'houston',
    'indianapolis',
    'las vegas',
    'los angeles',
    'minneapolis',
    'nashville',
    'new york',
    'orlando',
    'philadelphia',
    'phoenix',
    'pittsburgh',
    'portland',
    'raleigh',
    'salt lake city',
    'san antonio',
    'san diego',
    'san francisco',
    'san jose',
    'seattle',
    'tampa',
    'washington dc',
  ],
});

const sanitizeValue = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[()'.,]/g, ' ')
    .replace(/\bd\s+c\b/g, 'dc')
    .replace(/\s+/g, ' ')
    .trim();

const compactSanitizedValue = value => sanitizeValue(value).replace(/\s+/g, '');

const slugifyMarketPart = value =>
  sanitizeValue(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const resolveCountryFromLocale = locale => {
  const match = String(locale || '').match(/[-_](\w{2})\b/);
  return match ? String(match[1]).toUpperCase() : null;
};

const resolvePriorityCity = (countryCode, cityName) => {
  const normalizedCountry = String(countryCode || '').toUpperCase();
  const normalizedCity = sanitizeValue(cityName);
  const compactNormalizedCity = compactSanitizedValue(cityName);
  if (!normalizedCountry || !normalizedCity) {
    return null;
  }

  const candidates = PRIORITY_CITIES_BY_COUNTRY[normalizedCountry] || [];
  if (!candidates.length) {
    return null;
  }

  return (
    candidates.find(candidate => {
      const normalizedCandidate = sanitizeValue(candidate);
      const compactNormalizedCandidate = compactSanitizedValue(candidate);
      return (
        normalizedCandidate === normalizedCity ||
        normalizedCandidate.startsWith(normalizedCity) ||
        normalizedCity.startsWith(normalizedCandidate) ||
        compactNormalizedCandidate === compactNormalizedCity ||
        compactNormalizedCandidate.startsWith(compactNormalizedCity) ||
        compactNormalizedCity.startsWith(compactNormalizedCandidate)
      );
    }) || null
  );
};

const resolveBillingMarket = ({ locale, countryCode, cityName, fallbackCountryCode }) => {
  const normalizedLocale = String(locale || '').trim();
  const compactNormalizedCity = compactSanitizedValue(cityName);
  let resolvedCountry =
    String(countryCode || '').trim().toUpperCase() ||
    resolveCountryFromLocale(normalizedLocale) ||
    String(fallbackCountryCode || '').trim().toUpperCase() ||
    'US';

  if (compactNormalizedCity === compactSanitizedValue('hong kong')) {
    resolvedCountry = 'HK';
  }

  const countryMarket = COUNTRY_MARKET_CONFIG[resolvedCountry] || COUNTRY_MARKET_CONFIG.US;
  const matchedCity = resolvePriorityCity(resolvedCountry, cityName);
  const cleanCity = matchedCity || String(cityName || '').trim() || null;

  return {
    countryCode: resolvedCountry,
    currency: countryMarket.currency,
    locale: normalizedLocale || countryMarket.locale,
    cityName: cleanCity,
    marketTier: matchedCity ? 'priority_city' : 'country',
    marketKey: matchedCity
      ? `${resolvedCountry}-${slugifyMarketPart(matchedCity)}`
      : `${resolvedCountry}-${countryMarket.currency}`,
    priorityCity: matchedCity || null,
  };
};

module.exports = {
  COUNTRY_MARKET_CONFIG,
  PRIORITY_CITIES_BY_COUNTRY,
  compactSanitizedValue,
  resolveBillingMarket,
  resolveCountryFromLocale,
  sanitizeValue,
};
