import React, { useCallback, useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  InteractionManager,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';

import { BudgetStatusProvider } from '../context/BudgetStatusContext';
import { SecurityProvider, useSecurity } from '../context/SecurityContext';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { ThemeTokens } from '../constants/ThemeTokens';
import { AppAlertProvider } from '../components/ui/AppAlertProvider';
import RootNavigator from '../navigation';
import {
  ensureI18nReady,
  getI18nInstance,
  initializeI18nRuntime,
  loadStoredLanguageDeferred,
} from '../i18n/bootstrap';
import { initPerformanceMonitoring, performance } from '../utils/performance';

enableScreens(true);
initPerformanceMonitoring();
initializeI18nRuntime();

const APP_FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type DefaultPropsCapable<T> = T & {
  defaultProps?: Record<string, unknown>;
};

type IncomingSosPayload = {
  id?: unknown;
  fromName?: unknown;
  createdAt?: unknown;
  location?: unknown;
  message?: unknown;
};

const toErrorMessage = (error: unknown): string =>
  String(error instanceof Error ? error.message : error || '').trim() ||
  'unknown';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isFreshQuickSosUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const ts = Number(parsed.searchParams.get('ts'));
    return Number.isFinite(ts) && Math.abs(Date.now() - ts) < 15_000;
  } catch {
    return false;
  }
};

const useGlobalTextDefaults = () => {
  useEffect(() => {
    const defaultTextProps = {
      allowFontScaling: true,
      maxFontSizeMultiplier: ThemeTokens.typography.maxFontScale.body,
      style: {
        fontFamily: APP_FONT_FAMILY,
        fontSize: ThemeTokens.typography.sizes.body,
        lineHeight: ThemeTokens.typography.lineHeights.body,
        letterSpacing: ThemeTokens.typography.letterSpacing.body,
        fontWeight: ThemeTokens.typography.weights.regular,
      },
    };

    const TextComponent = Text as DefaultPropsCapable<typeof Text>;
    const TextInputComponent = TextInput as DefaultPropsCapable<typeof TextInput>;

    TextComponent.defaultProps = {
      ...(TextComponent.defaultProps || {}),
      ...defaultTextProps,
    };

    TextInputComponent.defaultProps = {
      ...(TextInputComponent.defaultProps || {}),
      ...defaultTextProps,
    };
  }, []);
};

const useDeferredInitializers = () => {
  const initIssueLoggedRef = useRef<Set<string>>(new Set());

  const logInitIssue = useCallback((label: string, error: unknown) => {
    const message = toErrorMessage(error);
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
      } catch (error) {
        logInitIssue(label, error);
      }
    },
    [logInitIssue],
  );

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void runWithTimeout(
        () => loadStoredLanguageDeferred(),
        2500,
        'language hydration',
      );
      void runWithTimeout(async () => {
        const { verifyDeviceIntegrity } = require('../core/security/IntegrityCheck');
        const isSecure = await verifyDeviceIntegrity();
        if (!isSecure) {
          logInitIssue(
            'integrity check',
            'device integrity check failed (deferred)',
          );
        }
      }, 3000, 'integrity check');
      void runWithTimeout(async () => {
        const { setupPushNotifications } = require('../api/alertService');
        await setupPushNotifications();
      }, 8000, 'push setup');
      void runWithTimeout(async () => {
        const { GuardianNetworkService } = require('../services/GuardianNetworkService');
        await GuardianNetworkService.registerDevice();
      }, 8000, 'device registration');
      void runWithTimeout(async () => {
        const { AdsBootstrap } = require('../ads/AdsBootstrap');
        await AdsBootstrap.initialize();
      }, 5000, 'ads bootstrap');
      void runWithTimeout(async () => {
        const { NotificationService } = require('../services/NotificationService');
        await NotificationService.cleanupDisabledCheckInNotifications();
      }, 2000, 'check-in cleanup');
    });

    return () => {
      if (typeof task.cancel === 'function') {
        task.cancel();
      }
    };
  }, [logInitIssue, runWithTimeout]);

  useEffect(() => {
    let cancelled = false;
    let unsubRequests: (() => void) | null = null;
    let unsubSos: (() => void) | null = null;

    const safeUnsubscribe = (unsubscribe: (() => void) | null) => {
      if (typeof unsubscribe !== 'function') return;
      try {
        unsubscribe();
      } catch {
        // ignore cleanup errors
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const { GuardianNetworkService } = require('../services/GuardianNetworkService');
          const nextUnsubscribe =
            await GuardianNetworkService.listenGuardianRequests();
          if (cancelled) {
            safeUnsubscribe(nextUnsubscribe);
          } else {
            unsubRequests = nextUnsubscribe;
          }
        } catch {
          // ignore realtime failures
        }

        try {
          const { GuardianNetworkService } = require('../services/GuardianNetworkService');
          const { NotificationService } = require('../services/NotificationService');
          const { ImportantAlertsService } = require('../services/ImportantAlertsService');
          const i18n = getI18nInstance();
          const nextUnsubscribe = await GuardianNetworkService.listenIncomingSos(
            (payload: IncomingSosPayload) => {
              if (!payload?.id) return;
              const fromName =
                typeof payload.fromName === 'string'
                  ? payload.fromName
                  : i18n.t('guardian_generic');
              const incomingSos = {
                id: `sos-${String(payload.id)}`,
                type: 'sos',
                title: i18n.t('sos_from_guardian'),
                summary: i18n.t('guardian_requested_help', {
                  name: fromName,
                }),
                timestamp:
                  typeof payload.createdAt === 'string'
                    ? payload.createdAt
                    : new Date().toISOString(),
                data: {
                  senderName: fromName,
                  location: payload.location,
                  message: payload.message,
                },
              } as const;
              void NotificationService.add(incomingSos);
              void ImportantAlertsService.ingestAlerts([incomingSos]);
            },
          );
          if (cancelled) {
            safeUnsubscribe(nextUnsubscribe);
          } else {
            unsubSos = nextUnsubscribe;
          }
        } catch {
          // ignore realtime failures
        }
      })();
    });

    return () => {
      cancelled = true;
      if (typeof task.cancel === 'function') {
        task.cancel();
      }
      safeUnsubscribe(unsubRequests);
      safeUnsubscribe(unsubSos);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { RefreshWidgetSnapshotsCommand } = require('../widgets/application/commands/RefreshWidgetSnapshotsCommand');
        await RefreshWidgetSnapshotsCommand.execute();
      } catch {
        // ignore widget refresh failures
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        void tick();
      }
    });
    const id = setInterval(() => {
      void tick();
    }, 15 * 60_000);

    return () => {
      cancelled = true;
      if (typeof task.cancel === 'function') {
        task.cancel();
      }
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const syncBadge = async (count: unknown) => {
      try {
        const { AlertBadgeAdapter } = require('../infrastructure/adapters/AlertBadgeAdapter');
        await AlertBadgeAdapter.syncUnreadCount(count);
      } catch {
        // ignore badge sync failures
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const { ImportantAlertsService } = require('../services/ImportantAlertsService');
          const state = await ImportantAlertsService.getState();
          if (cancelled) return;
          await syncBadge(state.unreadCount);
          unsubscribe = ImportantAlertsService.subscribe(
            (nextState: { unreadCount: number }) => {
              void syncBadge(nextState.unreadCount);
            },
          );
        } catch {
          // ignore badge setup failures
        }
      })();
    });

    return () => {
      cancelled = true;
      if (typeof task.cancel === 'function') {
        task.cancel();
      }
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);
};

const DeferredAppBootstrap = () => {
  const { isDark, colors } = useTheme();
  const { triggerSecureSOS } = useSecurity();
  const quickSosHandoffRef = useRef({ url: '', handledAt: 0 });

  useGlobalTextDefaults();
  useDeferredInitializers();

  useEffect(() => {
    performance.mark('app_ready');
    const measure = performance.measure('app_tti', 'app_init', 'app_ready');
    console.info(
      `[ALERT-STARTUP] DEFERRED_APP_ROOT_READY +${Math.round(
        measure?.duration || 0,
      )}ms`,
    );
  }, []);

  useEffect(() => {
    const handleUrl = async (url?: string | null) => {
      if (!url || !url.includes('alertapp://quick-sos')) return;
      if (!isFreshQuickSosUrl(url)) return;
      const now = Date.now();
      if (
        quickSosHandoffRef.current.url === url &&
        now - quickSosHandoffRef.current.handledAt < 5000
      ) {
        return;
      }
      quickSosHandoffRef.current = { url, handledAt: now };
      await ensureI18nReady();
      const i18n = getI18nInstance();
      await triggerSecureSOS();
    };

    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', event => {
      void handleUrl(event.url);
    });
    return () => sub.remove();
  }, [triggerSecureSOS]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <RootNavigator />
    </View>
  );
};

const DeferredAppRoot = () => (
  <GestureHandlerRootView style={styles.container}>
    <SafeAreaProvider>
      <ThemeProvider>
        <SecurityProvider>
          <BudgetStatusProvider>
            <AppAlertProvider>
              <DeferredAppBootstrap />
            </AppAlertProvider>
          </BudgetStatusProvider>
        </SecurityProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default DeferredAppRoot;
