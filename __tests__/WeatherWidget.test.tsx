import React from 'react';
import renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {WeatherWidget} from '../src/components/home/WeatherWidget';
import {GetWeatherFeedQuery} from '../src/application/queries/GetWeatherFeedQuery';
import type {WeatherResult} from '../src/services/WeatherService';
import * as measurementUnits from '../src/utils/measurementUnits';

const mockSecurityState: {
  location: {latitude: number; longitude: number} | null;
  locationName: string;
  locationCountryCode: string | null;
} = {
  location: {latitude: -3.7319, longitude: -38.5267},
  locationName: 'Fortaleza, CE',
  locationCountryCode: 'BR',
};
let mockLanguage = 'pt-BR';

jest.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        gps_off: 'GPS disabled',
        current_location: mockLanguage.startsWith('pt')
          ? 'Sua localização'
          : 'Your location',
        forecast_unavailable: 'Previsão indisponível no momento.',
        forecast_day_unavailable: 'Dados indisponiveis',
        forecast_day_updating: 'Atualizando',
        forecast_rain_chance: `${options?.chance}% chuva`,
        weather_unknown: 'Clima indisponível',
        weather_clear_sky_day: 'Céu limpo',
        weather_clear_sky_night: 'Noite limpa',
        weather_partly_cloudy: 'Parcialmente nublado',
        weather_overcast: 'Nublado',
        weather_feels_like: `Sensação térmica ${options?.temp || ''}`.trim(),
        weather_condition_in_city: `${options?.condition} em ${options?.city}`,
        weather_safety_safe_now: 'Seguro agora',
        weather_safety_low_now: 'Baixo risco climático agora',
        weather_safety_watch_nearby: 'Atenção climática próxima',
        weather_safety_danger_nearby: 'Perigo climático próximo',
        weather_safety_severe_condition: 'Condição severa',
        weather_safety_chip_safe: 'Seguro 1 km',
        weather_safety_chip_low: 'Seguro 1 km',
        weather_safety_chip_watch: 'Atenção 1 km',
        weather_safety_chip_danger: 'Perigo 1 km',
        weather_safety_chip_severe: 'Severo 1 km',
        weather_city_accessibility: `Clima em ${options?.city}, ${options?.temp}, ${options?.condition}`,
        home_bar_tap_details: 'Toque para ver detalhes',
        close: mockLanguage.startsWith('pt') ? 'Fechar' : 'Close',
        widget_updated_now: 'Atualizado agora',
        widget_updated_minutes_ago: `Atualizado há ${options?.count} min`,
        widget_updated_hours_ago: `Atualizado há ${options?.count} h`,
        widget_updated_days_ago: `Atualizado há ${options?.count} d`,
        weather_refreshing: 'Atualizando',
      };
      return translations[key] || key;
    },
    i18n: {language: mockLanguage},
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const ReactLocal = require('react');
  const {Text} = require('react-native');
  return ({name}: {name: string}) =>
    ReactLocal.createElement(Text, null, `mdi:${name}`);
});

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      primary: '#D32F2F',
      text: '#111111',
      textSecondary: '#666666',
    },
  }),
}));

jest.mock('../src/context/SecurityContext', () => ({
  useSecurity: () => ({
    securityState: mockSecurityState,
  }),
}));

jest.mock('../src/components/ui/BasePopup', () => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: ({
      visible,
      children,
    }: {
      visible: boolean;
      children: React.ReactNode;
    }) =>
      visible
        ? ReactLocal.createElement(ReactLocal.Fragment, null, children)
        : null,
  };
});

jest.mock('../src/components/weather/WeatherAnimatedIcon', () => {
  const ReactLocal = require('react');
  const {Text} = require('react-native');
  return {
    WeatherAnimatedIcon: ({conditionCode}: {conditionCode: string}) =>
      ReactLocal.createElement(Text, null, `icon:${conditionCode}`),
  };
});

jest.mock('../src/components/weather/WeatherIcon', () => {
  const ReactLocal = require('react');
  const {Text} = require('react-native');
  return {
    WeatherIcon: ({icon}: {icon: string}) =>
      ReactLocal.createElement(Text, null, `forecast-icon:${icon}`),
  };
});

jest.mock('../src/application/queries/GetWeatherFeedQuery', () => ({
  GetWeatherFeedQuery: {
    peekCached: jest.fn(),
    primeCache: jest.fn(),
    getCached: jest.fn(),
    execute: jest.fn(),
  },
}));

jest.mock('../src/utils/measurementUnits', () => {
  const actual = jest.requireActual('../src/utils/measurementUnits');
  return {
    ...actual,
    getUserTemperaturePreference: jest.fn(async () => null),
  };
});

const mockedQuery = GetWeatherFeedQuery as jest.Mocked<
  typeof GetWeatherFeedQuery
>;
const mockedGetUserTemperaturePreference =
  measurementUnits.getUserTemperaturePreference as jest.MockedFunction<
    typeof measurementUnits.getUserTemperaturePreference
  >;

const TEST_NOW_ISO = '2026-05-05T10:05:00.000Z';

const makeWeatherResult = (
  overrides?: Partial<WeatherResult>,
): WeatherResult => ({
  city: 'Fortaleza',
  cityName: 'Fortaleza',
  temp: '26°C',
  currentTempC: 26,
  wind: 16,
  icon: 'weather-partly-cloudy',
  conditionCode: 'partly_cloudy_day',
  label: 'Parcialmente nublado',
  conditionLabel: 'Parcialmente nublado',
  feelsLike: '28°C',
  feelsLikeTempC: 28,
  minTemp: '24°C',
  lowTempC: 24,
  maxTemp: '31°C',
  highTempC: 31,
  forecastLabel: '31°C/24°C',
  forecastDays: [
    {
      date: '2026-05-05',
      dayLabel: 'Ter',
      icon: 'weather-partly-cloudy',
      conditionCode: 'partly_cloudy_day',
      maxTemp: '31°C',
      minTemp: '24°C',
      rainChance: 42,
    },
  ],
  precipitationProbability: 42,
  isDay: true,
  sunrise: '2026-05-05T08:30:00.000Z',
  sunset: '2026-05-05T21:00:00.000Z',
  timeZone: 'America/Fortaleza',
  intelligenceSignal: null,
  weatherAlert: null,
  updatedAt: '2026-05-05T10:00:00.000Z',
  timestamp: '2026-05-05T10:00:00.000Z',
  source: 'cache',
  cacheState: 'stale',
  staleAgeMs: 120000,
  ...(overrides || {}),
});

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const collectText = (
  node:
    | renderer.ReactTestRendererJSON
    | renderer.ReactTestRendererJSON[]
    | null,
): string[] => {
  if (node === null) return [];
  if (Array.isArray(node)) {
    return node.flatMap(item => collectText(item));
  }
  const output: string[] = [];
  for (const child of node.children || []) {
    if (typeof child === 'string') {
      output.push(child);
      continue;
    }
    output.push(...collectText(child));
  }
  return output;
};

describe('WeatherWidget', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockSecurityState.location = {latitude: -3.7319, longitude: -38.5267};
    mockSecurityState.locationName = 'Fortaleza, CE';
    mockSecurityState.locationCountryCode = 'BR';
    mockLanguage = 'pt-BR';
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(TEST_NOW_ISO));
    mockedQuery.primeCache.mockResolvedValue(undefined);
    mockedGetUserTemperaturePreference.mockResolvedValue(null);
  });

  afterEach(() => {
    (global as any).__DEV__ = false;
    jest.restoreAllMocks();
  });

  it('renders cached weather immediately when refresh fails', async () => {
    const cachedWeather = makeWeatherResult();
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockRejectedValue(new Error('offline'));

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('26°C');
    expect(renderedText).toContain('Fortaleza');
    // condition label moved out of compact bar by design; ensure primary info still present
    expect(renderedText).not.toContain('--');
    expect(renderedText).not.toContain('Previsão indisponível no momento.');

    act(() => {
      tree!.unmount();
    });
  });

  it('renders Home weather copy in pt-BR without English fallbacks', async () => {
    const cachedWeather = makeWeatherResult({
      conditionCode: 'clear_day',
      label: 'Céu limpo',
      conditionLabel: 'Céu limpo',
      updatedAt: TEST_NOW_ISO,
      timestamp: TEST_NOW_ISO,
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    // compact bar prioritizes temp and city; secondary 'feels like' remains
    expect(renderedText).toContain('Sensação térmica');
    expect(renderedText).not.toContain('Clear sky');
    expect(renderedText).not.toContain('Feels like');
    expect(renderedText).not.toContain('Updated now');

    act(() => {
      tree!.unmount();
    });
  });

  it('keeps the last valid weather visible when the API returns an invalid payload', async () => {
    const cachedWeather = makeWeatherResult();
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue({
      ...cachedWeather,
      currentTempC: null,
      highTempC: null,
      lowTempC: null,
      conditionLabel: '',
      label: '',
    } as unknown as WeatherResult);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('26°C');
    expect(renderedText).toContain('Fortaleza');
    expect(renderedText).not.toContain('Previsão indisponível no momento.');

    act(() => {
      tree!.unmount();
    });
  });

  it('formats temperatures with the user Fahrenheit preference', async () => {
    const cachedWeather = makeWeatherResult();
    mockedGetUserTemperaturePreference.mockResolvedValue('fahrenheit');
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('79°F');
    expect(renderedText).toContain('88°F/75°F');

    act(() => {
      tree!.unmount();
    });
  });

  it('never renders ellipsis as the city and falls back to current location', async () => {
    mockSecurityState.locationName = '...';
    const cachedWeather = makeWeatherResult({
      city: '...',
      cityName: '',
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Sua localização');
    expect(renderedText).not.toContain('...');

    act(() => {
      tree!.unmount();
    });
  });

  it('uses the resolved local city instead of a safe-mode debug city', async () => {
    mockSecurityState.locationName = 'Trindade, GO';
    const cachedWeather = makeWeatherResult({
      city: 'Safe City 88',
      cityName: 'Safe City 88',
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Trindade');
    expect(renderedText).not.toContain('Safe City 88');

    act(() => {
      tree!.unmount();
    });
  });

  it('falls back to a friendly current-location label when only safe-mode city exists', async () => {
    mockSecurityState.locationName = '';
    const cachedWeather = makeWeatherResult({
      city: 'Safe City 88',
      cityName: 'Safe City 88',
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Sua localização');
    expect(renderedText).not.toContain('Safe City 88');

    act(() => {
      tree!.unmount();
    });
  });

  it('renders an honest visual fallback without unavailable copy when weather has no live data', async () => {
    mockSecurityState.location = null;
    mockSecurityState.locationName = '';
    mockedQuery.peekCached.mockReturnValue(null);
    mockedQuery.getCached.mockResolvedValue(null);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('--°');
    expect(renderedText).toContain('Sua localização');
    expect(renderedText).not.toContain('Clima indisponÃ­vel');
    expect(renderedText).not.toContain('Weather unavailable');
    expect(mockedQuery.execute).not.toHaveBeenCalled();

    act(() => {
      tree!.unmount();
    });
  });

  it('opens the forecast modal without placeholder forecast days', async () => {
    const cachedWeather = makeWeatherResult({
      forecastDays: [
        {
          date: '2026-05-06',
          dayLabel: 'Qua',
          icon: 'weather-partly-cloudy',
          conditionCode: 'partly_cloudy_day',
          maxTemp: '31Â°C',
          minTemp: '24Â°C',
          rainChance: 42,
        },
        {
          date: '2026-05-07',
          dayLabel: 'Qui',
          icon: 'weather-cloudy',
          conditionCode: 'unknown',
          maxTemp: '--',
          minTemp: '--',
          rainChance: null,
          isUnavailable: true,
        },
        {
          date: '2026-05-08',
          dayLabel: 'Sex',
          icon: 'weather-cloudy',
          conditionCode: 'unknown',
          maxTemp: '--',
          minTemp: '--',
          rainChance: null,
          isUnavailable: true,
        },
      ],
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const openButton = tree!.root.findByProps({
      accessibilityHint: 'Toque para ver detalhes',
    });
    act(() => {
      openButton.props.onPress();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Qua');
    expect(renderedText).toContain('31Â°C/24Â°C');
    expect(renderedText).not.toContain('Qui');
    expect(renderedText).not.toContain('Sex');
    expect(renderedText).not.toContain('Atualizando');
    expect(renderedText).not.toContain('--');
    expect(renderedText).not.toContain('null% chuva');
    expect(renderedText).not.toContain('Previsão indisponível no momento.');

    act(() => {
      tree!.unmount();
    });
  });

  it('renders five forecast cards with three initially fitting the carousel contract', async () => {
    (global as any).__DEV__ = true;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const cachedWeather = makeWeatherResult({
      forecastDays: [
        {
          date: '2026-05-19',
          dayLabel: 'Ter',
          icon: 'weather-partly-cloudy',
          conditionCode: 'partly_cloudy_day',
          maxTemp: '31Â°C',
          minTemp: '24Â°C',
          rainChance: 10,
        },
        {
          date: '2026-05-20',
          dayLabel: 'Qua',
          icon: 'weather-partly-cloudy',
          conditionCode: 'partly_cloudy_day',
          maxTemp: '30Â°C',
          minTemp: '23Â°C',
          rainChance: 20,
        },
        {
          date: '2026-05-21',
          dayLabel: 'Qui',
          icon: 'weather-cloudy',
          conditionCode: 'cloudy',
          maxTemp: '29Â°C',
          minTemp: '22Â°C',
          rainChance: 30,
        },
        {
          date: '2026-05-22',
          dayLabel: 'Sex',
          icon: 'weather-rainy',
          conditionCode: 'rain',
          maxTemp: '28Â°C',
          minTemp: '21Â°C',
          rainChance: 40,
        },
        {
          date: '2026-05-23',
          dayLabel: 'Sáb',
          icon: 'weather-rainy',
          conditionCode: 'rain',
          maxTemp: '27Â°C',
          minTemp: '20Â°C',
          rainChance: 50,
        },
      ],
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const openButton = tree!.root.findByProps({
      accessibilityHint: 'Toque para ver detalhes',
    });
    act(() => {
      openButton.props.onPress();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Ter');
    expect(renderedText).toContain('Qua');
    expect(renderedText).toContain('Qui');
    expect(renderedText).toContain('Sex');
    expect(renderedText).toContain('Sáb');
    expect(renderedText).toContain('Fechar');
    expect(renderedText).not.toContain('Close');

    const forecastCards = tree!.root.findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        /^(Ter|Qua|Qui|Sex|Sáb),/.test(node.props.accessibilityLabel),
    );
    expect(
      new Set(forecastCards.map(node => node.props.accessibilityLabel)).size,
    ).toBe(5);
    const cardWidth = forecastCards[0].props.style[1].width;
    expect(cardWidth).toBeLessThanOrEqual(136);

    const carousel = tree!.root.findAll(
      node => node.props.horizontal === true && node.props.snapToOffsets,
    )[0];
    expect(carousel.props.showsHorizontalScrollIndicator).toBe(false);
    expect(carousel.props.snapToOffsets).toEqual([0, (cardWidth + 10) * 3]);
    expect(carousel.props.directionalLockEnabled).toBe(true);
    expect(carousel.props.nestedScrollEnabled).toBe(true);
    expect(carousel.props.decelerationRate).toBe('normal');
    expect(carousel.props.disableIntervalMomentum).toBe(true);
    const swipeHint = tree!.root.findAll(
      node => node.props.testID === 'forecastSwipeHintRow',
    );
    expect(swipeHint.length).toBeGreaterThanOrEqual(1);

    const swipeHintRow = tree!.root.findByProps({
      testID: 'forecastSwipeHintRow',
    });
    const swipeDots = swipeHintRow.props.children.filter(
      (child: any) =>
        child?.props?.testID &&
        child.props.testID.startsWith('forecastSwipeDot-'),
    );
    expect(swipeDots).toHaveLength(2);
    expect(swipeDots[0].props.accessibilityState.selected).toBe(true);
    expect(swipeDots[1].props.accessibilityState.selected).toBe(false);

    act(() => {
      carousel.props.onMomentumScrollEnd({
        nativeEvent: {
          contentOffset: {
            x: (cardWidth + 10) * 3,
          },
        },
      });
    });
    const updatedSwipeDots = swipeHintRow.props.children.filter(
      (child: any) =>
        child?.props?.testID &&
        child.props.testID.startsWith('forecastSwipeDot-'),
    );
    expect(updatedSwipeDots).toHaveLength(2);
    expect(updatedSwipeDots[0].props.accessibilityState.selected).toBe(false);
    expect(updatedSwipeDots[1].props.accessibilityState.selected).toBe(true);

    expect(
      new Set(forecastCards.map(node => node.props.accessibilityLabel)).size,
    ).toBe(5);
    expect(infoSpy).toHaveBeenCalledWith(
      '[weather/forecast] modal_open',
      expect.stringContaining('"modalForecastCount":5'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[weather/forecast] modal_open',
      expect.stringContaining('"renderedForecastCount":5'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[weather/forecast] modal_open',
      expect.stringContaining('"forecastDetails"'),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[weather/forecast] carousel_visible',
      expect.stringContaining('"visibleForecastLabels":["Sex","Sáb"]'),
    );

    act(() => {
      tree!.unmount();
    });
  });

  it('keeps app chrome English while localizing BR weather copy', async () => {
    mockLanguage = 'en-US';
    await AsyncStorage.setItem('@Alert:Language', 'en-US');
    const cachedWeather = makeWeatherResult({
      forecastDays: [
        {
          date: '2026-05-18',
          dayLabel: 'Mon',
          icon: 'weather-partly-cloudy',
          conditionCode: 'partly_cloudy_day',
          maxTemp: '31Â°C',
          minTemp: '24Â°C',
          rainChance: 10,
        },
        {
          date: '2026-05-19',
          dayLabel: 'Tue',
          icon: 'weather-partly-cloudy',
          conditionCode: 'partly_cloudy_day',
          maxTemp: '30Â°C',
          minTemp: '23Â°C',
          rainChance: 20,
        },
        {
          date: '2026-05-20',
          dayLabel: 'Wed',
          icon: 'weather-cloudy',
          conditionCode: 'cloudy',
          maxTemp: '29Â°C',
          minTemp: '22Â°C',
          rainChance: 30,
        },
      ],
    });
    mockedQuery.peekCached.mockReturnValue(cachedWeather);
    mockedQuery.getCached.mockResolvedValue(cachedWeather);
    mockedQuery.execute.mockResolvedValue(cachedWeather);

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeatherWidget />);
      await flushMicrotasks();
    });

    const openButton = tree!.root.findByProps({
      accessibilityHint: 'Toque para ver detalhes',
    });
    act(() => {
      openButton.props.onPress();
    });

    const renderedText = collectText(tree!.toJSON()).join(' | ');
    expect(renderedText).toContain('Seg');
    expect(renderedText).toContain('Ter');
    expect(renderedText).toContain('Qua');
    expect(renderedText).toContain('Close');

    act(() => {
      tree!.unmount();
    });
  });
});
