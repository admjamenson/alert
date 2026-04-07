/**
 * ROOT NAVIGATION STACK
 *
 * Restores last route after process restart when safe.
 * Explicit deep links/push URLs still take priority.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CommonActions,
  createNavigationContainerRef,
  getStateFromPath,
  LinkingOptions,
  NavigationContainer,
  NavigationState,
  PartialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import {
  NAV_STATE_STORAGE_KEY,
  buildPersistedNavigationPayload,
} from './navigationStatePersistence';
import { performance } from '../utils/performance';

const Stack = createNativeStackNavigator<RootStackParamList>();
const NAVIGABLE_DEEP_LINK_HOSTS = new Set([
  'home',
  'guardians',
  'route-settings',
  'widgets',
  'checkin',
  'sos',
  'monitoring',
]);
type RemoteMessage = {
  data?: Record<string, string | object | undefined> | null;
} | null | undefined;

type MessagingBindings = {
  getMessaging: () => unknown;
  getInitialNotification: (client: unknown) => Promise<RemoteMessage>;
  onNotificationOpenedApp: (
    client: unknown,
    handler: (message: RemoteMessage) => void,
  ) => () => void;
};

let cachedMessagingBindings: MessagingBindings | null | undefined;

const getMessagingBindings = (): MessagingBindings | null => {
  if (cachedMessagingBindings !== undefined) {
    return cachedMessagingBindings;
  }

  try {
    const moduleRef = require('@react-native-firebase/messaging');
    cachedMessagingBindings = {
      getMessaging: moduleRef.getMessaging,
      getInitialNotification: moduleRef.getInitialNotification,
      onNotificationOpenedApp: moduleRef.onNotificationOpenedApp,
    };
  } catch {
    cachedMessagingBindings = null;
  }

  return cachedMessagingBindings;
};

const extractDeepLinkFromNotification = (
  message: RemoteMessage,
): string | null => {
  if (!message?.data) return null;
  const candidates: unknown[] = [
    message.data.deepLink,
    message.data.url,
    message.data.link,
    message.data.ctaUrl,
  ];
  const hit = candidates.find(
    (value): value is string =>
      typeof value === 'string' && value.startsWith('alertapp://'),
  );
  return hit ?? null;
};

const getDeepLinkHost = (url: string): string => {
  const normalized = url.replace('alertapp://', '');
  const firstPart = normalized.split(/[/?#]/)[0];
  return String(firstPart || '').toLowerCase();
};

const isNavigableDeepLink = (url: string): boolean => {
  if (!url.startsWith('alertapp://')) return false;
  return NAVIGABLE_DEEP_LINK_HOSTS.has(getDeepLinkHost(url));
};

const isBillingReturnDeepLink = (url: string): boolean =>
  url.startsWith('alertapp://') && getDeepLinkHost(url) === 'billing-return';

const getActiveRouteName = (state: any): string | undefined => {
  if (!state || !Array.isArray(state.routes) || state.routes.length === 0) {
    return undefined;
  }
  const index =
    typeof state.index === 'number'
      ? Math.min(Math.max(state.index, 0), state.routes.length - 1)
      : state.routes.length - 1;
  const route = state.routes[index];
  if (!route) return undefined;
  if (route.state) return getActiveRouteName(route.state);
  return typeof route.name === 'string' ? route.name : undefined;
};

const RootNavigator = () => {
  const navigationRef = useRef(createNavigationContainerRef<RootStackParamList>()).current;
  const lastPersistedNavStateRef = useRef('');
  const startupUrlHandledRef = useRef(false);

  const resetToHome = useCallback(() => {
    if (!navigationRef.isReady()) return;
    if (__DEV__) {
      console.log('[NAV] foreground reset -> Home');
    }
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      }),
    );
  }, [navigationRef]);

  const startupLinkingConfig = useMemo<
    NonNullable<LinkingOptions<RootStackParamList>['config']>
  >(
    () => ({
      screens: {
        Home: 'home',
        Guardians: 'guardians',
        RouteSettings: 'route-settings',
        WidgetCatalog: 'widgets',
        CheckIn: 'checkin',
        MonitoringFeed: {
          path: 'monitoring',
          parse: {
            type: (value: string) => value,
            scope: (value: string) => String(value || '').toUpperCase(),
            lat: (value: string) => Number(value),
            lon: (value: string) => Number(value),
            zoom: (value: string) => Number(value),
          },
        },
        ChatMonitor: {
          path: 'sos',
          parse: {
            lat: (value: string) => Number(value),
            lon: (value: string) => Number(value),
            user: (value: string) => decodeURIComponent(value),
          },
        },
      },
    }),
    [],
  );

  const applyStartupUrl = useCallback(
    (url: string): boolean => {
      if (!navigationRef.isReady()) return false;
      const normalizedPath = String(url || '').replace(/^alertapp:\/\//i, '');
      const nextState = getStateFromPath(normalizedPath, startupLinkingConfig as any);
      if (!nextState) return false;
      navigationRef.dispatch(CommonActions.reset(nextState as any));
      return true;
    },
    [navigationRef, startupLinkingConfig],
  );

  const resolveStartupUrl = useCallback(async (): Promise<string | null> => {
    const deepLink = await Linking.getInitialURL();
    if (deepLink?.startsWith('alertapp://') && isBillingReturnDeepLink(deepLink)) {
      return null;
    }

    if (deepLink?.startsWith('alertapp://') && isNavigableDeepLink(deepLink)) {
      return deepLink;
    }

    const messagingBindings = getMessagingBindings();
    if (!messagingBindings) {
      return null;
    }

    try {
      const initialNotification = await messagingBindings.getInitialNotification(
        messagingBindings.getMessaging(),
      );
      const pushLink = extractDeepLinkFromNotification(initialNotification);
      if (pushLink && isNavigableDeepLink(pushLink)) {
        return pushLink;
      }
    } catch (error: any) {
      if (__DEV__) {
        console.log(
          '[NAV] startup notification lookup failed:',
          String(error?.message || error || 'unknown'),
        );
      }
    }

    return null;
  }, []);

  const persistNavigationState = useCallback(
    async (state: NavigationState | PartialState<NavigationState> | undefined) => {
      if (!state) return;
      try {
        const payload = buildPersistedNavigationPayload(state as NavigationState);
        const serialized = JSON.stringify(payload);
        if (serialized === lastPersistedNavStateRef.current) return;
        lastPersistedNavStateRef.current = serialized;
        await AsyncStorage.setItem(NAV_STATE_STORAGE_KEY, serialized);
      } catch (error: any) {
        if (__DEV__) {
          console.log(
            '[NAV] persist failed:',
            String(error?.message || error || 'unknown'),
          );
        }
      }
    },
    [],
  );

  const linking = useMemo<LinkingOptions<RootStackParamList>>(
    () => ({
      prefixes: ['alertapp://'],
      config: startupLinkingConfig,
      getInitialURL: async () => null,
      subscribe(listener) {
        const urlSubscription = Linking.addEventListener('url', ({ url }) => {
          if (typeof url === 'string' && isBillingReturnDeepLink(url)) {
            if (__DEV__) {
              console.log('[NAV] billing return received');
            }
            return;
          }
          if (typeof url === 'string' && isNavigableDeepLink(url)) {
            listener(url);
            return;
          }
          if (typeof url === 'string' && url.startsWith('alertapp://')) {
            resetToHome();
            return;
          }
          listener(url);
        });
        let pushUnsubscribe = () => {};
        const messagingBindings = getMessagingBindings();
        if (messagingBindings) {
          try {
            pushUnsubscribe = messagingBindings.onNotificationOpenedApp(
              messagingBindings.getMessaging(),
              remoteMessage => {
                const url = extractDeepLinkFromNotification(remoteMessage);
                if (url && isBillingReturnDeepLink(url)) {
                  if (__DEV__) {
                    console.log('[NAV] billing return received from notification');
                  }
                  return;
                }
                if (url && isNavigableDeepLink(url)) {
                  listener(url);
                  return;
                }
                if (url) {
                  resetToHome();
                }
              },
            );
          } catch (error: any) {
            if (__DEV__) {
              console.log(
                '[NAV] notification subscription failed:',
                String(error?.message || error || 'unknown'),
              );
            }
          }
        }

        return () => {
          urlSubscription.remove();
          pushUnsubscribe();
        };
      },
    }),
    [resetToHome, startupLinkingConfig],
  );

  useEffect(() => {
    let cancelled = false;
    let delayId: ReturnType<typeof setTimeout> | null = null;

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      delayId = setTimeout(() => {
        void (async () => {
          const startupUrl = await resolveStartupUrl();
          if (
            cancelled ||
            startupUrlHandledRef.current ||
            !startupUrl ||
            !isNavigableDeepLink(startupUrl)
          ) {
            return;
          }

          startupUrlHandledRef.current = true;
          const applied = applyStartupUrl(startupUrl);
          if (__DEV__) {
            console.log(
              `[NAV] startup_url_${applied ? 'applied' : 'ignored'} host=${getDeepLinkHost(
                startupUrl,
              )}`,
            );
          }
        })();
      }, 120);
    });

    return () => {
      cancelled = true;
      if (delayId) {
        clearTimeout(delayId);
      }
      if (typeof (interactionTask as any)?.cancel === 'function') {
        (interactionTask as any).cancel();
      }
    };
  }, [applyStartupUrl, resolveStartupUrl]);

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        performance.mark('nav_ready');
        const measure = performance.measure('nav_ready', 'app_init', 'nav_ready');
        const routeName = navigationRef.getCurrentRoute()?.name;
        if (__DEV__) {
          console.log(
            `[ALERT-PERF] nav_ready=${Math.round(measure?.duration || 0)}ms route=${
              routeName || 'unknown'
            }`,
          );
        }
      }}
      onStateChange={state => {
        const activeRoute = getActiveRouteName(state);
        if (__DEV__ && activeRoute) {
          console.log(`[NAV] active route=${activeRoute}`);
        }
        void persistNavigationState(state);
      }}
    >
      <Stack.Navigator
        id={undefined}
        initialRouteName="FastHome"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#FFFFFF' },
        }}
      >
        <Stack.Screen
          name="Welcome"
          getComponent={() => require('../screens/auth/WelcomeScreen').default}
        />
        <Stack.Screen
          name="Login"
          getComponent={() => require('../screens/auth/LoginScreen').default}
        />
        <Stack.Screen
          name="VerifyCode"
          getComponent={() => require('../screens/auth/VerifyCodeScreen').default}
        />
        <Stack.Screen
          name="ProfileSetup"
          getComponent={() => require('../screens/auth/ProfileSetupScreen').default}
        />
        <Stack.Screen
          name="Profile"
          getComponent={() => require('../screens/ProfileScreen').default}
        />
        <Stack.Screen
          name="AlertAssistant"
          getComponent={() => require('../screens/home/AlertAssistantScreen').default}
          options={{
            presentation: 'fullScreenModal',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="SetupContacts"
          getComponent={() => require('../screens/auth/SetupContactsScreen').default}
        />
        <Stack.Screen
          name="FastHome"
          getComponent={() => require('../screens/home/FastHomeScreen').default}
          options={{ animation: 'none' }}
        />
        <Stack.Screen
          name="Home"
          getComponent={() => require('../screens/home/HomeScreen').default}
          options={{ animation: 'none' }}
        />
        <Stack.Screen
          name="SafetyMap"
          getComponent={() => require('../screens/home/HomeMapScreen').default}
        />
        <Stack.Screen
          name="ChatMonitor"
          getComponent={() => require('../screens/home/ChatMonitorScreen').ChatMonitorScreen}
        />
        <Stack.Screen
          name="Conversations"
          getComponent={() => require('../screens/home/ConversationsScreen').default}
          options={{ animation: 'none' }}
        />
        <Stack.Screen
          name="ChatThread"
          getComponent={() => require('../screens/chat/ChatThreadScreen').default}
        />
        <Stack.Screen
          name="PrivateReply"
          getComponent={() => require('../screens/chat/PrivateReplyScreen').default}
        />
        <Stack.Screen
          name="Notifications"
          getComponent={() => require('../screens/home/NotificationsScreen').NotificationsScreen}
        />
        <Stack.Screen
          name="Monitoring"
          getComponent={() => require('../screens/home/MonitoringScreen').default}
        />
        <Stack.Screen
          name="RealtimeInsights"
          getComponent={() => require('../screens/home/RealtimeInsightsScreen').default}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="MonitoringFeed"
          getComponent={() => require('../screens/home/MonitoringFeedScreen').default}
          options={{
            presentation: 'fullScreenModal',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="OfficialSources"
          getComponent={() => require('../screens/home/OfficialSourcesScreen').default}
        />
        <Stack.Screen
          name="EpidemicMap"
          getComponent={() => require('../screens/home/EpidemicMapScreen').default}
        />
        <Stack.Screen
          name="Guardians"
          getComponent={() => require('../screens/home/GuardiansScreen').default}
        />
        <Stack.Screen
          name="RouteSettings"
          getComponent={() => require('../screens/home/RouteSettingsScreen').RouteSettingsScreen}
        />
        <Stack.Screen
          name="WidgetCatalog"
          getComponent={() =>
            require('../widgets/presentation/WidgetCatalogScreen').WidgetCatalogScreen
          }
        />
        <Stack.Screen
          name="CheckIn"
          getComponent={() => require('../screens/CheckInScreen').CheckInScreen}
        />
        <Stack.Screen
          name="Checkout"
          getComponent={() => require('../screens/checkout/CheckoutScreen').default}
        />
        <Stack.Screen
          name="History"
          getComponent={() => require('../screens/home/HistoryScreen').HistoryScreen}
        />
        <Stack.Screen
          name="Settings"
          getComponent={() => require('../screens/SettingScreen').default}
        />
        <Stack.Screen
          name="Support"
          getComponent={() => require('../screens/settings/SupportScreen').default}
        />
        <Stack.Screen
          name="AdPrivacy"
          getComponent={() => require('../screens/settings/AdPrivacyScreen').default}
        />
        <Stack.Screen
          name="LanguageSelector"
          getComponent={() => require('../screens/settings/LanguageSelectorScreen').default}
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="ThemeSettings"
          getComponent={() => require('../screens/ThemeSettings').default}
        />
        <Stack.Screen
          name="AlertDetails"
          getComponent={() => require('../screens/AlertDetailsScreen').default}
        />
        <Stack.Screen
          name="WebView"
          getComponent={() => require('../screens/WebViewScreen').default}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;
