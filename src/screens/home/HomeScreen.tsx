/**
 * HOME SCREEN - Main Dashboard
 *
 * Primary user interface showing safety status, alerts, widgets.
 * Displays real-time risk assessment, weather, emergency contacts.
 *
 * LAYOUT STRUCTURE:
 * - Header: Brand identity + notification/menu buttons
 * - Status Bar: Current safety score, quick-stats
 * - Widgets: Weather, Risk map, Recent alerts
 * - Action Buttons: Quick access to guardians, settings
 *
 * INFORMATION ARCHITECTURE:
 * - Information scent: Users find safety status within 1 second
 * - Progressive disclosure: Tap widget for detailed view
 * - Gesture support: Pull-to-refresh reloads weather/maps
 *
 * PERFORMANCE:
 * - LazyLoad widgets (don't fetch until visible)
 * - Memoize heavy components (WeatherWidget, RiskMapWidget)
 * - Pagination for alert history
 *
 * ACCESSIBILITY:
 * - High contrast VIVID_RED for SOS button
 * - Dark mode support via ThemeContext
 * - i18n translations (all strings use t() function)
 *
 * STATE MANAGEMENT:
 * - Minimal local state (refreshing flag only)
 * - Data from context providers (ThemeContext, SecurityContext)
 * - No Redux dependency (prefer composition)
 */

import React, {useState, useCallback, useEffect, useMemo, useRef} from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
  Alert,
  Platform,
  AccessibilityInfo,
  Image,
  InteractionManager,
  Animated,
} from 'react-native';
import AppText from '../../components/ui/AppText';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useTheme} from '../../context/ThemeContext';
import {useTranslation} from 'react-i18next';
import {getLocales} from 'react-native-localize';
import {
  AlertBrainBriefingReadModel,
  createInitialAlertBrainBriefingReadModel,
} from '../../domain/trust/AlertBrainBriefing';
import {OperationalSnapshotReadModel} from '../../domain/trust/OperationalSnapshot';
import {useSecurity} from '../../context/SecurityContext';
import {
  PermissionManager,
  type PermissionStatus,
} from '../../utils/permissions';
import {
  getHomeLocationBannerState,
  shouldAutoRequestLocationPermission,
} from '../../utils/locationAccess';
import {AlertNotification} from '../../types/notifications';
import {GetHomeRiskSnapshotQuery} from '../../application/queries/GetHomeRiskSnapshotQuery';
import {GetAlertBrainBriefingQuery} from '../../application/queries/GetAlertBrainBriefingQuery';
import {NotificationService} from '../../services/NotificationService';
import {ImportantAlertsService} from '../../services/ImportantAlertsService';
import {TelemetryService} from '../../services/TelemetryService';
import {ThemeTokens} from '../../constants/ThemeTokens';
import {resolveLocale, resolveTimeZone} from '../../utils/dateTimeFormat';
import {performance} from '../../utils/performance';
import {runRefreshWithTimeout} from '../../utils/refreshTimeout';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';
import {NotificationCenterState} from '../../services/importantAlertUtils';
import type {
  HomeRankedRisk,
  HomeRiskNature,
  HomeSafetyState,
} from '../../domain/home/HomeRiskSnapshot';
import {RootStackParamList} from '../../navigation/types';
// FAANG Fase 2: Home Instantânea com cache
import {
  HomeInstantCache,
  FreshnessState,
} from '../../infrastructure/cache/HomeInstantCache';
import {FeatureFlags} from '../../core/featureFlags';

const {width, height} = Dimensions.get('window');
const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;
const SOS_GLOW_SIZE = width * 0.86;
const SOS_SHELL_SIZE = width * 0.74;
const SOS_PULSE_SIZE = width * 0.7;
const SOS_BUTTON_SIZE = width * 0.6;
const SOS_INNER_RING_SIZE = width * 0.66;
const SOS_GLOW_SCALE = 1.02;
const SOS_PULSE_SCALE = 1.04;
const SOS_ACTIVE_RESET_MS = 8000;
const withAlpha = (color: string, alpha: number) => {
  if (!color) return `rgba(0,0,0,${alpha})`;
  if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
  if (!color.startsWith('#') || color.length !== 7) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
const getWeatherWidget = () =>
  require('../../components/home/WeatherWidget').WeatherWidget;
const getRiskMapWidget = () =>
  require('../../components/home/RiskMapWidget').RiskMapWidget;
const triggerHeavyHaptic = () => {
  try {
    const moduleRef = require('react-native-haptic-feedback');
    const ReactNativeHapticFeedback = moduleRef.default || moduleRef;
    ReactNativeHapticFeedback.trigger(ThemeTokens.haptics.heavy);
  } catch {
    // ignore haptic bootstrap failures
  }
};

const getRiskScore = (riskLevel: 'low' | 'medium' | 'high'): number => {
  if (riskLevel === 'high') return 0.8;
  if (riskLevel === 'medium') return 0.55;
  return 0.2;
};

const WEATHER_THREAT_CATEGORIES = new Set([
  'storm',
  'lightning',
  'hurricane',
  'tornado',
  'hail',
  'snowstorm',
  'flood',
]);

const isWeatherThreatCategory = (value?: string) =>
  WEATHER_THREAT_CATEGORIES.has(
    String(value || '')
      .trim()
      .toLowerCase(),
  );

const normalizeHomeRiskNature = (value: unknown): HomeRiskNature => {
  if (value === 'observed' || value === 'forecast') return value;
  return 'observed'; // fallback seguro
};

const guessRealtimeCategoryFromAlert = (title: string): string | undefined => {
  const t = String(title || '').toLowerCase();
  if (!t) return undefined;
  if (t.includes('pandem') || t.includes('covid')) return 'pandemic';
  if (t.includes('epidem') || t.includes('influenza') || t.includes('gripe'))
    return 'epidemic';
  if (t.includes('energia') || t.includes('power')) return 'energy_outage';
  if (t.includes('agua') || t.includes('água') || t.includes('water'))
    return 'water_outage';
  if (t.includes('terremoto') || t.includes('earthquake')) return 'earthquake';
  if (t.includes('inunda') || t.includes('alag') || t.includes('flood'))
    return 'flood';
  if (t.includes('tempest') || t.includes('storm')) return 'storm';
  if (t.includes('raio') || t.includes('lightning')) return 'lightning';
  if (t.includes('vento') || t.includes('vendaval') || t.includes('wind'))
    return 'wind';
  if (t.includes('sos')) return 'storm';
  return undefined;
};

const inferWeatherThreatCategory = (
  ...values: Array<string | undefined>
): string | undefined => {
  for (const rawValue of values) {
    const directCategory = guessRealtimeCategoryFromAlert(
      String(rawValue || ''),
    );
    if (isWeatherThreatCategory(directCategory)) {
      return directCategory;
    }

    const text = String(rawValue || '').toLowerCase();
    if (
      text.includes('thunder') ||
      text.includes('trov') ||
      text.includes('hail') ||
      text.includes('granizo')
    ) {
      return 'lightning';
    }
    if (
      text.includes('tornado') ||
      text.includes('hurricane') ||
      text.includes('furac') ||
      text.includes('cyclone') ||
      text.includes('ciclone')
    ) {
      return 'storm';
    }
  }
  return undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const HomeScreen: React.FC<Props> = ({navigation}) => {
  const {colors, isDark} = useTheme();
  const {t, i18n} = useTranslation();
  const {securityState, triggerSecureSOS, setPanicHold, requestPreciseFixNow} =
    useSecurity();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [prioritizedRisks, setPrioritizedRisks] = useState<HomeRankedRisk[]>(
    [],
  );
  const [hasUnavailableMonitoringData, setHasUnavailableMonitoringData] =
    useState(false);
  const [operationalModel, setOperationalModel] =
    useState<OperationalSnapshotReadModel>({
      snapshot: null,
      state: 'loading',
      stale: true,
      errorCode: 'initial',
    });
  const [brainBriefing, setBrainBriefing] =
    useState<AlertBrainBriefingReadModel>(
      createInitialAlertBrainBriefingReadModel(),
    );
  const [notificationCenterState, setNotificationCenterState] =
    useState<NotificationCenterState>({
      unreadCount: 0,
      importantAlerts: [],
    });
  const [refreshToken, setRefreshToken] = useState(0);
  const [fastStartReady, setFastStartReady] = useState(false);
  const [refreshA11yMessage, setRefreshA11yMessage] = useState('');
  const [homeLocationPermissionStatus, setHomeLocationPermissionStatus] =
    useState<PermissionStatus>('denied');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sosPressing, setSosPressing] = useState(false);
  const [sosSendState, setSosSendState] = useState<
    'idle' | 'sending' | 'active'
  >('idle');
  // FAANG Fase 2: Estados para Home Instantânea com cache
  const [cacheFreshness, setCacheFreshness] =
    useState<FreshnessState>('missing');
  const [isUsingCache, setIsUsingCache] = useState(false);
  const [cacheLastUpdatedAt, setCacheLastUpdatedAt] = useState<number>(0);
  const sosHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosActiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosPulseAnim = useRef(new Animated.Value(0)).current;
  const sosGlowAnim = useRef(new Animated.Value(0)).current;
  const sosPressAnim = useRef(new Animated.Value(0)).current;
  const isMountedRef = useRef(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRefreshRunRef = useRef<(() => void) | null>(null);
  const refreshRunRef = useRef(0);
  const refreshRequestTokenRef = useRef(0);
  const initialDataLoadRef = useRef(false);
  const locationPromptRequestedRef = useRef(false);
  const deferredBriefingTaskRef = useRef<{cancel?: () => void} | null>(null);
  const deferredBriefingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const localeTag = useMemo(
    () =>
      resolveLocale(
        i18n.resolvedLanguage ||
          i18n.language ||
          getLocales()?.[0]?.languageTag ||
          'pt-BR',
      ),
    [i18n.language, i18n.resolvedLanguage],
  );

  const messagesBarVisual = useMemo(
    () =>
      isDark
        ? {
            key: 'dark',
            backgroundColor: '#1B1B1D',
            borderColor: 'rgba(255,255,255,0.10)',
            textColor: '#FFFFFF',
            iconColor: '#FFFFFF',
            shadowColor: '#000000',
          }
        : {
            key: 'light',
            backgroundColor: '#FFFFFF',
            borderColor: 'rgba(17,17,17,0.08)',
            textColor: '#111111',
            iconColor: '#111111',
            shadowColor: 'rgba(17,17,17,0.18)',
          },
    [isDark],
  );
  const locationBannerState = useMemo(
    () => getHomeLocationBannerState(homeLocationPermissionStatus),
    [homeLocationPermissionStatus],
  );
  const timeZone = useMemo(() => resolveTimeZone(), []);
  const isCompactScreen = height < 780;
  const showMap = fastStartReady;
  const WeatherWidgetComponent = useMemo(
    () => (fastStartReady ? getWeatherWidget() : null),
    [fastStartReady],
  );
  const RiskMapWidgetComponent = useMemo(
    () => (showMap ? getRiskMapWidget() : null),
    [showMap],
  );

  const riskScore = useMemo(
    () => getRiskScore(securityState.riskLevel),
    [securityState.riskLevel],
  );

  const [safetyCTAState, setSafetyCTAState] = useState<HomeSafetyState>('ok');
  const [statusBarState, setStatusBarState] = useState<HomeSafetyState>('ok');

  const topRisk = useMemo(
    () => prioritizedRisks[0] || null,
    [prioritizedRisks],
  );
  const showHomeMapBar = true;

  const operationalWeatherSignal = useMemo(() => {
    const inferredCategory =
      [
        brainBriefing.recommendedCategory,
        topRisk?.categoryId,
        inferWeatherThreatCategory(
          brainBriefing.headline,
          brainBriefing.summary,
          topRisk?.title,
          topRisk?.summary,
        ),
      ].find(category => isWeatherThreatCategory(category)) || null;

    const hasSupportingEvidence =
      brainBriefing.signalCount > 0 ||
      prioritizedRisks.some(risk => isWeatherThreatCategory(risk.categoryId));

    if (!inferredCategory || !hasSupportingEvidence) {
      return null;
    }

    return {
      icon: 'weather-lightning-rainy',
      label: t(
        inferredCategory === 'lightning'
          ? 'weather_alert_lightning_nearby'
          : 'weather_alert_storm_nearby',
      ),
    };
  }, [
    brainBriefing.headline,
    brainBriefing.recommendedCategory,
    brainBriefing.signalCount,
    brainBriefing.summary,
    prioritizedRisks,
    t,
    topRisk?.categoryId,
    topRisk?.summary,
    topRisk?.title,
  ]);

  const barVisual = useMemo(() => {
    const baseVisual = isDark
      ? {
          backgroundColor: '#111111',
          foregroundColor: '#FFFFFF',
          secondaryColor: 'rgba(255,255,255,0.82)',
          borderColor: 'rgba(255,255,255,0.16)',
          glowColor: 'rgba(255,255,255,0.06)',
          iconWrapColor: 'transparent',
          iconWrapBorderColor: 'rgba(255,255,255,0.16)',
          iconColor: '#FFFFFF',
        }
      : {
          backgroundColor: '#FFFFFF',
          foregroundColor: '#111111',
          secondaryColor: 'rgba(17,17,17,0.78)',
          borderColor: 'rgba(17,17,17,0.12)',
          glowColor: 'rgba(17,17,17,0.04)',
          iconWrapColor: 'transparent',
          iconWrapBorderColor: 'rgba(17,17,17,0.08)',
          iconColor: '#111111',
        };

    return {
      ...baseVisual,
      iconName: statusBarState === 'ok' ? 'shield-check' : 'alert',
    } as const;
  }, [isDark, statusBarState]);

  const barForegroundColor = barVisual.foregroundColor;
  const barSecondaryColor = barVisual.secondaryColor;
  const barBorderColor = barVisual.borderColor;
  const barGlowColor = barVisual.glowColor;
  const barSignalColor = barVisual.iconColor;
  const barIcon = barVisual.iconName;

  const sosVisual = useMemo(() => {
    const activeTone = colors.alert ?? colors.primary;
    const baseTone = colors.primary;
    const state =
      sosSendState === 'sending'
        ? 'sending'
        : sosSendState === 'active'
          ? 'active'
          : securityState.panicHold
            ? 'armed'
            : sosPressing
              ? 'pressed'
              : 'idle';
    const tone = state === 'idle' ? baseTone : activeTone;
    return {
      state,
      tone,
      ring: withAlpha('#8E1627', state === 'active' ? 0.64 : 0.46),
      glow: withAlpha('#5B0814', state === 'active' ? 0.32 : 0.2),
      inner: withAlpha('#FF9AA5', state === 'active' ? 0.34 : 0.2),
      shell: withAlpha(tone, state === 'active' ? 0.2 : 0.13),
      shellBorder: withAlpha('#A31E31', state === 'active' ? 0.42 : 0.28),
      shellInset: withAlpha('#FF6F7E', state === 'active' ? 0.24 : 0.14),
      surfaceBorder:
        state === 'idle'
          ? withAlpha('#FFC2C8', 0.18)
          : withAlpha('#FFE3E6', 0.26),
    } as const;
  }, [
    colors.alert,
    colors.primary,
    isDark,
    securityState.panicHold,
    sosPressing,
    sosSendState,
  ]);

  const barTitle = useMemo(
    () => t('home_alert_map_title', {defaultValue: 'Mapa de Alertas'}),
    [t],
  );

  const barSubtitle = useMemo(() => {
    if (
      hasUnavailableMonitoringData &&
      statusBarState === 'ok' &&
      brainBriefing.signalCount === 0
    ) {
      return t('operational_state_monitoring', {
        defaultValue: 'Monitorando área',
      });
    }
    if (brainBriefing.headline) {
      return brainBriefing.headline;
    }
    if (statusBarState === 'critical') {
      return t('home_alert_map_subtitle_critical', {
        defaultValue: 'Perigo: risco real',
      });
    }
    if (statusBarState === 'warning') {
      return t('home_alert_map_subtitle_warning', {
        defaultValue: 'Atencao: previsao de risco',
      });
    }
    if (
      brainBriefing.state !== 'fresh' ||
      operationalModel.state === 'loading' ||
      operationalModel.state === 'error' ||
      operationalModel.state === 'stale'
    ) {
      return t('operational_state_monitoring', {
        defaultValue: 'Monitorando área',
      });
    }
    return t('home_alert_map_subtitle_ok', {
      defaultValue: 'Tudo seguro por aqui',
    });
  }, [
    brainBriefing.headline,
    brainBriefing.signalCount,
    brainBriefing.state,
    hasUnavailableMonitoringData,
    operationalModel.snapshot,
    operationalModel.state,
    statusBarState,
    t,
  ]);

  const barAccessibilityLabel = useMemo(() => {
    const riskLabel =
      hasUnavailableMonitoringData && statusBarState === 'ok'
        ? t('operational_state_monitoring', {
            defaultValue: 'Monitorando área',
          })
        : statusBarState === 'critical'
          ? t('home_alert_map_subtitle_critical', {
              defaultValue: 'Perigo: risco real',
            })
          : statusBarState === 'warning'
            ? t('home_alert_map_subtitle_warning', {
                defaultValue: 'Atencao: previsao de risco',
              })
            : t('home_alert_map_subtitle_ok', {
                defaultValue: 'Tudo seguro por aqui',
              });
    const freshnessLabel = operationalModel.snapshot
      ? t('operational_freshness_minutes', {
          count: Math.max(
            1,
            Math.round(
              Number(operationalModel.snapshot.freshnessSec || 0) / 60,
            ),
          ),
          defaultValue: `Updated ${Math.max(1, Math.round(Number(operationalModel.snapshot.freshnessSec || 0) / 60))} min ago`,
        })
      : '';
    const briefingLabel = brainBriefing.summary || barSubtitle;
    const primaryRiskLabel = topRisk?.title ? ` ${topRisk.title}` : '';
    return `${barTitle}. ${riskLabel}. ${briefingLabel}. ${freshnessLabel}.${primaryRiskLabel}`.trim();
  }, [
    barTitle,
    barSubtitle,
    brainBriefing.summary,
    hasUnavailableMonitoringData,
    operationalModel.snapshot,
    statusBarState,
    t,
    topRisk?.title,
  ]);

  const handleOpenRealtimeInsights = useCallback(() => {
    const routeNames = navigation?.getState?.().routeNames ?? [];
    if (routeNames.includes('MonitoringFeed')) {
      navigation.navigate('MonitoringFeed');
      return;
    }
    if (routeNames.includes('Monitoring')) {
      navigation.navigate('Monitoring');
      return;
    }
    if (routeNames.includes('SafetyMap')) {
      navigation.navigate('SafetyMap');
    }
  }, [navigation]);

  const handleOpenAlertAi = useCallback(() => {
    navigation.navigate('AlertAssistant');
  }, [navigation]);

  const refreshLocationPermissionStatus =
    useCallback(async (): Promise<PermissionStatus> => {
      try {
        const status = await PermissionManager.checkLocationPermission();
        if (isMountedRef.current) {
          setHomeLocationPermissionStatus(status);
        }
        return status;
      } catch {
        if (isMountedRef.current) {
          setHomeLocationPermissionStatus('denied');
        }
        return 'denied';
      }
    }, []);

  const handleSOS = async () => {
    if (sosSendState === 'sending') return;
    setSosSendState('sending');
    triggerHeavyHaptic();
    TelemetryService.trackEvent('sos_button_tap', {screen: 'home'});
    try {
      const result = await triggerSecureSOS();
      if (!result.accepted) {
        TelemetryService.trackEvent('sos_send_error', {
          screen: 'home',
          reason: 'dispatch_failed',
        });
        setSosSendState('idle');
        return;
      }
      TelemetryService.trackEvent('sos_send_success', {
        screen: 'home',
        delivered: result.delivered,
        queued: result.queued,
        integrityProtected: result.integrityProtected,
      });
      setSosSendState('active');
      if (sosActiveTimer.current) clearTimeout(sosActiveTimer.current);
      sosActiveTimer.current = setTimeout(() => {
        setSosSendState('idle');
      }, SOS_ACTIVE_RESET_MS);
      if (result.queued && !result.delivered) {
        Alert.alert(t('sos_queued_title'), t('sos_queued_body'));
      } else {
        Alert.alert(t('sos_sent_title'), t('sos_sent_body'));
      }
    } catch {
      TelemetryService.trackEvent('sos_send_error', {
        screen: 'home',
        reason: 'unexpected',
      });
      setSosSendState('idle');
    }
  };

  const handleOpenMessages = useCallback(() => {
    TelemetryService.trackEvent('messages_entry_tap', {screen: 'home'});
    navigation.navigate('Conversations');
    void (async () => {
      try {
        const activeSos = await NotificationService.getActiveSos();
        TelemetryService.trackEvent('messages_entry_route', {
          route: 'ChatMonitor',
          withActiveSos: Boolean(activeSos?.location),
          mode: 'GUARDIANS_GROUP',
        });
      } catch {
        TelemetryService.trackEvent('messages_entry_route', {
          route: 'ChatMonitor',
          withActiveSos: false,
          mode: 'GUARDIANS_GROUP',
        });
      }
    })();
  }, [navigation]);

  const handleSosPressIn = () => {
    setSosPressing(true);
    Animated.spring(sosPressAnim, {
      toValue: 1,
      speed: 16,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
    if (sosHoldTimer.current) {
      clearTimeout(sosHoldTimer.current);
    }
    sosHoldTimer.current = setTimeout(() => {
      setPanicHold(true);
    }, 1000);
  };

  const handleSosPressOut = () => {
    if (sosHoldTimer.current) {
      clearTimeout(sosHoldTimer.current);
      sosHoldTimer.current = null;
    }
    setPanicHold(false);
    setSosPressing(false);
    Animated.spring(sosPressAnim, {
      toValue: 0,
      speed: 18,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  };

  const cancelDeferredBriefing = useCallback(() => {
    if (deferredBriefingTimerRef.current) {
      clearTimeout(deferredBriefingTimerRef.current);
      deferredBriefingTimerRef.current = null;
    }
    if (typeof deferredBriefingTaskRef.current?.cancel === 'function') {
      deferredBriefingTaskRef.current.cancel();
    }
    deferredBriefingTaskRef.current = null;
  }, []);

  const scheduleDeferredBriefing = useCallback(
    (params: {
      latitude: number | null;
      longitude: number | null;
      force: boolean;
      requestToken: number;
      operational: OperationalSnapshotReadModel;
    }) => {
      cancelDeferredBriefing();

      const canApply = () =>
        isMountedRef.current &&
        params.requestToken === refreshRequestTokenRef.current;

      deferredBriefingTaskRef.current = InteractionManager.runAfterInteractions(
        () => {
          deferredBriefingTimerRef.current = setTimeout(() => {
            void (async () => {
              const briefing = await GetAlertBrainBriefingQuery.execute({
                latitude: params.latitude,
                longitude: params.longitude,
                locale: localeTag,
                timeZone,
                force: params.force,
                operational: params.operational,
              });
              if (!canApply()) return;
              setBrainBriefing(briefing);
              setOperationalModel(briefing.operational);
            })().catch(() => {
              // The critical home shell already loaded; keep enrichment fail-soft.
            });
          }, 180);
        },
      );
    },
    [cancelDeferredBriefing, localeTag, timeZone],
  );

  const fetchAlerts = useCallback(
    async (
      force = false,
      requestToken?: number,
      options?: {deferBriefing?: boolean},
    ) => {
      const token =
        typeof requestToken === 'number'
          ? requestToken
          : refreshRequestTokenRef.current + 1;
      refreshRequestTokenRef.current = token;
      cancelDeferredBriefing();

      const canApply = () =>
        isMountedRef.current && token === refreshRequestTokenRef.current;
      const deferBriefing = options?.deferBriefing === true;

      const lat = securityState.location?.latitude;
      const lon = securityState.location?.longitude;
      if (
        !canUseLocationForRiskMaps(securityState) ||
        !isFiniteCoordinatePair(lat, lon)
      ) {
        const homeSnapshot = await GetHomeRiskSnapshotQuery.execute({
          latitude: null,
          longitude: null,
          riskScore,
          clientRiskLevel: securityState.riskLevel,
          locale: localeTag,
          timeZone,
          force,
          includeBriefing: !deferBriefing,
          t,
        });
        if (!canApply()) return;
        setBrainBriefing(homeSnapshot.briefing);
        setOperationalModel(homeSnapshot.operational);
        setAlerts(homeSnapshot.alerts);
        setPrioritizedRisks(homeSnapshot.prioritizedRisks);
        setSafetyCTAState(homeSnapshot.safetyCTAState);
        setStatusBarState(homeSnapshot.statusBarState);
        setHasUnavailableMonitoringData(
          homeSnapshot.hasUnavailableMonitoringData,
        );
        return;
      }
      const homeSnapshot = await GetHomeRiskSnapshotQuery.execute({
        latitude: Number(lat),
        longitude: Number(lon),
        riskScore,
        clientRiskLevel: securityState.riskLevel,
        locale: localeTag,
        timeZone,
        force,
        includeBriefing: !deferBriefing,
        t,
      });
      if (!canApply()) return;
      setAlerts(homeSnapshot.alerts);
      setHasUnavailableMonitoringData(
        homeSnapshot.hasUnavailableMonitoringData,
      );
      setBrainBriefing(homeSnapshot.briefing);
      setOperationalModel(homeSnapshot.operational);
      setPrioritizedRisks(homeSnapshot.prioritizedRisks);
      setSafetyCTAState(homeSnapshot.safetyCTAState);
      setStatusBarState(homeSnapshot.statusBarState);

      if (deferBriefing) {
        scheduleDeferredBriefing({
          latitude: Number(lat),
          longitude: Number(lon),
          force,
          requestToken: token,
          operational: homeSnapshot.operational,
        });
      }
    },
    [
      cancelDeferredBriefing,
      localeTag,
      riskScore,
      scheduleDeferredBriefing,
      securityState.riskLevel,
      securityState.location?.latitude,
      securityState.location?.longitude,
      t,
      timeZone,
    ],
  );

  const handleResolveLocationAccess = useCallback(() => {
    void (async () => {
      const currentStatus = await refreshLocationPermissionStatus();
      if (currentStatus === 'blocked') {
        PermissionManager.openSettings();
        return;
      }

      const nextStatus = await PermissionManager.requestLocationPermission();
      if (!isMountedRef.current) {
        return;
      }

      setHomeLocationPermissionStatus(nextStatus);
      if (nextStatus === 'granted') {
        void requestPreciseFixNow();
        void fetchAlerts(true);
        return;
      }

      if (nextStatus === 'blocked') {
        PermissionManager.openSettings();
      }
    })();
  }, [fetchAlerts, refreshLocationPermissionStatus, requestPreciseFixNow]);

  // FAANG Fase 2: Salvar dados no cache após fetch
  const saveToCache = useCallback(async () => {
    try {
      if (!FeatureFlags.isEnabled('home_instant_cache_enabled')) {
        return;
      }

      await HomeInstantCache.initialize();

      const lat = securityState.location?.latitude;
      const lon = securityState.location?.longitude;

      // Salvar dados relevantes no cache
      await HomeInstantCache.save({
        risk: {
          level: securityState.riskLevel,
          alerts: alerts.slice(0, 5).map(a => ({
            id: a.id,
            type: a.type,
            title: a.title || '',
            summary: a.summary || '',
            timestamp: a.timestamp || new Date().toISOString(),
          })),
          prioritizedRisks: prioritizedRisks.slice(0, 3).map(r => ({
            categoryId: r.categoryId,
            nature: r.nature,
            score: r.score,
            title: r.title || '',
            summary: r.summary,
            timestamp: r.timestamp || new Date().toISOString(),
          })),
          fetchedAt: new Date().toISOString(),
        },
        cityApproximation:
          lat && lon ? 'Localização atual' : securityState.locationName || '',
        locationCountryCode: securityState.locationCountryCode || undefined,
      });
    } catch {
      // Fail-soft: não quebrar se cache falhar
    }
  }, [
    alerts,
    prioritizedRisks,
    securityState.locationCountryCode,
    securityState.locationName,
    securityState.location?.latitude,
    securityState.location?.longitude,
    securityState.riskLevel,
  ]);

  useEffect(() => {
    let mounted = true;
    ImportantAlertsService.getState()
      .then(state => {
        if (mounted) setNotificationCenterState(state);
      })
      .catch(() => {});

    const unsubscribe = ImportantAlertsService.subscribe(state => {
      if (!mounted) return;
      setNotificationCenterState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(enabled => {
        if (mounted) setReducedMotion(Boolean(enabled));
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      enabled => setReducedMotion(Boolean(enabled)),
    );

    return () => {
      mounted = false;
      if (typeof subscription?.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      sosPulseAnim.stopAnimation();
      sosGlowAnim.stopAnimation();
      sosPulseAnim.setValue(0);
      sosGlowAnim.setValue(0);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(sosPulseAnim, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(sosGlowAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(sosGlowAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();
    glow.start();

    return () => {
      pulse.stop();
      glow.stop();
    };
  }, [reducedMotion, sosGlowAnim, sosPulseAnim]);

  useEffect(() => {
    return () => {
      if (sosActiveTimer.current) {
        clearTimeout(sosActiveTimer.current);
      }
    };
  }, []);

  const announceRefreshStatus = useCallback(
    (status: 'refreshing' | 'completed') => {
      const message =
        status === 'refreshing'
          ? t('home_refresh_accessibility_updating')
          : t('home_refresh_accessibility_done');
      setRefreshA11yMessage(message);
      AccessibilityInfo.announceForAccessibility(message);
    },
    [t],
  );

  const onRefresh = useCallback(() => {
    void runRefreshWithTimeout({
      timeoutMs: 5000,
      setRefreshing,
      requestTokenRef: refreshRequestTokenRef,
      activeRunRef: refreshRunRef,
      timeoutRef: refreshTimeoutRef,
      cancelPreviousRunRef: cancelRefreshRunRef,
      isMountedRef,
      onStatusChange: announceRefreshStatus,
      refreshFn: async token => {
        if (isMountedRef.current && token === refreshRequestTokenRef.current) {
          setRefreshToken(value => value + 1);
        }
        await fetchAlerts(true, token);
      },
    });
  }, [announceRefreshStatus, fetchAlerts]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: {cancel?: () => void} | null = null;
    const frame = requestAnimationFrame(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        timer = setTimeout(() => {
          if (!cancelled) {
            setFastStartReady(true);
          }
        }, 120);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer) {
        clearTimeout(timer);
      }
      if (typeof interactionTask?.cancel === 'function') {
        interactionTask.cancel();
      }
    };
  }, []);

  useEffect(() => {
    void refreshLocationPermissionStatus();
  }, [refreshLocationPermissionStatus]);

  // FAANG Fase 2: Carregar cache ao iniciar (antes do fetch)
  useEffect(() => {
    if (!fastStartReady) return;

    const loadCacheOnStart = async () => {
      try {
        if (!FeatureFlags.isEnabled('home_instant_cache_enabled')) {
          return;
        }

        await HomeInstantCache.initialize();

        if (HomeInstantCache.hasUsableCache()) {
          const riskData = HomeInstantCache.getRisk();
          const freshness = HomeInstantCache.getFreshness('risk');

          if (riskData.data && freshness !== 'missing') {
            // Usar cache imediatamente para UI rápida
            setAlerts(
              riskData.data.alerts.map(a => ({
                id: a.id,
                type: a.type,
                title: a.title,
                summary: a.summary,
                timestamp: a.timestamp,
              })),
            );
            setPrioritizedRisks(
              riskData.data.prioritizedRisks.map(r => ({
                categoryId: r.categoryId,
                nature: normalizeHomeRiskNature(r.nature),
                score: r.score,
                title: r.title,
                summary: r.summary,
                timestamp: r.timestamp,
              })),
            );

            // Atualizar estado do cache
            setCacheFreshness(freshness);
            setIsUsingCache(true);
            setCacheLastUpdatedAt(HomeInstantCache.getCachedAt());

            // Registrar hit no cache
            HomeInstantCache.recordHit();
          }
        } else {
          HomeInstantCache.recordMiss();
        }
      } catch {
        // Fail-soft: não quebrar se cache falhar
      }
    };

    void loadCacheOnStart();
  }, [fastStartReady]);

  useEffect(() => {
    if (!fastStartReady) return;
    const task = setTimeout(() => {
      initialDataLoadRef.current = true;
      void fetchAlerts(false, undefined, {deferBriefing: true});
    }, 40);
    return () => {
      clearTimeout(task);
    };
  }, [fastStartReady, fetchAlerts]);

  useEffect(() => {
    if (locationPromptRequestedRef.current) return;

    let cancelled = false;

    const task = setTimeout(
      () => {
        void (async () => {
          const currentStatus = await refreshLocationPermissionStatus();
          if (
            !shouldAutoRequestLocationPermission(
              currentStatus,
              locationPromptRequestedRef.current,
            )
          ) {
            return;
          }

          locationPromptRequestedRef.current = true;
          const nextStatus =
            await PermissionManager.requestLocationPermission();
          if (cancelled || !isMountedRef.current) {
            return;
          }
          setHomeLocationPermissionStatus(nextStatus);
          if (nextStatus === 'granted') {
            void requestPreciseFixNow();
          }
        })();
      },
      fastStartReady ? 450 : 900,
    );

    return () => {
      cancelled = true;
      clearTimeout(task);
    };
  }, [fastStartReady, refreshLocationPermissionStatus, requestPreciseFixNow]);

  useEffect(() => {
    if (!fastStartReady) return;
    const unsub = navigation.addListener?.('focus', () => {
      void refreshLocationPermissionStatus();
      if (!initialDataLoadRef.current) return;
      void fetchAlerts(false);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [
    fastStartReady,
    navigation,
    fetchAlerts,
    refreshLocationPermissionStatus,
  ]);

  // Auto-refresh so the status bar updates even without pull-to-refresh.
  // WeatherService caches network requests, so this is cheap most of the time.
  useEffect(() => {
    if (!fastStartReady) return;
    const id = setInterval(() => {
      void fetchAlerts(false);
    }, 60_000);
    return () => clearInterval(id);
  }, [fastStartReady, fetchAlerts]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (cancelRefreshRunRef.current) {
        cancelRefreshRunRef.current();
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (sosHoldTimer.current) {
        clearTimeout(sosHoldTimer.current);
      }
      cancelDeferredBriefing();
    };
  }, [cancelDeferredBriefing]);

  useEffect(() => {
    performance.mark('home_map_ready');
    const measure = performance.measure(
      'home_map_ready',
      'app_ready',
      'home_map_ready',
    );
    if (__DEV__ && measure?.duration) {
      console.log(
        `[ALERT-PERF] home_map_ready=${Math.round(measure.duration)}ms`,
      );
    }
  }, []);

  useEffect(() => {
    performance.mark('home_render');
    const measure = performance.measure(
      'home_render',
      'app_ready',
      'home_render',
    );
    if (__DEV__ && measure?.duration) {
      console.log(`[ALERT-PERF] home_render=${Math.round(measure.duration)}ms`);
    }
  }, []);

  useEffect(() => {
    if (!fastStartReady) return;
    performance.mark('home_shell_ready');
    const measure = performance.measure(
      'home_shell_ready',
      'app_init',
      'home_shell_ready',
    );
    if (__DEV__) {
      console.log(
        `[ALERT-PERF] home_shell_ready=${Math.round(measure?.duration || 0)}ms`,
      );
    }
  }, [fastStartReady]);

  const bellCount = notificationCenterState.unreadCount;

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent={false}
        backgroundColor={colors.background}
      />

      <SafeAreaView edges={['top']} style={{flex: 1}}>
        {/* HEADER COM IDENTIDADE VISUAL */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.brand, {color: colors.alert}]}>Alert</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleOpenAlertAi}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('home_alert_ai_open_label')}
              accessibilityHint={t('home_alert_ai_open_hint')}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <View style={[styles.iconCircle, {backgroundColor: colors.card}]}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.alertAiIcon}
                  resizeMode="contain"
                  accessible={false}
                />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                bellCount > 0
                  ? t('home_notifications_unread_a11y', {
                      count: bellCount,
                    })
                  : t('home_notifications_none_a11y')
              }
              accessibilityHint={t('home_notifications_open_hint')}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <View style={[styles.iconCircle, {backgroundColor: colors.card}]}>
                <Icon name="bell-outline" size={24} color={colors.text} />
                {bellCount > 0 && (
                  <View style={[styles.badge, {backgroundColor: colors.alert}]}>
                    <Text style={styles.badgeText}>
                      {bellCount > 99 ? '99+' : bellCount}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('home_settings_open_label')}
              accessibilityHint={t('home_settings_open_hint')}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <View style={[styles.iconCircle, {backgroundColor: colors.card}]}>
                <Icon name="dots-vertical" size={24} color={colors.text} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {paddingBottom: ThemeTokens.spacing.xxxl + 72 + insets.bottom},
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]} // Para Android
              accessibilityLabel={
                refreshing
                  ? t('home_refresh_accessibility_updating')
                  : t('home_refresh_accessibility_idle')
              }
              accessibilityHint={t('home_refresh_accessibility_hint')}
            />
          }>
          <Text
            style={styles.a11yStatus}
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            allowFontScaling
            maxFontSizeMultiplier={1.4}>
            {refreshA11yMessage}
          </Text>

          {locationBannerState !== 'hidden' ? (
            <View
              style={[
                styles.locationAccessCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              accessible
              accessibilityRole="summary"
              accessibilityLabel={t('location_precision_required_title')}>
              <View style={styles.locationAccessRow}>
                <View
                  style={[
                    styles.locationAccessIconWrap,
                    {borderColor: colors.border},
                  ]}>
                  <Icon
                    name={
                      locationBannerState === 'blocked'
                        ? 'map-marker-off-outline'
                        : 'crosshairs-gps'
                    }
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.locationAccessTextCol}>
                  <Text
                    style={[
                      styles.locationAccessTitle,
                      {color: colors.text, fontFamily: FONT_FAMILY},
                    ]}>
                    {t('location_precision_required_title')}
                  </Text>
                  <Text
                    style={[
                      styles.locationAccessBody,
                      {color: colors.textSecondary, fontFamily: FONT_FAMILY},
                    ]}>
                    {t('location_precision_required_body')}
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={handleResolveLocationAccess}
                  style={[
                    styles.locationAccessButton,
                    {backgroundColor: colors.primary},
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    locationBannerState === 'blocked'
                      ? t('location_open_settings')
                      : t('permission_allow')
                  }>
                  <Text
                    style={[
                      styles.locationAccessButtonText,
                      {color: '#FFFFFF', fontFamily: FONT_FAMILY},
                    ]}>
                    {locationBannerState === 'blocked'
                      ? t('location_open_settings')
                      : t('permission_allow')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View>
            {fastStartReady && WeatherWidgetComponent ? (
              <WeatherWidgetComponent
                refreshToken={refreshToken}
                operationalWeatherSignal={operationalWeatherSignal}
              />
            ) : (
              <View style={styles.weatherPlaceholderWrap}>
                <View
                  style={[
                    styles.weatherPlaceholderCard,
                    {backgroundColor: colors.card, borderColor: colors.border},
                  ]}
                />
              </View>
            )}
          </View>

          <View>
            {showMap && RiskMapWidgetComponent ? (
              <RiskMapWidgetComponent navigation={navigation} />
            ) : (
              <View style={styles.mapPlaceholderWrap}>
                <TouchableOpacity
                  style={[
                    styles.mapPlaceholderCard,
                    {backgroundColor: colors.card, borderColor: colors.border},
                  ]}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('SafetyMap')}>
                  <View style={styles.mapPlaceholderBody}>
                    <Icon
                      name="map-outline"
                      size={24}
                      color={colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.mapPlaceholderText,
                        {color: colors.textSecondary},
                      ]}>
                      {t('map_loading')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* CENTRAL SOS BUTTON AREA */}
          <View
            style={[
              styles.centerContent,
              isCompactScreen && styles.centerContentCompact,
            ]}>
            <View style={styles.sosWrap}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.sosGlow,
                  {
                    backgroundColor: sosVisual.glow,
                    opacity: reducedMotion
                      ? styles.sosGlowStatic.opacity
                      : sosGlowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            sosVisual.state === 'active' ? 0.28 : 0.18,
                            sosVisual.state === 'active' ? 0.12 : 0.05,
                          ],
                        }),
                    transform: [
                      {
                        scale: reducedMotion
                          ? SOS_GLOW_SCALE
                          : sosGlowAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [
                                SOS_GLOW_SCALE,
                                sosVisual.state === 'active' ? 1.18 : 1.14,
                              ],
                            }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.sosShell,
                  {
                    backgroundColor: sosVisual.shell,
                    borderColor: sosVisual.shellBorder,
                    shadowColor: sosVisual.glow,
                    opacity: reducedMotion
                      ? 0.9
                      : sosGlowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            sosVisual.state === 'active' ? 0.94 : 0.86,
                            sosVisual.state === 'active' ? 0.78 : 0.72,
                          ],
                        }),
                    transform: [
                      {
                        scale: reducedMotion
                          ? 1.01
                          : sosGlowAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [
                                1,
                                sosVisual.state === 'active' ? 1.035 : 1.02,
                              ],
                            }),
                      },
                    ],
                  },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.sosShellInset,
                  {
                    borderColor: sosVisual.shellInset,
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.sosPulse,
                  {borderColor: sosVisual.ring},
                  {
                    opacity: reducedMotion
                      ? styles.sosPulseStatic.opacity
                      : sosPulseAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [
                            sosVisual.state === 'active' ? 0.28 : 0.18,
                            0,
                          ],
                        }),
                    transform: [
                      {
                        scale: reducedMotion
                          ? SOS_PULSE_SCALE
                          : sosPulseAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [
                                1.01,
                                sosVisual.state === 'active' ? 1.18 : 1.12,
                              ],
                            }),
                      },
                    ],
                  },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.sosInnerRing,
                  {
                    borderColor: sosVisual.inner,
                    opacity: sosVisual.state === 'sending' ? 0.9 : 1,
                  },
                ]}
              />
              <TouchableOpacity
                style={[
                  styles.sosButton,
                  {
                    backgroundColor: sosVisual.tone,
                    shadowColor: sosVisual.tone,
                    borderColor: sosVisual.surfaceBorder,
                  },
                ]}
                activeOpacity={0.8}
                onPress={handleSOS}
                onPressIn={handleSosPressIn}
                onPressOut={handleSosPressOut}
                accessibilityRole="button"
                accessibilityLabel={t('sos_button_accessibility_label')}
                accessibilityHint={
                  sosVisual.state === 'active'
                    ? t('sos_action_hint_active')
                    : sosVisual.state === 'sending'
                      ? t('sos_action_hint_sending')
                      : t('sos_action_hint_idle')
                }>
                <Animated.View
                  style={{
                    transform: [
                      {
                        scale: sosPressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 0.97],
                        }),
                      },
                    ],
                  }}>
                  <View style={styles.sosButtonFace}>
                    <Text
                      style={[styles.sosText, {fontFamily: FONT_FAMILY}]}
                      allowFontScaling
                      maxFontSizeMultiplier={1.4}>
                      {t('sos')}
                    </Text>
                  </View>
                </Animated.View>
              </TouchableOpacity>
            </View>
            <AppText
              style={[styles.sosDisclaimer, {color: colors.textSecondary}]}>
              {t('legal_sos_disclaimer')}
            </AppText>
          </View>

          {showHomeMapBar ? (
            <View
              style={[
                styles.alertBarWrapper,
                isCompactScreen && styles.alertBarWrapperCompact,
              ]}>
              <View
                style={[
                  styles.alertBar,
                  {
                    backgroundColor: barVisual.backgroundColor,
                    borderColor: barBorderColor,
                  },
                ]}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.alertBarGlow,
                    {
                      backgroundColor: barGlowColor,
                    },
                  ]}
                />
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={handleOpenRealtimeInsights}
                  style={styles.alertBarContent}
                  accessibilityRole="button"
                  accessibilityLabel={barAccessibilityLabel}
                  accessibilityHint={t('home_bar_tap_details')}>
                  <View style={styles.alertRow}>
                    <View
                      style={[
                        styles.alertIconWrap,
                        {
                          backgroundColor: barVisual.iconWrapColor,
                          borderColor: barVisual.iconWrapBorderColor,
                        },
                      ]}>
                      <Icon name={barIcon} size={20} color={barSignalColor} />
                    </View>
                    <View style={styles.alertTextCol}>
                      <Text
                        style={[
                          styles.alertTitle,
                          {color: barForegroundColor, fontFamily: FONT_FAMILY},
                        ]}
                        numberOfLines={1}>
                        {barTitle}
                      </Text>
                      <Text
                        style={[
                          styles.alertSubtitle,
                          {color: barSecondaryColor, fontFamily: FONT_FAMILY},
                        ]}
                        numberOfLines={1}>
                        {barSubtitle}
                      </Text>
                    </View>
                    <View style={styles.alertChevronWrap}>
                      <Icon
                        name="chevron-right"
                        size={24}
                        color={barForegroundColor}
                        style={{opacity: 0.9}}
                      />
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
        <View
          style={[
            styles.messagesBarWrap,
            {bottom: ThemeTokens.spacing.md + insets.bottom},
          ]}
          pointerEvents="box-none">
          <TouchableOpacity
            key={messagesBarVisual.key}
            activeOpacity={0.9}
            onPress={() => void handleOpenMessages()}
            style={[
              styles.messagesBar,
              {
                backgroundColor: messagesBarVisual.backgroundColor,
                borderColor: messagesBarVisual.borderColor,
                shadowColor: messagesBarVisual.shadowColor,
              },
            ]}>
            <Icon
              name="message-text-outline"
              size={20}
              color={messagesBarVisual.iconColor}
            />
            <Text
              style={[
                styles.messagesBarText,
                {color: messagesBarVisual.textColor},
              ]}>
              {t('messages_title')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingVertical: ThemeTokens.spacing.md,
  },
  brand: {
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
    fontFamily: FONT_FAMILY,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
    position: 'relative',
  },
  alertAiIcon: {
    width: 30,
    height: 30,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  scrollContent: {
    paddingBottom: ThemeTokens.spacing.xxxl,
  },
  centerContent: {
    alignItems: 'center',
    marginTop: ThemeTokens.spacing.xxxl,
    marginBottom: ThemeTokens.spacing.xl,
  },
  centerContentCompact: {
    marginTop: ThemeTokens.spacing.xl,
    marginBottom: ThemeTokens.spacing.md,
  },
  sosWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: SOS_GLOW_SIZE,
    height: SOS_GLOW_SIZE,
  },
  sosGlow: {
    position: 'absolute',
    width: SOS_GLOW_SIZE,
    height: SOS_GLOW_SIZE,
    borderRadius: SOS_GLOW_SIZE / 2,
  },
  sosGlowStatic: {
    opacity: 0.16,
    transform: [{scale: 1.02}],
  },
  sosShell: {
    position: 'absolute',
    width: SOS_SHELL_SIZE,
    height: SOS_SHELL_SIZE,
    borderRadius: SOS_SHELL_SIZE / 2,
    borderWidth: 1,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  sosShellInset: {
    position: 'absolute',
    width: SOS_SHELL_SIZE - 12,
    height: SOS_SHELL_SIZE - 12,
    borderRadius: (SOS_SHELL_SIZE - 12) / 2,
    borderWidth: 1,
  },
  sosPulse: {
    position: 'absolute',
    width: SOS_PULSE_SIZE,
    height: SOS_PULSE_SIZE,
    borderRadius: SOS_PULSE_SIZE / 2,
    borderWidth: 2,
  },
  sosPulseStatic: {
    opacity: 0.18,
    transform: [{scale: 1.04}],
  },
  sosButton: {
    width: SOS_BUTTON_SIZE,
    height: SOS_BUTTON_SIZE,
    borderRadius: SOS_BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.strong.ios,
      android: ThemeTokens.shadows.strong.android,
    }),
    borderWidth: 1.5,
  },
  sosInnerRing: {
    position: 'absolute',
    width: SOS_INNER_RING_SIZE,
    height: SOS_INNER_RING_SIZE,
    borderRadius: SOS_INNER_RING_SIZE / 2,
    borderWidth: 1,
  },
  sosButtonFace: {
    width: SOS_BUTTON_SIZE,
    height: SOS_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: {
    color: '#FFF',
    fontSize: 58,
    lineHeight: 60,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  alertBarWrapper: {
    marginTop: ThemeTokens.spacing.xl,
    marginBottom: ThemeTokens.spacing.xxl,
    paddingHorizontal: ThemeTokens.spacing.lg,
  },
  alertBarWrapperCompact: {
    marginTop: ThemeTokens.spacing.md,
    marginBottom: ThemeTokens.spacing.xl,
  },
  alertBar: {
    borderRadius: ThemeTokens.radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  alertBarGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  alertBarContent: {
    paddingVertical: ThemeTokens.spacing.md,
    paddingHorizontal: ThemeTokens.spacing.lg,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  alertIconWrap: {
    position: 'absolute',
    left: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  alertChevronWrap: {
    position: 'absolute',
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTextCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 48,
  },
  alertTitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    textAlign: 'center',
  },
  alertSubtitle: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    marginTop: 2,
    textAlign: 'center',
  },
  mapPlaceholderWrap: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.xl,
  },
  mapPlaceholderCard: {
    height: 230,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  mapPlaceholderBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapPlaceholderText: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  weatherPlaceholderWrap: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.md,
    marginBottom: ThemeTokens.spacing.md,
  },
  weatherPlaceholderCard: {
    height: 208,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  messagesBarWrap: {
    position: 'absolute',
    left: ThemeTokens.spacing.lg,
    right: ThemeTokens.spacing.lg,
  },
  messagesBar: {
    height: 52,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ThemeTokens.spacing.sm,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  messagesBarText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  locationAccessCard: {
    marginHorizontal: ThemeTokens.spacing.xl,
    marginBottom: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
  },
  locationAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.md,
  },
  locationAccessIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  locationAccessTextCol: {
    flex: 1,
    gap: 4,
  },
  locationAccessTitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  locationAccessBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: 0.08,
  },
  locationAccessButton: {
    minHeight: 42,
    paddingHorizontal: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationAccessButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: 0.08,
  },
  a11yStatus: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  sosDisclaimer: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 32,
    lineHeight: 18,
    opacity: 0.8,
  },
});

export default HomeScreen;
