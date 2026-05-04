import React from 'react';
import { BackHandler, I18nManager, Platform } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('react-native-localize', () => ({
  __esModule: true,
  getCountry: () => 'BR',
  getCurrencies: () => ['BRL'],
  getLocales: () => [{ languageTag: 'pt-BR', languageCode: 'pt', countryCode: 'BR' }],
  getNumberFormatSettings: () => ({ decimalSeparator: ',', groupingSeparator: '.' }),
  getTimeZone: () => 'America/Fortaleza',
  uses24HourClock: () => true,
  usesMetricSystem: () => true,
}));

const mockReset = jest.fn((payload: unknown) => ({
  type: 'RESET',
  payload,
}));

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: (payload: unknown) => mockReset(payload),
  },
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactLocal = require('react');
    ReactLocal.useEffect(effect, [effect]);
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View: RNView } = require('react-native');

  return {
    SafeAreaView: ({ children, ...rest }: any) => ReactLocal.createElement(RNView, rest, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const ReactLocal = require('react');
  return ({ testID, ...props }: any) => ReactLocal.createElement('Icon', { testID, ...props });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ||
      {
        common_back: 'Back',
        common_back_hint: 'Returns to the previous screen.',
        settings_title: 'Settings',
        settings_language_auto: 'Automatic',
      }[key] ||
      key,
  }),
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    themeMode: 'system',
    setThemeMode: jest.fn(),
    colors: {
      primary: '#E61C24',
      background: '#FFFFFF',
      surface: '#FFFFFF',
      card: '#FFFFFF',
      text: '#111111',
      textSecondary: '#5A5A5A',
      border: '#E9E9E9',
    },
  }),
}));

jest.mock('../src/services/LocaleService', () => ({
  __esModule: true,
  default: {
    getStoredLanguagePreference: jest.fn(async () => 'system'),
    getLocaleMeta: jest.fn(() => ({ nativeName: 'English' })),
  },
}));

jest.mock('../src/services/EntitlementService', () => ({
  EntitlementService: {
    getEntitlements: jest.fn(async () => ({ isPremium: false })),
  },
}));

jest.mock('../src/services/KyberNetworkService', () => ({
  KyberNetworkService: {
    getCapabilityStatus: jest.fn(() => ({
      secureDispatch: true,
      offlineQueue: true,
      integrityProtection: true,
    })),
  },
}));

jest.mock('../src/ads/ConsentManager', () => ({
  ConsentManager: {
    openPrivacyOptions: jest.fn(async () => true),
  },
}));

jest.mock('../src/ads/AdSlot', () => () => null);
jest.mock('../src/components/ui/AppText', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => {
    const ReactLocal = require('react');
    const { Text: RNText } = require('react-native');
    return ReactLocal.createElement(RNText, props, children);
  },
}));
jest.mock('../src/assets/logo.png', () => 1);

const SettingScreen = require('../src/screens/SettingScreen').default;

jest.setTimeout(20000);

type NavigationMock = {
  canGoBack: jest.Mock<boolean, []>;
  goBack: jest.Mock<void, []>;
  getParent: jest.Mock<any, []>;
  dispatch: jest.Mock<any, [any]>;
  navigate: jest.Mock<void, [string]>;
  addListener: jest.Mock<any, [string, () => void]>;
};

const setPlatformOS = (value: 'ios' | 'android') => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value,
  });
};

const setRTL = (value: boolean) => {
  Object.defineProperty(I18nManager, 'isRTL', {
    configurable: true,
    value,
  });
};

const createNavigationMock = (overrides: Partial<NavigationMock> = {}): NavigationMock => ({
  canGoBack: jest.fn(() => false),
  goBack: jest.fn(),
  getParent: jest.fn(() => null),
  dispatch: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn<any, [string, () => void]>(() => jest.fn()),
  ...overrides,
});

const renderScreen = async (navigationOverrides: Partial<NavigationMock> = {}) => {
  const navigation = createNavigationMock(navigationOverrides);
  let testRenderer: renderer.ReactTestRenderer;

  await act(async () => {
    testRenderer = renderer.create(
      React.createElement(SettingScreen as any, { navigation }),
    );
    await Promise.resolve();
  });

  return {
    navigation,
    testRenderer: testRenderer!,
  };
};

describe('SettingScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setPlatformOS('ios');
    setRTL(false);
  });

  it('renders an iOS-style back chevron with premium accessibility metadata', async () => {
    setPlatformOS('ios');
    setRTL(false);

    const { testRenderer } = await renderScreen();
    const backButton = testRenderer.root.findByProps({ testID: 'settings-back-button' });
    const backIcon = testRenderer.root.findByProps({ testID: 'settings-back-icon' });

    expect(backButton.props.accessibilityLabel).toBe('Back');
    expect(backButton.props.accessibilityHint).toBe('Returns to the previous screen.');
    expect(backIcon.props.name).toBe('chevron-left');
  });

  it('uses the current stack navigation when there is history', async () => {
    const goBack = jest.fn();
    const canGoBack = jest.fn(() => true);

    const { navigation, testRenderer } = await renderScreen({
      canGoBack,
      goBack,
    });
    const backButton = testRenderer.root.findByProps({ testID: 'settings-back-button' });

    act(() => {
      backButton.props.onPress();
    });

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('uses the parent stack navigation when Settings is nested', async () => {
    const parentGoBack = jest.fn();

    const { testRenderer } = await renderScreen({
      canGoBack: jest.fn(() => false),
      getParent: jest.fn(() => ({
        canGoBack: () => true,
        goBack: parentGoBack,
      })),
    });
    const backButton = testRenderer.root.findByProps({ testID: 'settings-back-button' });

    act(() => {
      backButton.props.onPress();
    });

    expect(parentGoBack).toHaveBeenCalledTimes(1);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('falls back safely to a root reset when there is no previous route', async () => {
    const dispatch = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Home route unavailable');
      })
      .mockImplementationOnce(() => undefined);

    const { testRenderer } = await renderScreen({
      canGoBack: jest.fn(() => false),
      getParent: jest.fn(() => ({
        canGoBack: () => false,
      })),
      dispatch,
    });
    const backButton = testRenderer.root.findByProps({ testID: 'settings-back-button' });

    act(() => {
      backButton.props.onPress();
    });

    expect(mockReset).toHaveBeenNthCalledWith(1, {
      index: 0,
      routes: [{ name: 'Home' }],
    });
    expect(mockReset).toHaveBeenNthCalledWith(2, {
      index: 0,
      routes: [{ name: 'FastHome' }],
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('mirrors the safe back behavior on Android hardware back', async () => {
    setPlatformOS('android');

    let hardwareBackHandler: (() => boolean) | undefined;
    const remove = jest.fn();
    const addEventListenerSpy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((eventName: any, handler: any) => {
        expect(eventName).toBe('hardwareBackPress');
        hardwareBackHandler = handler;
        return { remove } as any;
      });

    const goBack = jest.fn();
    const { testRenderer } = await renderScreen({
      canGoBack: jest.fn(() => true),
      goBack,
    });

    expect(typeof hardwareBackHandler).toBe('function');
    expect(hardwareBackHandler?.()).toBe(true);
    expect(goBack).toHaveBeenCalledTimes(1);

    act(() => {
      testRenderer.unmount();
    });

    expect(remove).toHaveBeenCalledTimes(1);
    addEventListenerSpy.mockRestore();
  });
});
