let i18nModulePromise: Promise<any> | null = null;
let i18nModuleSync: any | null = null;

export const initializeI18nRuntime = () => {
  if (!i18nModuleSync) {
    i18nModuleSync = require('./index');
  }
  return i18nModuleSync;
};

const loadI18nModule = async () => {
  if (!i18nModulePromise) {
    i18nModulePromise = Promise.resolve().then(() => initializeI18nRuntime());
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
  const i18nModule = initializeI18nRuntime();
  return i18nModule.default || i18nModule;
};
