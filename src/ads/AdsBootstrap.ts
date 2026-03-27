import { Platform } from 'react-native';
import { trackAdFail } from '../analytics/adEvents';
import {
  AdsConfig,
  GeoTier,
  getRuntimePlatform,
  loadAdsConfig,
} from '../config/remoteConfig/adsConfig';
import { TelemetryService } from '../services/TelemetryService';
import { ConsentManager, ConsentSnapshot } from './ConsentManager';
import { FrequencyCapManager } from './FrequencyCapManager';
import { resolveGeoTier } from './GeoTierResolver';
import { getGoogleMobileAdsSdk } from './GoogleMobileAdsRuntime';
import { AD_PLACEMENTS, AdPlacementId } from './placements';

export type AdRiskState = {
  sosActive?: boolean;
  riskHigh?: boolean;
  offline?: boolean;
};

export type PlacementDecision = {
  allowed: boolean;
  placementId: AdPlacementId;
  adUnitId: string;
  format: (typeof AD_PLACEMENTS)[AdPlacementId]['format'];
  geoTier: GeoTier;
  screenId: string;
  reason?:
    | 'ads_disabled'
    | 'consent_blocked'
    | 'screen_not_allowed'
    | 'blocked_by_risk_state'
    | 'blocked_by_frequency_cap'
    | 'empty_ad_unit'
    | 'sdk_unavailable'
    | 'ads_not_initialized';
  capReason?: string;
};

export type AdsRuntimeState = {
  initialized: boolean;
  enabled: boolean;
  sdkReady: boolean;
  geoTier: GeoTier;
  countryCode: string;
  config: AdsConfig;
  consent: ConsentSnapshot;
  updatedAt: number;
};

const disabledDecision = (
  placementId: AdPlacementId,
  screenId: string,
  geoTier: GeoTier,
  reason: NonNullable<PlacementDecision['reason']>,
  capReason?: string,
): PlacementDecision => ({
  allowed: false,
  placementId,
  adUnitId: '',
  format: AD_PLACEMENTS[placementId].format,
  geoTier,
  screenId,
  reason,
  capReason,
});

const runtimeState: AdsRuntimeState = {
  initialized: false,
  enabled: false,
  sdkReady: false,
  geoTier: 'row',
  countryCode: 'ZZ',
  config: {
    enabled: false,
    geoTierRules: { tier1Countries: [] },
    adUnitMap: {
      android: { tier1: {} as any, row: {} as any },
      ios: { tier1: {} as any, row: {} as any },
    },
    frequencyCaps: {} as any,
    placementRules: {} as any,
  },
  consent: {
    state: 'unknown',
    canRequestAds: false,
    updatedAt: 0,
  },
  updatedAt: 0,
};

export const AdsBootstrap = {
  async initialize(): Promise<AdsRuntimeState> {
    FrequencyCapManager.resetSession();
    const config = await loadAdsConfig();
    const geo = resolveGeoTier(config);
    const consent = await ConsentManager.ensureConsent();

    runtimeState.config = config;
    runtimeState.geoTier = geo.geoTier;
    runtimeState.countryCode = geo.countryCode;
    runtimeState.consent = consent;
    runtimeState.enabled = config.enabled;
    runtimeState.initialized = true;
    runtimeState.updatedAt = Date.now();
    runtimeState.sdkReady = false;

    if (!config.enabled) {
      TelemetryService.trackEvent('ads_bootstrap_disabled_by_config', {
        geoTier: geo.geoTier,
      });
      return { ...runtimeState };
    }

    if (!consent.canRequestAds) {
      TelemetryService.trackEvent('ads_bootstrap_blocked_by_consent', {
        geoTier: geo.geoTier,
        consentState: consent.state,
      });
      return { ...runtimeState };
    }

    const sdk = getGoogleMobileAdsSdk();
    if (!sdk) {
      TelemetryService.trackEvent('ads_bootstrap_sdk_unavailable', {
        geoTier: geo.geoTier,
      });
      return { ...runtimeState };
    }

    try {
      const mobileAdsFactory =
        (typeof sdk.default === 'function' && sdk.default) ||
        (typeof sdk.mobileAds === 'function' && sdk.mobileAds) ||
        null;
      if (mobileAdsFactory) {
        const adsInstance = mobileAdsFactory();
        await adsInstance?.initialize?.();
      }
      runtimeState.sdkReady = true;
      TelemetryService.trackEvent('ads_bootstrap_ready', {
        geoTier: geo.geoTier,
        consentState: consent.state,
      });
    } catch (error: any) {
      runtimeState.sdkReady = false;
      TelemetryService.trackEvent('ads_bootstrap_init_failed', {
        geoTier: geo.geoTier,
        reason: String(error?.message || error || 'unknown'),
      });
    }

    return { ...runtimeState };
  },

  getState(): AdsRuntimeState {
    return { ...runtimeState };
  },

  getSdkModule() {
    return getGoogleMobileAdsSdk();
  },

  async evaluatePlacement(input: {
    placementId: AdPlacementId;
    screenId: string;
    riskState?: AdRiskState;
  }): Promise<PlacementDecision> {
    const { placementId, screenId, riskState } = input;
    const safeRisk: Required<AdRiskState> = {
      sosActive: Boolean(riskState?.sosActive),
      riskHigh: Boolean(riskState?.riskHigh),
      offline: Boolean(riskState?.offline),
    };

    const geoTier = runtimeState.geoTier || 'row';

    if (!runtimeState.initialized) {
      return disabledDecision(placementId, screenId, geoTier, 'ads_not_initialized');
    }

    if (!runtimeState.enabled) {
      return disabledDecision(placementId, screenId, geoTier, 'ads_disabled');
    }

    if (!runtimeState.consent.canRequestAds) {
      return disabledDecision(placementId, screenId, geoTier, 'consent_blocked');
    }

    if (!runtimeState.sdkReady) {
      return disabledDecision(placementId, screenId, geoTier, 'sdk_unavailable');
    }

    const placementRule = runtimeState.config.placementRules[placementId];
    if (
      Array.isArray(placementRule?.allowedScreens) &&
      placementRule.allowedScreens.length > 0 &&
      !placementRule.allowedScreens.includes(screenId)
    ) {
      return disabledDecision(placementId, screenId, geoTier, 'screen_not_allowed');
    }

    if (
      (placementRule?.blockWhen?.sosActive && safeRisk.sosActive) ||
      (placementRule?.blockWhen?.riskHigh && safeRisk.riskHigh) ||
      (placementRule?.blockWhen?.offline && safeRisk.offline)
    ) {
      return disabledDecision(placementId, screenId, geoTier, 'blocked_by_risk_state');
    }

    const caps = runtimeState.config.frequencyCaps[placementId];
    const capDecision = await FrequencyCapManager.canShow(placementId, caps);
    if (!capDecision.allowed) {
      return disabledDecision(
        placementId,
        screenId,
        geoTier,
        'blocked_by_frequency_cap',
        capDecision.reason,
      );
    }

    const platformKey = getRuntimePlatform();
    const adUnitId =
      runtimeState.config.adUnitMap?.[platformKey]?.[geoTier]?.[placementId] ||
      runtimeState.config.adUnitMap?.[platformKey]?.row?.[placementId] ||
      '';

    if (!adUnitId) {
      return disabledDecision(placementId, screenId, geoTier, 'empty_ad_unit');
    }

    return {
      allowed: true,
      placementId,
      adUnitId,
      format: AD_PLACEMENTS[placementId].format,
      geoTier,
      screenId,
    };
  },

  async markPlacementShown(placementId: AdPlacementId) {
    await FrequencyCapManager.markShown(placementId);
  },
};

export const ensureAdsBootstrap = async () => {
  if (runtimeState.initialized) return AdsBootstrap.getState();
  return AdsBootstrap.initialize();
};

export const getAdsPlatformLabel = () => (Platform.OS === 'ios' ? 'ios' : 'android');

export const trackPlacementEvaluationFailure = (decision: PlacementDecision) => {
  if (decision.allowed) return;
  trackAdFail({
    placementId: decision.placementId,
    screenId: decision.screenId,
    geoTier: decision.geoTier,
    adFormat: decision.format,
    errorCode: decision.reason || 'unknown',
  });
};

export default AdsBootstrap;
