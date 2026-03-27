import AsyncStorage from '@react-native-async-storage/async-storage';
import { TelemetryService } from '../services/TelemetryService';
import { getGoogleMobileAdsSdk } from './GoogleMobileAdsRuntime';

const CONSENT_STATE_KEY = '@Alert:AdsConsentStateV1';

export type ConsentState =
  | 'unknown'
  | 'required'
  | 'granted'
  | 'not_required'
  | 'denied'
  | 'unavailable';

export type ConsentSnapshot = {
  state: ConsentState;
  canRequestAds: boolean;
  updatedAt: number;
};

let consentCache: ConsentSnapshot = {
  state: 'unknown',
  canRequestAds: false,
  updatedAt: 0,
};

const loadCachedConsent = async (): Promise<ConsentSnapshot> => {
  try {
    const raw = await AsyncStorage.getItem(CONSENT_STATE_KEY);
    if (!raw) return consentCache;
    const parsed = JSON.parse(raw) as ConsentSnapshot;
    if (!parsed || typeof parsed !== 'object') return consentCache;
    consentCache = {
      state:
        typeof parsed.state === 'string' && parsed.state.length > 0
          ? (parsed.state as ConsentState)
          : 'unknown',
      canRequestAds: Boolean(parsed.canRequestAds),
      updatedAt: Number(parsed.updatedAt) || 0,
    };
    return consentCache;
  } catch {
    return consentCache;
  }
};

const persistConsent = async (snapshot: ConsentSnapshot) => {
  consentCache = snapshot;
  try {
    await AsyncStorage.setItem(CONSENT_STATE_KEY, JSON.stringify(snapshot));
  } catch {
    // fail-soft
  }
};

const normalizeConsentState = (raw: unknown): ConsentState => {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('required')) return 'required';
  if (normalized.includes('obtained') || normalized.includes('granted')) return 'granted';
  if (normalized.includes('not_required')) return 'not_required';
  if (normalized.includes('denied')) return 'denied';
  return 'unknown';
};

const buildSnapshot = (state: ConsentState, canRequestAds: boolean): ConsentSnapshot => ({
  state,
  canRequestAds,
  updatedAt: Date.now(),
});

export const ConsentManager = {
  async ensureConsent(): Promise<ConsentSnapshot> {
    const sdk = getGoogleMobileAdsSdk();
    if (!sdk?.AdsConsent) {
      const snapshot = buildSnapshot('unavailable', true);
      await persistConsent(snapshot);
      return snapshot;
    }

    try {
      await sdk.AdsConsent.requestInfoUpdate?.();

      // Depending on SDK version, this call may return void or consent info object.
      const infoBefore = (await sdk.AdsConsent.getConsentInfo?.()) || {};
      const stateBefore = normalizeConsentState(
        (infoBefore as any)?.status || (infoBefore as any)?.consentStatus,
      );

      if (typeof sdk.AdsConsent.loadAndShowConsentFormIfRequired === 'function') {
        await sdk.AdsConsent.loadAndShowConsentFormIfRequired();
      } else if (typeof sdk.AdsConsent.showForm === 'function' && stateBefore === 'required') {
        await sdk.AdsConsent.showForm();
      }

      const infoAfter = (await sdk.AdsConsent.getConsentInfo?.()) || infoBefore;
      const stateAfter = normalizeConsentState(
        (infoAfter as any)?.status || (infoAfter as any)?.consentStatus,
      );

      const canRequestAds =
        typeof (infoAfter as any)?.canRequestAds === 'boolean'
          ? Boolean((infoAfter as any).canRequestAds)
          : stateAfter === 'granted' || stateAfter === 'not_required' || stateAfter === 'unavailable';

      const snapshot = buildSnapshot(stateAfter, canRequestAds);
      await persistConsent(snapshot);
      return snapshot;
    } catch (error: any) {
      const cached = await loadCachedConsent();
      TelemetryService.trackEvent('ads_consent_ensure_failed', {
        reason: String(error?.message || error || 'unknown'),
        state: cached.state,
      });
      return cached.updatedAt > 0 ? cached : buildSnapshot('unknown', false);
    }
  },

  async getState(): Promise<ConsentSnapshot> {
    if (consentCache.updatedAt > 0) return consentCache;
    return loadCachedConsent();
  },

  async openPrivacyOptions(): Promise<boolean> {
    const sdk = getGoogleMobileAdsSdk();
    if (!sdk?.AdsConsent) return false;
    try {
      if (typeof sdk.AdsConsent.showPrivacyOptionsForm === 'function') {
        await sdk.AdsConsent.showPrivacyOptionsForm();
      } else if (typeof sdk.AdsConsent.showForm === 'function') {
        await sdk.AdsConsent.showForm();
      } else {
        return false;
      }
      const refreshed = await this.ensureConsent();
      TelemetryService.trackEvent('ads_consent_privacy_options_opened', {
        state: refreshed.state,
      });
      return true;
    } catch (error: any) {
      TelemetryService.trackEvent('ads_consent_privacy_options_failed', {
        reason: String(error?.message || error || 'unknown'),
      });
      return false;
    }
  },
};

export default ConsentManager;
