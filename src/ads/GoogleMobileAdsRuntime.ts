import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

type GoogleMobileAdsSdk = {
  default?: () => { initialize?: () => Promise<unknown> | unknown } | null;
  mobileAds?: () => { initialize?: () => Promise<unknown> | unknown } | null;
  AdsConsent?: {
    requestInfoUpdate?: () => Promise<unknown> | unknown;
    getConsentInfo?: () => Promise<unknown> | unknown;
    loadAndShowConsentFormIfRequired?: () => Promise<unknown> | unknown;
    showForm?: () => Promise<unknown> | unknown;
    showPrivacyOptionsForm?: () => Promise<unknown> | unknown;
  } | null;
  BannerAd?: unknown;
  BannerAdSize?: {
    ANCHORED_ADAPTIVE_BANNER?: string;
    ADAPTIVE_BANNER?: string;
    BANNER?: string;
  };
};

let cachedSdk: GoogleMobileAdsSdk | null | undefined;

const hasNativeGoogleMobileAdsModule = () => {
  const turboModule =
    typeof TurboModuleRegistry?.get === 'function'
      ? TurboModuleRegistry.get('RNGoogleMobileAdsModule')
      : null;
  const bridgedModule = (NativeModules as Record<string, unknown>)
    ?.RNGoogleMobileAdsModule;
  return Boolean(turboModule || bridgedModule);
};

const shouldLoadNativeGoogleMobileAds = () =>
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  hasNativeGoogleMobileAdsModule();

export const getGoogleMobileAdsSdk = () => {
  if (!shouldLoadNativeGoogleMobileAds()) {
    return null;
  }

  if (cachedSdk !== undefined) {
    return cachedSdk;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSdk = require('react-native-google-mobile-ads') as GoogleMobileAdsSdk;
  } catch {
    cachedSdk = null;
  }

  return cachedSdk;
};

export const resetGoogleMobileAdsRuntimeForTests = () => {
  cachedSdk = undefined;
};

export default getGoogleMobileAdsSdk;
