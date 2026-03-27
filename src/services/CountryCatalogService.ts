import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Country,
  CountryCode,
  FlagType,
  getAllCountries,
} from 'react-native-country-picker-modal';
import {
  CountryTranslationCode,
  resolveCountryTranslation,
} from '../constants/localeToCountryTranslation';

export const PHONE_COUNTRY_CODE_KEY = '@Alert:PhoneCountryCode';
export const PHONE_CALLING_CODE_KEY = '@Alert:PhoneCallingCode';

type CatalogCacheEntry = {
  updatedAt: number;
  countries: CountryCatalogItem[];
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_COUNTRY_CODE: CountryCode = 'BR';
const DEFAULT_CALLING_CODE = '55';

const cacheByTranslation = new Map<CountryTranslationCode, CatalogCacheEntry>();

const normalize = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeName = (
  name: string | Record<string, string> | undefined,
): string => {
  if (typeof name === 'string') return name;
  if (!name) return '';
  return String(name.common || Object.values(name)[0] || '').trim();
};

export type CountryCatalogItem = {
  cca2: CountryCode;
  name: string;
  commonName: string;
  callingCode: string;
  flag: string;
  searchable: string;
};

const buildCatalog = (
  localized: Country[],
  common: Country[],
): CountryCatalogItem[] => {
  const commonByCode = new Map<CountryCode, Country>(
    common.map(item => [item.cca2, item]),
  );

  return localized
    .map(item => {
      const commonItem = commonByCode.get(item.cca2);
      const localizedName = normalizeName(item.name);
      const commonName = normalizeName(commonItem?.name || item.name);
      const name = localizedName || commonName;
      const callingCode = String(item.callingCode?.[0] || '').trim();
      const flag = String(item.flag || '').trim();
      const searchable = normalize(
        `${name} ${commonName} ${item.cca2} +${callingCode}`,
      );

      return {
        cca2: item.cca2,
        name,
        commonName,
        callingCode,
        flag,
        searchable,
      } satisfies CountryCatalogItem;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const CountryCatalogService = {
  async getCountries(localeTag?: string): Promise<CountryCatalogItem[]> {
    const translation = resolveCountryTranslation(localeTag);
    const cached = cacheByTranslation.get(translation);
    if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return cached.countries;
    }

    const localized = await getAllCountries(
      FlagType.EMOJI,
      translation as any,
    );
    const common =
      translation === 'common'
        ? localized
        : await getAllCountries(FlagType.EMOJI, 'common' as any);

    const countries = buildCatalog(localized, common);
    cacheByTranslation.set(translation, { updatedAt: Date.now(), countries });
    return countries;
  },

  filterCountries(
    countries: CountryCatalogItem[],
    rawQuery: string,
  ): CountryCatalogItem[] {
    const query = normalize(rawQuery).replace(/^\+/, '');
    if (!query) return countries;
    return countries.filter(item => {
      if (item.searchable.includes(query)) return true;
      const calling = String(item.callingCode || '').trim();
      if (!calling) return false;
      return calling.startsWith(query);
    });
  },

  async getCountryByCode(
    code: CountryCode,
    localeTag?: string,
  ): Promise<CountryCatalogItem | null> {
    const countries = await this.getCountries(localeTag);
    return countries.find(item => item.cca2 === code) || null;
  },

  async saveSelection(code: CountryCode, callingCode: string): Promise<void> {
    await AsyncStorage.multiSet([
      [PHONE_COUNTRY_CODE_KEY, code],
      [PHONE_CALLING_CODE_KEY, String(callingCode || DEFAULT_CALLING_CODE)],
    ]);
  },

  async loadSelection(): Promise<{ countryCode: CountryCode; callingCode: string }> {
    const [[, savedCode], [, savedCalling]] = await AsyncStorage.multiGet([
      PHONE_COUNTRY_CODE_KEY,
      PHONE_CALLING_CODE_KEY,
    ]);

    const countryCode = (savedCode || DEFAULT_COUNTRY_CODE) as CountryCode;
    const callingCode = String(savedCalling || DEFAULT_CALLING_CODE);
    return { countryCode, callingCode };
  },
};

export default CountryCatalogService;

