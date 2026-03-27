import { AdFormat, AdPlacementId } from '../ads/placements';
import { GeoTier } from '../config/remoteConfig/adsConfig';
import { TelemetryService } from '../services/TelemetryService';

export type AdEventBase = {
  placementId: AdPlacementId;
  screenId: string;
  geoTier: GeoTier;
  adFormat: AdFormat;
  networkName?: string;
};

const sanitizeErrorCode = (value: unknown) =>
  String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 64);

export const trackAdRequest = (event: AdEventBase) => {
  TelemetryService.trackEvent('ad_request', event);
};

export const trackAdLoad = (event: AdEventBase) => {
  TelemetryService.trackEvent('ad_load', event);
};

export const trackAdFail = (event: AdEventBase & { errorCode?: unknown }) => {
  TelemetryService.trackEvent('ad_fail', {
    ...event,
    errorCode: sanitizeErrorCode(event.errorCode),
  });
};

export const trackAdImpression = (event: AdEventBase) => {
  TelemetryService.trackEvent('ad_impression', event);
};

export const trackAdClick = (event: AdEventBase) => {
  TelemetryService.trackEvent('ad_click', event);
};

export const trackAdPaid = (
  event: AdEventBase & {
    valueMicros: number;
    currency?: string;
  },
) => {
  TelemetryService.trackEvent('ad_paid', {
    ...event,
    valueMicros: Math.max(0, Math.floor(Number(event.valueMicros) || 0)),
    currency: String(event.currency || 'USD').slice(0, 8),
  });
};

export const trackRewardStarted = (event: AdEventBase) => {
  TelemetryService.trackEvent('reward_started', event);
};

export const trackRewardEarned = (event: AdEventBase) => {
  TelemetryService.trackEvent('reward_earned', event);
};

export const trackRewardClosed = (event: AdEventBase) => {
  TelemetryService.trackEvent('reward_closed', event);
};
