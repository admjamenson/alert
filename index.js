/**
 * ALERT OS - GLOBAL ENTRY POINT
 */

import 'react-native-gesture-handler';
import React from 'react';
import { AppRegistry, LogBox, StyleSheet, Text, View } from 'react-native';
import { enableScreens } from 'react-native-screens';
import { name as appName } from './app.json';

enableScreens(true);

const JS_ENTRY_TS = Date.now();
globalThis.__ALERT_JS_ENTRY_TS__ = JS_ENTRY_TS;
globalThis.__ALERT_STARTUP_MARKS__ = {
  APP_START_BEGIN: JS_ENTRY_TS,
};
console.info('[ALERT-STARTUP] APP_START_BEGIN +0ms');

const normalizeBootError = (stage, error) => {
  const message =
    String(error?.message || error || '').trim() || 'unknown_boot_error';
  return new Error(`[${stage}] ${message}`);
};

let fatalBootError = null;

try {
  require('./src/core/polyfills');
} catch (error) {
  fatalBootError = normalizeBootError('polyfills', error);
  console.error('[ALERT-BOOT] Polyfills failed to load:', fatalBootError);
}

let AppComponent = () => null;

try {
  const appModule = require('./App');
  AppComponent = appModule.default || appModule;
} catch (error) {
  fatalBootError = normalizeBootError('app', error);
  console.error('[ALERT-BOOT] App failed to load:', fatalBootError);
}

const BootErrorScreen = () => (
  <BootErrorView errorMessage={fatalBootError?.message || 'unknown_boot_error'} />
);

const BootErrorView = ({ errorMessage }) => {
  let hasApiBaseUrl = true;
  try {
    hasApiBaseUrl = require('./src/core/config').hasAlertApiBaseUrl();
  } catch {
    hasApiBaseUrl = false;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Alert bootstrap error</Text>
      <Text style={styles.body}>{errorMessage}</Text>
      {!hasApiBaseUrl ? (
        <Text style={styles.caption}>ALERT_API_URL missing</Text>
      ) : null}
    </View>
  );
};

if (__DEV__) {
  LogBox.ignoreLogs([
    'Non-serializable values were found in the navigation state',
    'Require cycle:',
    'MapLibre: ',
    'Support for defaultProps will be removed from function components',
    'i18next::pluralResolver',
    'This method is deprecated (as well as all React Native Firebase namespaced API)',
    'Please use `getApp()` instead.',
  ]);
  console.log('[ALERT-SYSTEM] Modo Desenvolvimento Ativo.');
  console.log(`[ALERT-STARTUP] js_entry_ts=${JS_ENTRY_TS}`);
}

AppRegistry.registerComponent(appName, () =>
  fatalBootError ? BootErrorScreen : AppComponent,
);
AppRegistry.registerHeadlessTask('SOSQuickTask', () => async data => {
  try {
    const taskModule = require('./src/tasks/SOSQuickTask');
    const SOSQuickTask = taskModule.default || taskModule;
    return await SOSQuickTask(data);
  } catch (error) {
    console.error('[ALERT-BOOT] SOSQuickTask failed to load:', error);
    return null;
  }
});

try {
  const {
    getMessaging,
    setBackgroundMessageHandler,
  } = require('@react-native-firebase/messaging');
  const messagingClient = getMessaging();
  setBackgroundMessageHandler(messagingClient, async remoteMessage => {
    try {
      const pushModule = require('./src/services/PushNotificationService');
      const handleRemoteMessage =
        pushModule.handleRemoteMessage || (async () => {});
      await handleRemoteMessage(remoteMessage);
    } catch (error) {
      console.error(
        '[ALERT-BOOT] PushNotificationService failed to load:',
        error,
      );
    }
  });
} catch (error) {
  console.error('[ALERT-BOOT] Messaging bootstrap failed:', error);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#0F1013',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 16,
  },
  body: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
  },
  caption: {
    marginTop: 20,
    color: '#9AA3B2',
    fontSize: 13,
  },
});
