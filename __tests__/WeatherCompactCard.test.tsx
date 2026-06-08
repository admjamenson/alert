import React from 'react';
import {StyleSheet} from 'react-native';
import renderer, {act} from 'react-test-renderer';

import {WeatherCompactCard} from '../src/components/home/weather/WeatherCompactCard';
import type {WeatherResult} from '../src/services/WeatherService';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const labels: Record<string, string> = {
        weather_safety_safe_now: 'Safe now',
        weather_safety_low_now: 'Low weather risk now',
        weather_safety_watch_nearby: 'Weather watch nearby',
        weather_safety_danger_nearby: 'Weather danger nearby',
        weather_safety_chip_safe: 'Safe within 1 km',
        weather_safety_chip_low: 'Safe within 1 km',
        weather_safety_chip_watch: 'Watch 1 km',
        weather_safety_chip_danger: 'Danger 1 km',
      };
      if (key === 'weather_condition_in_city') {
        return `${options?.condition} in ${options?.city}`;
      }
      return labels[key] || key;
    },
  }),
}));

jest.mock('../src/components/weather/CinematicWeatherHero', () => {
  const ReactLocal = require('react');
  const {View: RNView} = require('react-native');
  return {
    CinematicWeatherHero: ({children, decision}: any) =>
      ReactLocal.createElement(
        RNView,
        {testID: 'mock-cinematic-weather-hero', decision},
        children,
      ),
  };
});

const weatherBarColors = {
  backgroundColor: '#050810',
  borderColor: '#111111',
  textColor: '#FFFFFF',
  textSecondaryColor: '#DDDDDD',
  textTertiaryColor: '#BBBBBB',
  iconTint: '#FFFFFF',
};

const makeWeatherResult = (
  overrides: Partial<WeatherResult>,
): WeatherResult => ({
  city: 'Fortaleza',
  cityName: 'Fortaleza',
  temp: '31 C',
  currentTempC: 31,
  wind: 12,
  icon: 'weather-sunny',
  conditionCode: 'clear_day',
  label: 'Ceu limpo',
  conditionLabel: 'Ceu limpo',
  feelsLikeTempC: 33,
  lowTempC: 25,
  highTempC: 32,
  precipitationProbability: 0,
  isDay: true,
  updatedAt: '2026-05-05T12:00:00.000Z',
  timestamp: '2026-05-05T12:00:00.000Z',
  source: 'cache',
  cacheState: 'fresh',
  staleAgeMs: null,
  ...(overrides || {}),
});

const renderCard = (weatherResult: WeatherResult, isDark: boolean) => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <WeatherCompactCard
        tempDisplay="31 C"
        conditionDisplay={weatherResult.conditionLabel}
        cityDisplay="Fortaleza"
        feelsLikeDisplay="Feels 33 C"
        rangeDisplay="32 C/25 C"
        precipDisplay=""
        alertDisplay=""
        updatedLabel="Updated now"
        isRefreshing={false}
        isDark={isDark}
        timeOfDayPhase={weatherResult.isDay ? 'day' : 'night'}
        weatherResult={weatherResult}
        locationFallback="Fortaleza"
        temperatureLocale="pt-BR"
        resolvedCountryCode="BR"
        userTempPreference={null}
        weatherAccessibilityLabel="weather"
        onPress={jest.fn()}
        weatherBarColors={weatherBarColors}
        iconConditionCode={weatherResult.conditionCode}
        iconIsDay={weatherResult.isDay}
      />,
    );
  });
  return tree!;
};

describe('WeatherCompactCard visual climate palette', () => {
  it('keeps sunny weather dark, readable, and accented in dark mode', () => {
    const tree = renderCard(makeWeatherResult({conditionCode: 'clear_day'}), true);
    const button = tree.root.findByProps({accessibilityLabel: 'weather'});
    const buttonStyle = StyleSheet.flatten(button.props.style);
    const hero = tree.root.findByProps({testID: 'mock-cinematic-weather-hero'});

    expect(buttonStyle.backgroundColor).toBe('#12233F');
    expect(hero.props.decision.visualTheme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expect(hero.props.decision.visualTheme.textPrimaryColor).toBe('#FFFFFF');
    expect(hero.props.decision.visualTheme.accentColor).toBe('#FFD166');
    expect(hero.props.decision.visualTheme.riskStatus.level).toBe('safe');
    const iconAnchor = tree.root.findByProps({
      testID: 'weather-hero-icon-anchor',
    });
    const iconStyle = StyleSheet.flatten(iconAnchor.props.style);
    expect(iconStyle.position).toBe('absolute');
    expect(iconStyle.right).toBeGreaterThanOrEqual(6);
    expect(iconStyle.right).toBeLessThanOrEqual(14);
    expect(iconStyle.width).toBeGreaterThanOrEqual(76);
    expect(iconStyle.width).toBeLessThanOrEqual(92);
    expect(
      tree.root.findAllByProps({children: 'Safe within 1 km'}).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({children: 'Safe now'}).length).toBeGreaterThan(0);
  });

  it('keeps storm weather dark electric in light mode', () => {
    const tree = renderCard(
      makeWeatherResult({
        conditionCode: 'thunderstorm',
        icon: 'weather-lightning-rainy',
        conditionLabel: 'Tempestade',
      }),
      false,
    );
    const button = tree.root.findByProps({accessibilityLabel: 'weather'});
    const buttonStyle = StyleSheet.flatten(button.props.style);
    const hero = tree.root.findByProps({testID: 'mock-cinematic-weather-hero'});

    expect(buttonStyle.backgroundColor).toBe('#12233F');
    expect(buttonStyle.backgroundColor).not.toBe('#FFFFFF');
    expect(hero.props.decision.visualTheme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expect(hero.props.decision.visualTheme.riskStatus.level).toBe('danger');
    const iconAnchor = tree.root.findByProps({
      testID: 'weather-hero-icon-anchor',
    });
    const iconStyle = StyleSheet.flatten(iconAnchor.props.style);
    expect(iconStyle.top).toBeLessThanOrEqual(10);
    expect(iconStyle.width).toBeLessThanOrEqual(86);
  });

  it('keeps cloudy icons right aligned and away from text content', () => {
    const tree = renderCard(
      makeWeatherResult({
        conditionCode: 'cloudy',
        conditionLabel: 'Cloudy',
      }),
      false,
    );
    const iconAnchor = tree.root.findByProps({
      testID: 'weather-hero-icon-anchor',
    });
    const iconStyle = StyleSheet.flatten(iconAnchor.props.style);
    const tempSection = tree.root.findAll(
      node =>
        Array.isArray(node.props.style) &&
        node.props.style.some(
          (style: Record<string, unknown>) =>
            typeof style?.paddingRight === 'number',
        ),
    )[0];
    const tempSectionStyle = StyleSheet.flatten(tempSection.props.style);

    expect(iconStyle.right).toBeLessThanOrEqual(10);
    expect(iconStyle.width).toBeGreaterThanOrEqual(82);
    expect(tempSectionStyle.paddingRight).toBeGreaterThan(iconStyle.width);
  });
});
