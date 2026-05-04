/**
 * SECURITY CONTEXT - Real-time Monitoring State
 *
 * Manages location tracking, risk assessment, and SOS dispatch.
 * Integrates Geolocation API with risk-level analysis.
 *
 * STATE MODEL:
 * - isActive: Whether monitoring is enabled
 * - location: Current coordinates (lat/lon) + speed
 * - locationName: Human-readable address (for emergency dispatchers)
 * - riskLevel: low|medium|high (updated by AI analysis or user input)
 * - isMoving: true if speed > 15 km/h (indicates user is traveling)
 *
 * LOCATION TRACKING:
 * - Requires ACCESS_FINE_LOCATION permission (Android API 23+)
 * - Updates every 3 seconds (interval: 3000) or 5m distance change
 * - Uses GPS (enableHighAccuracy: true) for emergency precision
 * - Background capable (even when app is minimized)
 *
 * SOS FLOW:
 * 1. User presses SOS button
 * 2. triggerSecureSOS() called
 * 3. Crystals-Kybes relay/integrity protection applied to SOS payload
 * 4. In-app SOS sent to guardians with precise location
 * 5. Return accepted/delivery status
 *
 * PERFORMANCE:
 * - Location updates: <500ms per cycle
 * - GPS accuracy: ±5-10m (depends on environment)
 * - Battery impact: ~5-10% per hour (continuous GPS)
 *
 * COMPLIANCE:
 * - Location is PII (never logged in plaintext)
 * - Permission check required (user can deny)
 * - Geofencing: Not implemented (future feature)
 */

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {Alert, InteractionManager} from 'react-native';
import {
  LocationPrecision,
  LOCATION_PRECISION_THRESHOLD_M,
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
  isPreciseLocation,
} from '../utils/locationQuality';
import type {SosDispatchResult} from '../services/SosDispatchService';
import {describeAlertApiConfig} from '../core/config';
import {
  logSosDiagnostic,
  summarizeError,
} from '../observability/SosDiagnostics';

const LAST_LOCATION_KEY = '@Alert:LastLocation';
const LAST_LOCATION_NAME_KEY = '@Alert:LastLocationName';
const LOCATION_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const IMPRECISE_ATTEMPT_WINDOW_MS = 30 * 1000;
const IMPRECISE_PROMPT_COOLDOWN_MS = 2 * 60 * 1000;

type GeoPositionLike = {
  coords?: {
    latitude?: number;
    longitude?: number;
    speed?: number | null;
    accuracy?: number | null;
  };
  timestamp?: number | string | Date;
};

type GeoErrorLike = {
  code?: number;
  message?: string;
};

const getAsyncStorage = () =>
  require('@react-native-async-storage/async-storage').default;
const getGeolocation = () =>
  require('react-native-geolocation-service').default;
const getPermissionManager = () =>
  require('../utils/permissions').PermissionManager;
const getSosDispatchService = () =>
  require('../services/SosDispatchService').SosDispatchService;
const getProfileService = () =>
  require('../services/ProfileService').ProfileService;
const getKyberNetworkService = () =>
  require('../services/KyberNetworkService').KyberNetworkService;
const getReverseGeocodeService = () =>
  require('../services/ReverseGeocodeService').ReverseGeocodeService;
const getTelemetryService = () =>
  require('../services/TelemetryService').TelemetryService;
const getNormalizeToIsoDateTime = () =>
  require('../utils/dateTimeFormat').normalizeToIsoDateTime;
const getI18n = () => require('../i18n').default;

const toCityOnlyLabel = (raw?: string | null) => {
  if (!raw) return '';
  const normalized = String(raw).trim();
  if (!normalized) return '';
  return normalized.split(',')[0].replace(/\s+/g, ' ').trim();
};

type RiskLevel = 'low' | 'medium' | 'high';
type LocationProvider = 'gps' | 'network' | 'fused' | 'unknown';

interface LocationData {
  latitude: number;
  longitude: number;
  speed?: number | null;
  accuracy?: number | null;
  timestamp?: string;
}

interface SecurityState {
  isActive: boolean;
  location: LocationData | null;
  locationName: string;
  locationCountryCode: string | null;
  riskLevel: RiskLevel;
  isMoving: boolean;
  panicHold: boolean;
  locationAccuracyMeters: number | null;
  locationTimestamp?: string;
  locationPrecision: LocationPrecision;
  locationProvider?: LocationProvider;
}

interface SecurityContextData {
  securityState: SecurityState;
  triggerSecureSOS: () => Promise<SosDispatchResult>;
  updateRiskLevel: (level: RiskLevel) => void;
  setPanicHold: (active: boolean) => void;
  requestPreciseFixNow: () => Promise<LocationPrecision>;
}

export const SecurityContext = createContext<SecurityContextData>(
  {} as SecurityContextData,
);

export const SecurityProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [securityState, setSecurityState] = useState<SecurityState>({
    isActive: true,
    location: null,
    locationName: '',
    locationCountryCode: null,
    riskLevel: 'low',
    isMoving: false,
    panicHold: false,
    locationAccuracyMeters: null,
    locationTimestamp: undefined,
    locationPrecision: 'none',
    locationProvider: 'unknown',
  });
  const lastGeocodeRef = useRef<{ts: number; lat: number; lon: number} | null>(
    null,
  );
  const lastPreciseLocationRef = useRef<LocationData | null>(null);
  const lastLocationNameRef = useRef<string>('');
  const impreciseAttemptRef = useRef<{
    firstTs: number;
    count: number;
    lastPromptTs: number;
  }>({
    firstTs: 0,
    count: 0,
    lastPromptTs: 0,
  });

  const distanceKm = useCallback(
    (a: {lat: number; lon: number}, b: {lat: number; lon: number}) => {
      const toRad = (v: number) => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) *
          Math.cos(lat2) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      return 2 * R * Math.asin(Math.sqrt(h));
    },
    [],
  );

  const updateLocationName = useCallback(
    async (lat: number, lon: number) => {
      const ReverseGeocodeService = getReverseGeocodeService();
      const AsyncStorage = getAsyncStorage();
      if (!isFiniteCoordinatePair(lat, lon)) return;
      const now = Date.now();
      const last = lastGeocodeRef.current;
      const minGeocodeIntervalMs = 60 * 1000;
      const minMoveForRefreshKm = 0.12;
      if (last) {
        const elapsed = now - last.ts;
        const movedKm = distanceKm({lat, lon}, {lat: last.lat, lon: last.lon});
        if (elapsed < minGeocodeIntervalMs && movedKm < minMoveForRefreshKm) {
          return;
        }
      }
      lastGeocodeRef.current = {ts: now, lat, lon};

      const geo = await ReverseGeocodeService.reverse(lat, lon);
      if (!geo) return;
      const cityOnly = toCityOnlyLabel(geo.cityName);
      const countryCode =
        typeof geo.countryCode === 'string' &&
        geo.countryCode.trim().length === 2
          ? geo.countryCode.trim().toUpperCase()
          : null;

      if (!cityOnly && !countryCode) return;
      if (cityOnly) {
        lastLocationNameRef.current = cityOnly;
      }
      setSecurityState(prev =>
        prev.locationName === cityOnly &&
        prev.locationCountryCode === countryCode
          ? prev
          : {
              ...prev,
              locationName: cityOnly || prev.locationName,
              locationCountryCode: countryCode,
            },
      );
      if (cityOnly) {
        AsyncStorage.setItem(LAST_LOCATION_NAME_KEY, cityOnly).catch(() => {
          // ignore storage errors
        });
      }
    },
    [distanceKm],
  );

  const requestLocationPermission = useCallback(async () => {
    try {
      const PermissionManager = getPermissionManager();
      const status = await PermissionManager.requestLocationPermission();
      return status === 'granted';
    } catch (err) {
      console.error('[SecurityContext] Permission error:', err);
      return false;
    }
  }, []);

  const maybePromptForPreciseLocation = useCallback(() => {
    const TelemetryService = getTelemetryService();
    const PermissionManager = getPermissionManager();
    const i18n = getI18n();
    const now = Date.now();
    const attempt = impreciseAttemptRef.current;

    if (
      !attempt.firstTs ||
      now - attempt.firstTs > IMPRECISE_ATTEMPT_WINDOW_MS
    ) {
      attempt.firstTs = now;
      attempt.count = 1;
    } else {
      attempt.count += 1;
    }

    const canPromptAgain =
      now - attempt.lastPromptTs >= IMPRECISE_PROMPT_COOLDOWN_MS;
    if (attempt.count < 2 || !canPromptAgain) return;

    attempt.lastPromptTs = now;
    TelemetryService.trackEvent('location_precision_required_shown');
    Alert.alert(
      i18n.t('location_precision_required_title', {
        defaultValue: 'Precise location required',
      }),
      i18n.t('location_precision_required_body', {
        defaultValue:
          'We need precise GPS to show your real position. Turn on precise location and move to an open area.',
      }),
      [
        {
          text: i18n.t('common_cancel', {defaultValue: 'Cancel'}),
          style: 'cancel',
        },
        {
          text: i18n.t('location_open_settings', {
            defaultValue: 'Open Settings',
          }),
          onPress: () => {
            TelemetryService.trackEvent('location_settings_opened_from_prompt');
            PermissionManager.openSettings();
          },
        },
      ],
    );
  }, []);

  const handlePositionUpdate = useCallback(
    (
      position: GeoPositionLike,
      source: 'watch' | 'manual' | 'cache' = 'watch',
    ): LocationPrecision => {
      const TelemetryService = getTelemetryService();
      const AsyncStorage = getAsyncStorage();
      const normalizeToIsoDateTime = getNormalizeToIsoDateTime();
      const latitude = Number(position?.coords?.latitude);
      const longitude = Number(position?.coords?.longitude);
      if (!isFiniteCoordinatePair(latitude, longitude)) return 'none';

      const speedMs =
        typeof position?.coords?.speed === 'number' &&
        Number.isFinite(position.coords.speed)
          ? position.coords.speed
          : 0;
      const speedKmh = Math.max(0, speedMs * 3.6);
      const accuracy =
        typeof position?.coords?.accuracy === 'number' &&
        Number.isFinite(position.coords.accuracy)
          ? Math.max(0, Number(position.coords.accuracy))
          : null;
      const locationTimestamp =
        normalizeToIsoDateTime(position?.timestamp) ||
        normalizeToIsoDateTime(new Date()) ||
        new Date().toISOString();
      const provider: LocationProvider = 'unknown';

      const snapshot = {
        latitude,
        longitude,
        speed: speedKmh,
        accuracy,
        timestamp: locationTimestamp,
      };

      const precise = isPreciseLocation(
        accuracy,
        LOCATION_PRECISION_THRESHOLD_M,
      );
      if (!precise) {
        setSecurityState(prev => ({
          ...prev,
          location: snapshot,
          isMoving: speedKmh > 15,
          locationPrecision: 'imprecise',
          locationAccuracyMeters: accuracy,
          locationTimestamp,
          locationProvider: provider,
        }));
        AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(snapshot)).catch(
          () => {
            // ignore storage errors
          },
        );
        TelemetryService.trackEvent('location_fix_rejected_imprecise', {
          accuracyMeters: accuracy,
          thresholdMeters: LOCATION_PRECISION_THRESHOLD_M,
          sourceScreen: source,
        });
        if (source === 'manual') {
          maybePromptForPreciseLocation();
        }
        return 'imprecise';
      }

      lastPreciseLocationRef.current = snapshot;
      setSecurityState(prev => ({
        ...prev,
        isMoving: speedKmh > 15,
        location: snapshot,
        locationPrecision: 'precise',
        locationAccuracyMeters: accuracy,
        locationTimestamp,
        locationProvider: provider,
      }));
      AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(snapshot)).catch(
        () => {
          // ignore storage errors
        },
      );
      TelemetryService.trackEvent('location_fix_received', {
        screen: source,
        city: lastLocationNameRef.current || undefined,
        accuracyMeters: accuracy,
        isPrecise: true,
        provider,
        sourceScreen: source,
      });
      void updateLocationName(latitude, longitude);
      return 'precise';
    },
    [maybePromptForPreciseLocation, updateLocationName],
  );

  const requestPreciseFixNow =
    useCallback(async (): Promise<LocationPrecision> => {
      const Geolocation = getGeolocation();
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) {
        return 'none';
      }

      return new Promise(resolve => {
        Geolocation.getCurrentPosition(
          (position: GeoPositionLike) => {
            const precision = handlePositionUpdate(position, 'manual');
            resolve(precision);
          },
          () => {
            if (lastPreciseLocationRef.current) {
              resolve('precise');
              return;
            }
            setSecurityState(prev => ({
              ...prev,
              locationPrecision:
                prev.locationPrecision === 'precise' ? 'precise' : 'none',
            }));
            resolve('none');
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
            forceRequestLocation: true,
            showLocationDialog: true,
            forceLocationManager: false,
            accuracy: {android: 'high', ios: 'bestForNavigation'},
          },
        );
      });
    }, [handlePositionUpdate, requestLocationPermission]);

  useEffect(() => {
    const Geolocation = getGeolocation();
    const hydrateFromCache = async () => {
      const AsyncStorage = getAsyncStorage();
      const normalizeToIsoDateTime = getNormalizeToIsoDateTime();
      const i18n = getI18n();
      try {
        const [cachedLocationRaw, cachedLocationName] = await Promise.all([
          AsyncStorage.getItem(LAST_LOCATION_KEY),
          AsyncStorage.getItem(LAST_LOCATION_NAME_KEY),
        ]);
        const parsed = cachedLocationRaw ? JSON.parse(cachedLocationRaw) : null;
        const normalizedCachedName = toCityOnlyLabel(cachedLocationName);
        const isValidCachedName =
          normalizedCachedName.length > 0 &&
          normalizedCachedName !== i18n.t('monitoring_title') &&
          normalizedCachedName !== i18n.t('gps_off') &&
          normalizedCachedName !== '...';
        if (isValidCachedName)
          lastLocationNameRef.current = normalizedCachedName;
        setSecurityState(prev => ({
          ...prev,
          location: prev.location,
          locationName: isValidCachedName
            ? normalizedCachedName
            : prev.locationName,
        }));

        const cachedLatitude = Number(parsed?.latitude);
        const cachedLongitude = Number(parsed?.longitude);
        const cachedAccuracy =
          typeof parsed?.accuracy === 'number' &&
          Number.isFinite(parsed.accuracy)
            ? Number(parsed.accuracy)
            : null;
        const cachedTimestamp = normalizeToIsoDateTime(parsed?.timestamp);
        const ageMs =
          cachedTimestamp &&
          Number.isFinite(new Date(cachedTimestamp).getTime())
            ? Date.now() - new Date(cachedTimestamp).getTime()
            : Number.POSITIVE_INFINITY;
        const cacheIsFresh = ageMs >= 0 && ageMs <= LOCATION_CACHE_MAX_AGE_MS;
        const cacheHasUsableCoords =
          isFiniteCoordinatePair(cachedLatitude, cachedLongitude) &&
          cacheIsFresh;
        const cacheIsPrecise =
          cacheHasUsableCoords &&
          isPreciseLocation(cachedAccuracy, LOCATION_PRECISION_THRESHOLD_M);

        if (cacheHasUsableCoords) {
          const cachedLocation: LocationData = {
            latitude: cachedLatitude,
            longitude: cachedLongitude,
            speed:
              typeof parsed?.speed === 'number' && Number.isFinite(parsed.speed)
                ? parsed.speed
                : null,
            accuracy: cachedAccuracy,
            timestamp: cachedTimestamp || undefined,
          };
          if (cacheIsPrecise) {
            lastPreciseLocationRef.current = cachedLocation;
          }
          setSecurityState(prev => ({
            ...prev,
            location: cachedLocation,
            locationPrecision: cacheIsPrecise ? 'precise' : 'imprecise',
            locationAccuracyMeters: cachedAccuracy,
            locationTimestamp: cachedTimestamp || undefined,
            locationProvider: 'unknown',
          }));
          if (!isValidCachedName) {
            void updateLocationName(cachedLatitude, cachedLongitude);
          }
        } else {
          setSecurityState(prev => ({
            ...prev,
            location: null,
            locationPrecision: 'none',
            locationAccuracyMeters: cachedAccuracy,
            locationTimestamp: cachedTimestamp || undefined,
            locationProvider: 'unknown',
          }));
        }
      } catch {
        // ignore hydrate errors
      }
    };

    let watchId: number;
    const initGPS = async () => {
      const PermissionManager = getPermissionManager();
      await hydrateFromCache();
      const locationPermission =
        await PermissionManager.checkLocationPermission();
      if (locationPermission === 'granted') {
        await requestPreciseFixNow();

        watchId = Geolocation.watchPosition(
          (position: GeoPositionLike) => {
            void handlePositionUpdate(position, 'watch');
          },
          (error: GeoErrorLike) => {
            if (__DEV__) {
              console.log('[GPS Sync]:', error.message);
            }
          },
          {
            enableHighAccuracy: true,
            distanceFilter: 10,
            interval: 5000,
            fastestInterval: 3000,
            forceRequestLocation: true,
            showLocationDialog: true,
            forceLocationManager: false,
            accuracy: {android: 'high', ios: 'bestForNavigation'},
          },
        );
      }
    };
    const task = InteractionManager.runAfterInteractions(() => {
      void initGPS();
    });
    return () => {
      if (typeof (task as any)?.cancel === 'function') {
        (task as any).cancel();
      }
      if (watchId !== undefined) Geolocation.clearWatch(watchId);
    };
  }, [requestPreciseFixNow, handlePositionUpdate, updateLocationName]);

  useEffect(() => {
    let cancelled = false;
    let delayId: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      delayId = setTimeout(() => {
        if (cancelled) return;
        const KyberNetworkService = getKyberNetworkService();
        KyberNetworkService.startAutoFlush();
        void KyberNetworkService.flushPending();
      }, 1500);
    });
    return () => {
      cancelled = true;
      if (typeof (task as any)?.cancel === 'function') {
        (task as any).cancel();
      }
      if (delayId) {
        clearTimeout(delayId);
      }
      try {
        getKyberNetworkService().stopAutoFlush();
      } catch {
        // ignore cleanup failures
      }
    };
  }, []);

  const updateRiskLevel = (level: RiskLevel) => {
    setSecurityState(prev => ({...prev, riskLevel: level}));
  };

  const setPanicHold = (active: boolean) => {
    setSecurityState(prev =>
      prev.panicHold === active ? prev : {...prev, panicHold: active},
    );
  };

  const triggerSecureSOS = async (): Promise<SosDispatchResult> => {
    try {
      const AsyncStorage = getAsyncStorage();
      const ProfileService = getProfileService();
      const SosDispatchService = getSosDispatchService();
      const i18n = getI18n();
      const guardiansRaw = await AsyncStorage.getItem('@guardians_list');
      const guardians = guardiansRaw
        ? JSON.parse(guardiansRaw)
            .map((item: any) => ({
              id:
                typeof item?.id === 'string' && item.id.trim().length > 0
                  ? item.id.trim()
                  : undefined,
              remoteId:
                typeof item?.remoteId === 'string'
                  ? item.remoteId.trim()
                  : undefined,
              phone:
                typeof item?.phone === 'string' && item.phone.trim().length > 0
                  ? item.phone.trim()
                  : undefined,
              name:
                typeof item?.name === 'string' && item.name.trim().length > 0
                  ? item.name.trim()
                  : i18n.t('guardian_label', {defaultValue: 'Guardian'}),
            }))
            .filter(
              (item: {
                id?: string;
                remoteId?: string;
                phone?: string;
                name: string;
              }) => item.name.length > 0,
            )
        : [];
      const deliverableGuardianCount = guardians.filter(
        (item: {
          id?: string;
          remoteId?: string;
          phone?: string;
          name: string;
        }) => Boolean(item.remoteId) || Boolean(item.phone) || Boolean(item.id),
      ).length;
      logSosDiagnostic('triggerSecureSOS:start', {
        guardianCount: guardians.length,
        deliverableGuardianCount,
        hasCurrentLocation: Boolean(securityState.location),
        hasLocationName: Boolean(
          securityState.locationName || lastLocationNameRef.current,
        ),
        api: describeAlertApiConfig(),
      });
      if (guardians.length === 0) {
        logSosDiagnostic('triggerSecureSOS:proceeding_without_guardians', {
          reason: 'no_guardians',
        });
      }
      const profile = await ProfileService.getProfile();
      let dispatchLocation = securityState.location;
      if (!canUseLocationForRiskMaps(securityState) || !dispatchLocation) {
        const precision = await requestPreciseFixNow();
        if (precision !== 'precise' || !lastPreciseLocationRef.current) {
          logSosDiagnostic('triggerSecureSOS:blocked', {
            reason: 'precise_location_required',
            precision,
          });
          Alert.alert(
            i18n.t('location_precision_required_title', {
              defaultValue: 'Precise location required',
            }),
            i18n.t('location_precision_required_body', {
              defaultValue:
                'We need precise GPS to send SOS with your exact location.',
            }),
          );
          return {
            accepted: false,
            delivered: false,
            queued: false,
            viaKyber: false,
            viaGuardians: false,
            viaConversation: false,
            integrityProtected: false,
          };
        }
        dispatchLocation = lastPreciseLocationRef.current;
      }
      const result = await SosDispatchService.dispatchFromApp({
        location: dispatchLocation,
        locationName: securityState.locationName || lastLocationNameRef.current,
        senderName: profile.name,
        guardians,
      });
      logSosDiagnostic('triggerSecureSOS:result', {
        accepted: result.accepted,
        delivered: result.delivered,
        queued: result.queued,
        viaKyber: result.viaKyber,
        viaGuardians: result.viaGuardians,
        viaConversation: result.viaConversation,
        integrityProtected: result.integrityProtected,
      });
      if (!result.accepted) {
        Alert.alert(i18n.t('sos_failed_title'), i18n.t('sos_failed_body'));
      }
      return result;
    } catch (error) {
      console.error('[SecurityContext] SOS error:', error);
      logSosDiagnostic('triggerSecureSOS:error', {
        error: summarizeError(error),
      });
      const i18n = getI18n();
      Alert.alert(i18n.t('sos_failed_title'), i18n.t('sos_failed_body'));
      return {
        accepted: false,
        delivered: false,
        queued: false,
        viaKyber: false,
        viaGuardians: false,
        viaConversation: false,
        integrityProtected: false,
      };
    }
  };

  const contextValue = useMemo(
    () => ({
      securityState,
      triggerSecureSOS,
      updateRiskLevel,
      setPanicHold,
      requestPreciseFixNow,
    }),
    [requestPreciseFixNow, securityState],
  );

  return (
    <SecurityContext.Provider value={contextValue}>
      {children}
    </SecurityContext.Provider>
  );
};

export const useSecurity = () => {
  const context = useContext(SecurityContext);
  if (!context)
    throw new Error('useSecurity must be used within SecurityProvider');
  return context;
};
