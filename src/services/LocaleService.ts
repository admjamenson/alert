import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import {
  DEFAULT_LOCALE_CODE,
  SupportedLocaleCode,
  SUPPORTED_LOCALES,
  getLocaleMeta,
  resolveSupportedLocale,
} from '../constants/locales';
import {
  LANGUAGE_STORAGE_KEY,
  getDeviceLanguage,
  loadStoredLanguage as loadStoredLanguageInternal,
  setStoredLanguage as setStoredLanguageInternal,
} from '../i18n';

export type LanguagePreference = 'system' | SupportedLocaleCode;

const toPreference = (value: string | null | undefined): LanguagePreference => {
  if (!value || value === 'system') return 'system';
  return resolveSupportedLocale(value);
};

export const LocaleService = {
  STORAGE_KEY: LANGUAGE_STORAGE_KEY,

  getAvailableLocales() {
    return SUPPORTED_LOCALES;
  },

  getDeviceLocaleCode(): SupportedLocaleCode {
    return resolveSupportedLocale(getDeviceLanguage());
  },

  resolveLocaleCode(code: string | null | undefined): SupportedLocaleCode {
    return resolveSupportedLocale(code);
  },

  getLocaleMeta(code: string | null | undefined) {
    return getLocaleMeta(code) || getLocaleMeta(DEFAULT_LOCALE_CODE)!;
  },

  async getStoredLanguagePreference(): Promise<LanguagePreference> {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return toPreference(stored);
  },

  async loadAndApplyLanguage(): Promise<LanguagePreference> {
    const stored = await loadStoredLanguageInternal();
    return toPreference(stored);
  },

  async applyLanguage(preference: LanguagePreference): Promise<SupportedLocaleCode> {
    if (preference === 'system') {
      await setStoredLanguageInternal('system');
      return this.getDeviceLocaleCode();
    }

    const resolved = resolveSupportedLocale(preference);
    await setStoredLanguageInternal(resolved);
    return resolved;
  },

  async applySystemLanguage(): Promise<SupportedLocaleCode> {
    await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
    const locale = this.getDeviceLocaleCode();
    await i18n.changeLanguage(locale);
    return locale;
  },
};

export default LocaleService;
