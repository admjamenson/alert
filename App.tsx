import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  Text,
  TextInput,
  Platform,
  Image,
  Linking,
  Alert as RNAlert,
  InteractionManager,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { SecurityProvider, useSecurity } from './src/context/SecurityContext';
import RootNavigator from './src/navigation';
import { ThemeTokens } from './src/constants/ThemeTokens';
import { initPerformanceMonitoring, performance } from './src/utils/performance';
import {
  ensureI18nReady,
  getI18nInstance,
  loadStoredLanguageDeferred,
} from './src/i18n/bootstrap';

enableScreens(true);
initPerformanceMonitoring();

const LIGHT_BG = ThemeTokens.colors.light.background;
const APP_FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

function AppBootstrap(): React.ReactElement {
  const { isDark, colors } = useTheme();
  const { triggerSecureSOS } = useSecurity();
  const [appState, setAppState] = useState<'loading' | 'ready'>('loading');
  const [boldTextEnabled, setBoldTextEnabled] = useState(false);
  const isMounted = useRef(true);
  const initIssueLoggedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isBoldTextEnabled?.()
      .then(enabled => {
        if (mounted) {
          setBoldTextEnabled(Boolean(enabled));
        }
      })
      .catch(() => {});

    const subscription = (AccessibilityInfo as any).addEventListener?.(
      'boldTextChanged',
      (enabled: boolean) => {
        if (mounted) {
          setBoldTextEnabled(Boolean(enabled));
        }
      },
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    const defaultTextProps = {
      allowFontScaling: true,
      maxFontSizeMultiplier: ThemeTokens.typography.maxFontScale.body,
      style: {
        fontFamily: APP_FONT_FAMILY,
        fontSize: ThemeTokens.typography.sizes.body,
        lineHeight: ThemeTokens.typography.lineHeights.body,
        letterSpacing: ThemeTokens.typography.letterSpacing.body,
        fontWeight: boldTextEnabled
          ? ThemeTokens.typography.weights.medium
          : ThemeTokens.typography.weights.regular,
      },
    };

    const defaultInputProps = {
      allowFontScaling: true,
      maxFontSizeMultiplier: ThemeTokens.typography.maxFontScale.body,
      style: {
        fontFamily: APP_FONT_FAMILY,
        fontSize: ThemeTokens.typography.sizes.body,
        lineHeight: ThemeTokens.typography.lineHeights.body,
        letterSpacing: ThemeTokens.typography.letterSpacing.body,
        fontWeight: boldTextEnabled
          ? ThemeTokens.typography.weights.medium
          : ThemeTokens.typography.weights.regular,
      },
    };

    const TextComponent = Text as typeof Text & {
      defaultProps?: Record<string, unknown>;
    };
    const TextInputComponent = TextInput as typeof TextInput & {
      defaultProps?: Record<string, unknown>;
    };

    TextComponent.defaultProps = {
      ...(TextComponent.defaultProps || {}),
      ...defaultTextProps,
    };

    TextInputComponent.defaultProps = {
      ...(TextInputComponent.defaultProps || {}),
      ...defaultInputProps,
    };
  }, [boldTextEnabled]);

  const logInitIssue = useCallback((label: string, error: unknown) => {
    const message = String((error as any)?.message || error || '').trim() || 'unknown';
    const key = `${label}:${message}`;
    if (initIssueLoggedRef.current.has(key)) return;
    initIssueLoggedRef.current.add(key);
    if (__DEV__) {
      console.log(`[APP INIT] ${label} issue: ${message}`);
    }
  }, []);

  const runWithTimeout = useCallback(
    async (task: () => Promise<unknown>, ms: number, label: string) => {
      try {
        await Promise.race([
          task(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), ms),
          ),
        ]);
      } catch (err: any) {
        logInitIssue(label, err);
      }
    },
    [logInitIssue],
  );

  const startInitialization = useCallback(() => {
    if (!isMounted.current) return;
    if (__DEV__) {
      console.log('[APP INIT] Releasing Home immediately.');
    }
    setAppState('ready');
    performance.mark('app_ready');
    const measure = performance.measure('app_tti', 'app_init', 'app_ready');
    if (__DEV__ && measure?.duration) {
      console.log(`[ALERT-PERF] app_tti=${Math.round(measure.duration)}ms`);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    performance.mark('app_init');
    startInitialization();
    return () => {
      isMounted.current = false;
    };
  }, [startInitialization]);

  useEffect(() => {
    if (appState !== 'ready') return;
    const task = InteractionManager.runAfterInteractions(() => {
      // Heavy startup tasks run after Home render.
      void runWithTimeout(
        () => loadStoredLanguageDeferred(),
        2500,
        'language hydration',
      );
      void runWithTimeout(async () => {
        const { verifyDeviceIntegrity } = require('./src/core/security/IntegrityCheck');
        const isSecure = await verifyDeviceIntegrity();
        if (!isSecure) {
          logInitIssue('integrity check', 'device integrity check failed (deferred)');
        }
      }, 3000, 'integrity check');

      void runWithTimeout(async () => {
        const { setupPushNotifications } = require('./src/api/alertService');
        await setupPushNotifications();
      }, 8000, 'push setup');
      void runWithTimeout(
        async () => {
          const { GuardianNetworkService } = require('./src/services/GuardianNetworkService');
          await GuardianNetworkService.registerDevice();
        },
        8000,
        'device registration',
      );
      void runWithTimeout(async () => {
        const { AdsBootstrap } = require('./src/ads/AdsBootstrap');
        await AdsBootstrap.initialize();
      }, 5000, 'ads bootstrap');
      void runWithTimeout(
        async () => {
          const { NotificationService } = require('./src/services/NotificationService');
          await NotificationService.cleanupDisabledCheckInNotifications();
        },
        2000,
        'check-in cleanup',
      );
    });
    return () => {
      if (typeof (task as any)?.cancel === 'function') {
        (task as any).cancel();
      }
    };
  }, [appState, runWithTimeout]);

  useEffect(() => {
    if (appState !== 'ready') return;
    let cancelled = false;
    let unsubRequests: (() => void) | null = null;
    let unsubSos: (() => void) | null = null;
    let interactionTask: { cancel?: () => void } | null = null;

    const safeUnsubscribe = (unsubscribe: (() => void) | null | undefined) => {
      if (typeof unsubscribe !== 'function') return;
      try {
        unsubscribe();
      } catch {
        // ignore cleanup errors
      }
    };

    const bindRealtimeUnsubscribe = (
      key: 'requests' | 'sos',
      unsubscribe: (() => void) | undefined,
    ) => {
      if (typeof unsubscribe !== 'function') return;
      if (cancelled) {
        safeUnsubscribe(unsubscribe);
        return;
      }
      if (key === 'requests') {
        unsubRequests = unsubscribe;
        return;
      }
      unsubSos = unsubscribe;
    };

    const startRealtime = async () => {
      try {
        const { GuardianNetworkService } = require('./src/services/GuardianNetworkService');
        const nextUnsubscribe = await GuardianNetworkService.listenGuardianRequests();
        bindRealtimeUnsubscribe('requests', nextUnsubscribe);
      } catch {
        // ignore
      }

      try {
        const { GuardianNetworkService } = require('./src/services/GuardianNetworkService');
        const { NotificationService } = require('./src/services/NotificationService');
        const { ImportantAlertsService } = require('./src/services/ImportantAlertsService');
        const i18n = getI18nInstance();
        const nextUnsubscribe = await GuardianNetworkService.listenIncomingSos((payload: any) => {
          if (!payload?.id) return;
          const incomingSos = {
            id: `sos-${payload.id}`,
            type: 'sos',
            title: i18n.t('sos_from_guardian'),
            summary: i18n.t('guardian_requested_help', {
              name: payload.fromName || i18n.t('guardian_generic'),
            }),
            timestamp: payload.createdAt || new Date().toISOString(),
            data: {
              senderName: payload.fromName || i18n.t('guardian_label'),
              location: payload.location,
              message: payload.message,
            },
          } as const;
          void NotificationService.add(incomingSos);
          void ImportantAlertsService.ingestAlerts([incomingSos]);
        });
        bindRealtimeUnsubscribe('sos', nextUnsubscribe);
      } catch {
        // ignore
      }
    };

    interactionTask = InteractionManager.runAfterInteractions(() => {
      void startRealtime();
    });

    return () => {
      cancelled = true;
      if (typeof interactionTask?.cancel === 'function') {
        interactionTask.cancel();
      }
      safeUnsubscribe(unsubRequests);
      safeUnsubscribe(unsubSos);
      unsubRequests = null;
      unsubSos = null;
    };
  }, [appState]);

  // Updates native Widget Suite snapshots periodically.
  useEffect(() => {
    if (appState !== 'ready') return;
    let cancelled = false;
    let interactionTask: { cancel?: () => void } | null = null;
    const tick = async () => {
      try {
        const { RefreshWidgetSnapshotsCommand } = require('./src/widgets/application/commands/RefreshWidgetSnapshotsCommand');
        await RefreshWidgetSnapshotsCommand.execute();
      } catch {
        // ignore
      }
    };

    interactionTask = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        void tick();
      }
    });
    const id = setInterval(() => {
      void tick();
    }, 15 * 60_000);
    return () => {
      cancelled = true;
      if (typeof interactionTask?.cancel === 'function') {
        interactionTask.cancel();
      }
      clearInterval(id);
    };
  }, [appState]);

  useEffect(() => {
    if (appState !== 'ready') return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let interactionTask: { cancel?: () => void } | null = null;

    const syncBadge = async (count: unknown) => {
      try {
        const { AlertBadgeAdapter } = require('./src/infrastructure/adapters/AlertBadgeAdapter');
        await AlertBadgeAdapter.syncUnreadCount(count);
      } catch {
        // ignore badge sync failures
      }
    };

    const bindBadgeSync = async () => {
      try {
        const { ImportantAlertsService } = require('./src/services/ImportantAlertsService');
        const state = await ImportantAlertsService.getState();
        if (cancelled) return;
        await syncBadge(state.unreadCount);
        unsubscribe = ImportantAlertsService.subscribe((nextState: { unreadCount: number }) => {
          void syncBadge(nextState.unreadCount);
        });
      } catch {
        // ignore badge setup failures
      }
    };

    interactionTask = InteractionManager.runAfterInteractions(() => {
      void bindBadgeSync();
    });

    return () => {
      cancelled = true;
      if (typeof interactionTask?.cancel === 'function') {
        interactionTask.cancel();
      }
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [appState]);

  useEffect(() => {
    const handleUrl = async (url?: string | null) => {
      if (!url) return;
      if (!url.includes('alertapp://quick-sos')) return;
      await ensureI18nReady();
      const i18n = getI18nInstance();
      const ok = await triggerSecureSOS();
      if (ok) {
        RNAlert.alert(
          i18n.t('sos_activated_title'),
          i18n.t('sos_activated_body'),
        );
      } else {
        RNAlert.alert(
          i18n.t('sos_not_sent_title'),
          i18n.t('sos_not_sent_body'),
        );
      }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', event => {
      void handleUrl(event.url);
    });
    return () => sub.remove();
  }, [triggerSecureSOS]);

  if (appState === 'loading') {
    return (
      <View style={styles.splashContainer}>
        <StatusBar barStyle="dark-content" backgroundColor={LIGHT_BG} />
        <View style={styles.logoWrapper}>
          <Image
            source={require('./src/assets/logo.png')}
            style={styles.mainLogo}
            resizeMode="contain"
          />
        </View>
        <View style={styles.footer}>
          <Text style={styles.fromText}>from</Text>
          <Text style={styles.brandText}>ALERT TEAM</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <RootNavigator />
    </View>
  );
}
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SecurityProvider>
            <AppBootstrap />
          </SecurityProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: LIGHT_BG,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  logoWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mainLogo: { width: 180, height: 180 },
  footer: { alignItems: 'center' },
  fromText: {
    color: '#666',
    fontFamily: APP_FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    textTransform: 'uppercase',
  },
  brandText: {
    color: ThemeTokens.colors.light.alert,
    fontFamily: APP_FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    marginTop: 5,
  },
});
