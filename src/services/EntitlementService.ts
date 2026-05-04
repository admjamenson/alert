import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getAlertApiBaseUrl } from '../core/config';
import { UserIdentityService } from './UserIdentityService';
import { TelemetryService } from './TelemetryService';

const ENTITLEMENT_CACHE_KEY = '@Alert:EntitlementsV1';
const ENTITLEMENT_CACHE_TTL_MS = 10 * 60 * 1000;
const ENTITLEMENT_FORCE_REFRESH_THROTTLE_MS = 5_000;
const ENTITLEMENT_BACKOFF_CAP_MS = 120_000;

type EntitlementCachePayload = {
  savedAtMs: number;
  data: EntitlementSnapshot;
};

type EntitlementFailureState = {
  streak: number;
  blockedUntilMs: number;
  lastForcedAttemptMs: number;
};

export type EntitlementSnapshot = {
  userId: string;
  plan: 'free' | 'premium';
  isPremium: boolean;
  premium: boolean;
  featureFlags: {
    starlinkConnectEnabled: boolean;
    starlinkTunnelBetaEnabled: boolean;
    starlinkExclusiveEnabled: boolean;
    sosEnhancementsEnabled: boolean;
    mapsEnabled: boolean;
    weatherEnabled: boolean;
    alertsEnabled: boolean;
    aiChatEnabled: boolean;
    externalIntegrationsEnabled: boolean;
  };
  release: {
    releaseVersion: string;
    canaryPercent: number;
    inCanary: boolean;
    killSwitchActive: boolean;
    rollbackRecommended: boolean;
    degradedMode: boolean;
    reasonCodes: string[];
    expiresAt: string;
  } | null;
  limits: {
    monitoring: {
      maxRadiusKm: number;
      maxItems: number;
      refreshFloorSec: number;
    };
    epidemic: {
      maxWindow: '7d' | 'all';
    };
    weather: {
      minRefreshSec: number;
    };
  };
  costGates: {
    realtimeRiskFeed: boolean;
    extendedMonitoring: boolean;
    epidemicAllWindow: boolean;
    highFrequencyPolling: boolean;
  };
  degradedMode: boolean;
  reasonCodes: string[];
  expiresAt: string;
  source: 'network' | 'cache' | 'fallback';
};

const getApiBaseUrl = () => getAlertApiBaseUrl();

const inFlightByUserKey = new Map<string, Promise<EntitlementSnapshot>>();
const failureStateByUserKey = new Map<string, EntitlementFailureState>();
let unexpectedWarned = false;

const nowIsoPlus = (ms: number) => new Date(Date.now() + ms).toISOString();

const defaultSnapshot = (userId: string): EntitlementSnapshot => ({
  userId,
  plan: 'free',
  isPremium: false,
  premium: false,
  featureFlags: {
    starlinkConnectEnabled: false,
    starlinkTunnelBetaEnabled: false,
    starlinkExclusiveEnabled: false,
    sosEnhancementsEnabled: false,
    mapsEnabled: false,
    weatherEnabled: false,
    alertsEnabled: false,
    aiChatEnabled: false,
    externalIntegrationsEnabled: false,
  },
  release: null,
  limits: {
    monitoring: {
      maxRadiusKm: 35,
      maxItems: 90,
      refreshFloorSec: 60,
    },
    epidemic: {
      maxWindow: '7d',
    },
    weather: {
      minRefreshSec: 120,
    },
  },
  costGates: {
    realtimeRiskFeed: true,
    extendedMonitoring: false,
    epidemicAllWindow: false,
    highFrequencyPolling: false,
  },
  degradedMode: true,
  reasonCodes: ['plan_free_standard_limits'],
  expiresAt: nowIsoPlus(ENTITLEMENT_CACHE_TTL_MS),
  source: 'fallback',
});

const parseCache = (raw: string | null): EntitlementCachePayload | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EntitlementCachePayload;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAtMs !== 'number') return null;
    if (!parsed.data || typeof parsed.data !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const readCachedPayload = async (onlyFresh: boolean): Promise<EntitlementCachePayload | null> => {
  const raw = await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY);
  const cached = parseCache(raw);
  if (!cached) return null;
  if (!onlyFresh) return cached;
  if (Date.now() - cached.savedAtMs < ENTITLEMENT_CACHE_TTL_MS) return cached;
  return null;
};

const cacheToSnapshot = (cached: EntitlementCachePayload): EntitlementSnapshot => {
  const fallback = defaultSnapshot(String(cached?.data?.userId || 'unknown'));
  return {
    ...fallback,
    ...cached.data,
    premium:
      typeof cached?.data?.premium === 'boolean'
        ? cached.data.premium
        : Boolean(cached?.data?.isPremium),
    featureFlags: {
      ...fallback.featureFlags,
      ...(cached?.data?.featureFlags || {}),
    },
    limits: {
      monitoring: {
        ...fallback.limits.monitoring,
        ...(cached?.data?.limits?.monitoring || {}),
      },
      epidemic: {
        ...fallback.limits.epidemic,
        ...(cached?.data?.limits?.epidemic || {}),
      },
      weather: {
        ...fallback.limits.weather,
        ...(cached?.data?.limits?.weather || {}),
      },
    },
    costGates: {
      ...fallback.costGates,
      ...(cached?.data?.costGates || {}),
    },
    reasonCodes: Array.isArray(cached?.data?.reasonCodes)
      ? cached.data.reasonCodes
      : fallback.reasonCodes,
    source: 'cache',
  };
};

const getFailureState = (userKey: string): EntitlementFailureState =>
  failureStateByUserKey.get(userKey) || { streak: 0, blockedUntilMs: 0, lastForcedAttemptMs: 0 };

const computeBackoffMs = (streak: number): number => {
  if (streak <= 1) return 30_000;
  if (streak === 2) return 60_000;
  return ENTITLEMENT_BACKOFF_CAP_MS;
};

const registerRecoverableFailure = (userKey: string): EntitlementFailureState => {
  const current = getFailureState(userKey);
  const streak = current.streak + 1;
  const backoffMs = computeBackoffMs(streak);
  const next: EntitlementFailureState = {
    ...current,
    streak,
    blockedUntilMs: Date.now() + backoffMs,
  };
  failureStateByUserKey.set(userKey, next);
  return next;
};

const markForceAttemptForBlockedState = (userKey: string, nowMs: number): void => {
  const current = getFailureState(userKey);
  failureStateByUserKey.set(userKey, {
    ...current,
    lastForcedAttemptMs: nowMs,
  });
};

const resetFailureState = (userKey: string): void => {
  failureStateByUserKey.set(userKey, {
    streak: 0,
    blockedUntilMs: 0,
    lastForcedAttemptMs: 0,
  });
};

const getEntitlementHttpStatus = (error: unknown): number | null => {
  const message = String((error as any)?.message || error || '');
  const match = message.match(/entitlement_http_(\d{3})/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

const getRecoverableReason = (error: unknown): string => {
  const status = getEntitlementHttpStatus(error);
  if (status !== null) return `http_${status}`;
  const name = String((error as any)?.name || '').toLowerCase();
  if (name.includes('abort')) return 'abort';
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (message.includes('network request failed')) return 'network_request_failed';
  if (message.includes('failed to fetch')) return 'failed_to_fetch';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('dns') || message.includes('enotfound')) return 'dns';
  if (message.includes('tls') || message.includes('ssl') || message.includes('certificate')) {
    return 'tls';
  }
  if (message.includes('offline')) return 'offline';
  if (message.includes('connection')) return 'connection';
  return 'unknown';
};

const isRecoverableEntitlementError = (error: unknown): boolean => {
  const status = getEntitlementHttpStatus(error);
  if (status !== null) {
    return status >= 500 && status <= 599;
  }

  const name = String((error as any)?.name || '').toLowerCase();
  if (name.includes('abort')) return true;

  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('dns') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('tls') ||
    message.includes('ssl') ||
    message.includes('certificate') ||
    message.includes('offline') ||
    message.includes('connection')
  );
};

const trackFallbackTelemetry = (
  reason: string,
  state: EntitlementFailureState,
  hasCache: boolean,
) => {
  TelemetryService.trackEvent('entitlement_fallback_used', {
    reason,
    streak: state.streak,
    blockedUntilMs: state.blockedUntilMs,
    hasCache,
  });
};

const warnUnexpectedOnce = (error: unknown) => {
  if (!__DEV__ || unexpectedWarned) return;
  unexpectedWarned = true;
  console.log(
    '[EntitlementService] unexpected fallback (non-recoverable):',
    (error as any)?.message || error,
  );
};

const getUserKey = async () => {
  const phone = await UserIdentityService.getUserPhone();
  if (phone) return phone;
  return UserIdentityService.getDeviceId();
};

export const EntitlementService = {
  async clearCache(): Promise<void> {
    await AsyncStorage.removeItem(ENTITLEMENT_CACHE_KEY);
  },

  async getEntitlements(options?: { forceRefresh?: boolean }): Promise<EntitlementSnapshot> {
    const forceRefresh = Boolean(options?.forceRefresh);
    const userKey = await getUserKey();
    const inFlight = inFlightByUserKey.get(userKey);
    if (inFlight) return inFlight;

    if (!forceRefresh) {
      const cachedFresh = await readCachedPayload(true);
      if (cachedFresh) {
        return cacheToSnapshot(cachedFresh);
      }
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      const cached = await readCachedPayload(false);
      if (cached) return cacheToSnapshot(cached);
      return defaultSnapshot(userKey);
    }

    const nowMs = Date.now();
    const failureState = getFailureState(userKey);
    if (failureState.blockedUntilMs > nowMs) {
      const allowForcedAttempt =
        forceRefresh &&
        nowMs - failureState.lastForcedAttemptMs >= ENTITLEMENT_FORCE_REFRESH_THROTTLE_MS;

      if (!allowForcedAttempt) {
        const cached = await readCachedPayload(false);
        trackFallbackTelemetry('blocked', failureState, Boolean(cached));
        if (cached) return cacheToSnapshot(cached);
        return defaultSnapshot(userKey);
      }

      markForceAttemptForBlockedState(userKey, nowMs);
    }

    const requestPromise = (async () => {
      const deviceId = await UserIdentityService.getDeviceId();

      try {
        const query = [
          `userId=${encodeURIComponent(userKey)}`,
          `deviceId=${encodeURIComponent(deviceId)}`,
          `platform=${encodeURIComponent(Platform.OS)}`,
        ].join('&');

        const response = await fetch(`${baseUrl}/api/me/entitlements?${query}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Alert-Device-Id': deviceId,
          },
        });

        if (!response.ok) {
          throw new Error(`entitlement_http_${response.status}`);
        }

        const json = (await response.json()) as any;
        const isPremium = Boolean(json?.premium ?? json?.entitlements?.premium);
        const starlinkConnectEnabled = Boolean(json?.featureFlags?.starlinkConnect);
        const starlinkTunnelBetaEnabled = Boolean(json?.featureFlags?.starlinkTunnelBeta);
        const starlinkExclusiveEnabled = Boolean(json?.featureFlags?.starlinkExclusive);
        const releaseReasonCodes = Array.isArray(json?.release?.reasonCodes)
          ? json.release.reasonCodes.filter((item: unknown) => typeof item === 'string')
          : [];
        const plan =
          json?.plan === 'premium' || json?.plan === 'free'
            ? json.plan
            : isPremium
              ? 'premium'
              : 'free';

        const snapshot: EntitlementSnapshot = {
          userId: String(json?.userId || userKey),
          plan,
          isPremium,
          premium: isPremium,
          featureFlags: {
            starlinkConnectEnabled,
            starlinkTunnelBetaEnabled,
            starlinkExclusiveEnabled,
            sosEnhancementsEnabled: Boolean(json?.featureFlags?.sosEnhancements),
            mapsEnabled: Boolean(json?.featureFlags?.maps),
            weatherEnabled: Boolean(json?.featureFlags?.weather),
            alertsEnabled: Boolean(json?.featureFlags?.alerts),
            aiChatEnabled: Boolean(json?.featureFlags?.aiChat),
            externalIntegrationsEnabled: Boolean(
              json?.featureFlags?.externalIntegrations,
            ),
          },
          release: json?.release
            ? {
                releaseVersion: String(json.release.releaseVersion || ''),
                canaryPercent: Number(json.release.canaryPercent || 0),
                inCanary: Boolean(json.release.inCanary),
                killSwitchActive: Boolean(json.release.killSwitchActive),
                rollbackRecommended: Boolean(json.release.rollbackRecommended),
                degradedMode: Boolean(json.release.degradedMode),
                reasonCodes: releaseReasonCodes,
                expiresAt: String(
                  json.release.expiresAt || nowIsoPlus(ENTITLEMENT_CACHE_TTL_MS),
                ),
              }
            : null,
          limits: {
            monitoring: {
              maxRadiusKm: Number(json?.limits?.monitoring?.maxRadiusKm || 35),
              maxItems: Number(json?.limits?.monitoring?.maxItems || 90),
              refreshFloorSec: Number(
                json?.limits?.monitoring?.refreshFloorSec || 60,
              ),
            },
            epidemic: {
              maxWindow:
                json?.limits?.epidemic?.maxWindow === 'all' ? 'all' : '7d',
            },
            weather: {
              minRefreshSec: Number(
                json?.limits?.weather?.minRefreshSec || 120,
              ),
            },
          },
          costGates: {
            realtimeRiskFeed:
              json?.costGates?.realtimeRiskFeed !== false,
            extendedMonitoring: Boolean(json?.costGates?.extendedMonitoring),
            epidemicAllWindow: Boolean(json?.costGates?.epidemicAllWindow),
            highFrequencyPolling: Boolean(
              json?.costGates?.highFrequencyPolling,
            ),
          },
          degradedMode: Boolean(json?.degradedMode),
          reasonCodes: Array.isArray(json?.reasonCodes)
            ? json.reasonCodes.filter((item: unknown) => typeof item === 'string')
            : [],
          expiresAt: String(json?.expiresAt || nowIsoPlus(ENTITLEMENT_CACHE_TTL_MS)),
          source: 'network',
        };

        const cachePayload: EntitlementCachePayload = {
          savedAtMs: Date.now(),
          data: snapshot,
        };
        await AsyncStorage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(cachePayload));
        resetFailureState(userKey);

        return snapshot;
      } catch (error) {
        const cached = await readCachedPayload(false);
        const hasCache = Boolean(cached);

        if (isRecoverableEntitlementError(error)) {
          const nextFailureState = registerRecoverableFailure(userKey);
          trackFallbackTelemetry(getRecoverableReason(error), nextFailureState, hasCache);
          if (cached) return cacheToSnapshot(cached);
          return defaultSnapshot(userKey);
        }

        warnUnexpectedOnce(error);
        trackFallbackTelemetry('unexpected', getFailureState(userKey), hasCache);
        if (cached) return cacheToSnapshot(cached);
        return defaultSnapshot(userKey);
      } finally {
        inFlightByUserKey.delete(userKey);
      }
    })();

    inFlightByUserKey.set(userKey, requestPromise);
    return requestPromise;
  },
};
