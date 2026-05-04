// Basic Jest setup for React Native app environment
// - Mocks gesture handler native module
// - Ensures react-native-gesture-handler is initialized
// - Provides minimal mocks for native modules used in tests

import 'react-native-gesture-handler/jestSetup';

// Silence React Native gesture-handler warnings in tests
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureHandlerRootView: ({children}) => children,
  };
});

// Mock SafeAreaContext to avoid native dependency
jest.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaProvider: ({children}) => children,
    SafeAreaView: ({children}) => children,
    useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}),
  };
});

// Mock NetInfo for service-level tests that depend on connectivity listeners
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({isConnected: true})),
  },
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getUniqueId: jest.fn(async () => 'jest-device-id'),
  },
}));

jest.mock('react-native-localize', () => ({
  __esModule: true,
  default: {
    findBestLanguageTag: jest.fn(() => ({languageTag: 'pt-BR', isRTL: false})),
    getCountry: jest.fn(() => 'BR'),
    getCurrencies: jest.fn(() => ['BRL']),
    getLocales: jest.fn(() => [
      {
        countryCode: 'BR',
        languageCode: 'pt',
        languageTag: 'pt-BR',
        isRTL: false,
      },
    ]),
    getNumberFormatSettings: jest.fn(() => ({
      decimalSeparator: ',',
      groupingSeparator: '.',
    })),
    getTimeZone: jest.fn(() => 'America/Fortaleza'),
    uses24HourClock: jest.fn(() => true),
    usesMetricSystem: jest.fn(() => true),
  },
  findBestLanguageTag: jest.fn(() => ({languageTag: 'pt-BR', isRTL: false})),
  getCountry: jest.fn(() => 'BR'),
  getCurrencies: jest.fn(() => ['BRL']),
  getLocales: jest.fn(() => [
    {
      countryCode: 'BR',
      languageCode: 'pt',
      languageTag: 'pt-BR',
      isRTL: false,
    },
  ]),
  getNumberFormatSettings: jest.fn(() => ({
    decimalSeparator: ',',
    groupingSeparator: '.',
  })),
  getTimeZone: jest.fn(() => 'America/Fortaleza'),
  uses24HourClock: jest.fn(() => true),
  usesMetricSystem: jest.fn(() => true),
}));

// Mock AsyncStorage for Jest environment
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    setItem: async (key, value) => {
      store[key] = value;
      return value;
    },
    getItem: async key => (key in store ? store[key] : null),
    removeItem: async key => {
      delete store[key];
    },
    clear: async () => {
      store = {};
    },
    getAllKeys: async () => Object.keys(store),
  };
});

// Mock Reanimated (per RN docs for Jest)
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  // The mock includes a value for call, mock it out for tests
  Reanimated.default.call = () => {};

  return Reanimated;
});

// Mute native animated helper warnings (explicit stub to avoid module resolution issues)
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({
  default: {
    addListener: () => {},
    removeListeners: () => {},
  },
}));
// Some environments may resolve with lowercase "libraries"
jest.mock('react-native/libraries/Animated/NativeAnimatedHelper', () => ({
  default: {
    addListener: () => {},
    removeListeners: () => {},
  },
}));
