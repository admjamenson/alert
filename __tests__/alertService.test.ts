describe('setupPushNotifications', () => {
  const alertMock = jest.fn();
  const trackEventMock = jest.fn();
  let consoleErrorSpy: jest.SpyInstance;

  const loadModule = (options?: {
    platformOs?: 'ios' | 'android';
    authStatus?: number;
    getTokenError?: Error | null;
  }) => {
    jest.resetModules();

    const platformOs = options?.platformOs || 'ios';
    const authStatus = options?.authStatus ?? 0;
    const getTokenError = options?.getTokenError ?? null;

    const requestPermissionMock = jest.fn(async () => authStatus);
    const getTokenMock = getTokenError
      ? jest.fn(async () => {
          throw getTokenError;
        })
      : jest.fn(async () => 'push-token');
    const onMessageMock = jest.fn();
    const onNotificationOpenedAppMock = jest.fn();
    const getInitialNotificationMock = jest.fn(async () => null);

    jest.doMock('react-native', () => ({
      Platform: {
        OS: platformOs,
      },
      Alert: {
        alert: alertMock,
      },
    }));

    jest.doMock('@react-native-firebase/messaging', () => ({
      AuthorizationStatus: {
        AUTHORIZED: 1,
        PROVISIONAL: 2,
      },
      deleteToken: jest.fn(),
      getInitialNotification: getInitialNotificationMock,
      getMessaging: jest.fn(() => ({mock: true})),
      getToken: getTokenMock,
      onMessage: onMessageMock,
      onNotificationOpenedApp: onNotificationOpenedAppMock,
      requestPermission: requestPermissionMock,
    }));

    jest.doMock('../src/services/PushNotificationService', () => ({
      handleRemoteMessage: jest.fn(async () => undefined),
    }));

    jest.doMock('../src/services/TelemetryService', () => ({
      __esModule: true,
      default: {
        trackEvent: trackEventMock,
      },
    }));

    const moduleRef = require('../src/api/alertService');
    return {
      setupPushNotifications: moduleRef.setupPushNotifications as () => Promise<void>,
      requestPermissionMock,
      getTokenMock,
    };
  };

  beforeEach(() => {
    alertMock.mockReset();
    trackEventMock.mockReset();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not surface a technical alert when iOS notification permission is denied', async () => {
    const {setupPushNotifications, getTokenMock} = loadModule({
      platformOs: 'ios',
      authStatus: 0,
    });

    await expect(setupPushNotifications()).resolves.toBeUndefined();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(trackEventMock).toHaveBeenCalledWith(
      'permission_notifications_unavailable',
      expect.objectContaining({screen: 'startup', platform: 'ios'}),
    );
  });

  it('fails soft without alerting the user when push bootstrap throws', async () => {
    const {setupPushNotifications} = loadModule({
      platformOs: 'android',
      getTokenError: new Error('token_bootstrap_failed'),
    });

    await expect(setupPushNotifications()).resolves.toBeUndefined();
    expect(alertMock).not.toHaveBeenCalled();
    expect(trackEventMock).toHaveBeenCalledWith(
      'push_setup_degraded',
      expect.objectContaining({screen: 'startup', platform: 'android'}),
    );
  });
});
