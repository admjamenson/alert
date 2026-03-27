let i18nModulePromise: Promise<any> | null = null;

const loadI18nModule = async () => {
  if (!i18nModulePromise) {
    i18nModulePromise = Promise.resolve().then(() => require('./index'));
  }
  return i18nModulePromise;
};

export const ensureI18nReady = async (): Promise<void> => {
  await loadI18nModule();
};

export const loadStoredLanguageDeferred = async (): Promise<string> => {
  const i18nModule = await loadI18nModule();
  return i18nModule.loadStoredLanguage();
};

export const getI18nInstance = () => {
  const i18nModule = require('./index');
  return i18nModule.default || i18nModule;
};
