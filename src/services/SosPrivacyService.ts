import AsyncStorage from '@react-native-async-storage/async-storage';

const SOS_PUBLIC_OPT_IN_KEY = '@Alert:SOSPublicOptIn';

let cachedOptIn: boolean | null = null;
let hydratePromise: Promise<boolean> | null = null;

const parseOptIn = (raw: string | null): boolean => {
  if (!raw) return false;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed);
  } catch {
    return false;
  }
};

const readOptIn = async (): Promise<boolean> => {
  try {
    const raw = await AsyncStorage.getItem(SOS_PUBLIC_OPT_IN_KEY);
    return parseOptIn(raw);
  } catch {
    return false;
  }
};

export const SosPrivacyService = {
  async isPublicOptInEnabled(): Promise<boolean> {
    if (cachedOptIn !== null) return cachedOptIn;
    if (!hydratePromise) {
      hydratePromise = readOptIn().then(value => {
        cachedOptIn = value;
        return value;
      });
    }
    return hydratePromise;
  },

  async setPublicOptInEnabled(enabled: boolean): Promise<void> {
    cachedOptIn = Boolean(enabled);
    hydratePromise = Promise.resolve(cachedOptIn);
    await AsyncStorage.setItem(SOS_PUBLIC_OPT_IN_KEY, cachedOptIn ? '1' : '0');
  },
};

export default SosPrivacyService;
