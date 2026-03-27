import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TouchableOpacity,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useTranslation } from 'react-i18next';

import { WeatherIcon } from '../weather/WeatherIcon';
import { WeatherAnimatedIcon } from '../weather/WeatherAnimatedIcon';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { WeatherResult, WeatherService } from '../../services/WeatherService';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { isUsableWeatherCityName, toCityOnlyLabel } from './weatherCityUtils';
import { getTimeOfDayPhase } from '../../utils/weatherTimeOfDay';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';

type WeatherWidgetProps = {
  refreshToken?: number;
  operationalWeatherSignal?: {
    icon: string;
    label: string;
  } | null;
};

const WEATHER_LOAD_GUARD_MS = 9000;
const WEATHER_AUTO_REFRESH_MS = 60 * 1000;
const DEGREE_SYMBOL = '\u00B0';
const KNOWN_WEATHER_ICONS = new Set([
  'weather-sunny',
  'weather-night',
  'weather-partly-cloudy',
  'weather-night-partly-cloudy',
  'weather-cloudy',
  'weather-fog',
  'weather-rainy',
  'weather-pouring',
  'weather-snowy',
  'weather-snowy-heavy',
  'weather-hail',
  'weather-lightning-rainy',
  'weather-windy',
  'weather-hurricane',
]);

const THUNDER_PATTERN =
  /(trov|trovo|trovao|trov[aã]o|raio|raios|relamp|rel[aâ]mp|thunder|lightning|storm|tempest)/i;
const LIGHTNING_PATTERN = /(raio|raios|lightning|lightnings|relamp|rel[aâ]mp)/i;
const THUNDER_WORD_PATTERN = /(trov|trovo|trovao|trov[aã]o|thunder|storm|tempest)/i;
const SNOW_PATTERN = /(neve|snow|sleet|blizzard)/i;
const HAIL_PATTERN = /(granizo|hail|ice-pellet|ice pellet|graupel)/i;
const RAIN_PATTERN = /(chuv|rain|drizzle|showers?|pouring)/i;

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const sanitizeTemperatureLabel = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined) return '';
  const normalized = String(raw)
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/\u00C2/g, '')
    .replace(/ï¿½/g, '')
    .replace(/[?¿]+/g, '')
    .replace(/[Ã‚Ãƒ]/g, '')
    .replace(/\u00BA/g, DEGREE_SYMBOL)
    .replace(/Âº/g, DEGREE_SYMBOL)
    .replace(/[Аº]/g, DEGREE_SYMBOL)
    .replace(/\u00B0?\s*C/gi, DEGREE_SYMBOL)
    .replace(/[^\d\s/.,+\-\u00B0]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const matches = normalized.match(/-?\d+(?:[.,]\d+)?/g) || [];
  if (matches.length === 0) return '';
  if (matches.length >= 2 && normalized.includes('/')) {
    const [firstRaw, secondRaw] = matches;
    if (firstRaw && secondRaw) {
      const first = Number(firstRaw.replace(',', '.'));
      const second = Number(secondRaw.replace(',', '.'));
      if (Number.isFinite(first) && Number.isFinite(second)) {
        return `${Math.round(first)}${DEGREE_SYMBOL}/${Math.round(second)}${DEGREE_SYMBOL}`;
      }
    }
  }
  const [singleRaw] = matches;
  if (!singleRaw) return '';
  const value = Number(singleRaw.replace(',', '.'));
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}${DEGREE_SYMBOL}`;
};

const extractTemperatureNumbers = (raw: string | number | null | undefined): number[] => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return [raw];
  }
  if (raw === null || raw === undefined) return [];
  const normalized = String(raw)
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/\u00C2/g, '')
    .replace(/ï¿½/g, '')
    .replace(/[?¿]+/g, '')
    .replace(/[Ã‚Ãƒ]/g, '')
    .replace(/[Аº]/g, '\u00B0')
    .replace(/\u00BA/g, '\u00B0')
    .replace(/Âº/g, '\u00B0')
    .replace(/,/g, '.');
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
  return matches
    .map(item => Number(item))
    .filter(item => Number.isFinite(item));
};

const formatTemperatureRangeDisplay = (
  maxTemp: string | number | null | undefined,
  minTemp: string | number | null | undefined,
  fallbackRange?: string | null,
): string => {
  const safeMax = sanitizeTemperatureLabel(maxTemp);
  const safeMin = sanitizeTemperatureLabel(minTemp);
  if (safeMax && safeMin) {
    return `${safeMax}/${safeMin}`;
  }
  const fallbackValues = extractTemperatureNumbers(fallbackRange);
  if (fallbackValues.length >= 2) {
    return `${Math.round(fallbackValues[0])}\u00B0/${Math.round(fallbackValues[1])}\u00B0`;
  }
  return '';
};

const sanitizeWeatherText = (raw: string | null | undefined): string => {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/[?¿]+/g, '')
    .replace(/[Ã‚Ãƒ]/g, '')
    .replace(/[^\p{L}\p{N}\s\-_,./:+()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const sanitizeWeatherIconName = (raw: string | null | undefined): string => {
  const normalized = sanitizeWeatherText(raw);
  if (!normalized) {
    return 'weather-cloudy';
  }
  if (KNOWN_WEATHER_ICONS.has(normalized)) {
    return normalized;
  }
  return 'weather-cloudy';
};

type CanonicalWeatherSignalKey =
  | 'rain'
  | 'snow'
  | 'hail'
  | 'lightning'
  | 'thunder';

const resolveCanonicalWeatherSignal = (
  values: Array<{ icon?: string | null; label?: string | null }>,
): CanonicalWeatherSignalKey | null => {
  for (const value of values) {
    const icon = sanitizeWeatherIconName(value.icon);
    const label = sanitizeWeatherText(value.label);
    const combined = `${icon} ${label}`.toLowerCase();

    if (!combined.trim()) continue;

    if (HAIL_PATTERN.test(combined) || icon === 'weather-hail') return 'hail';
    if (SNOW_PATTERN.test(combined) || icon === 'weather-snowy' || icon === 'weather-snowy-heavy') {
      return 'snow';
    }
    if (LIGHTNING_PATTERN.test(combined) && !THUNDER_WORD_PATTERN.test(combined)) return 'lightning';
    if (THUNDER_WORD_PATTERN.test(combined) || icon === 'weather-lightning-rainy') return 'thunder';
    if (
      RAIN_PATTERN.test(combined) ||
      icon === 'weather-rainy' ||
      icon === 'weather-pouring'
    ) {
      return 'rain';
    }
  }
  return null;
};

const mapCanonicalSignalToWeatherPresentation = (
  signal: CanonicalWeatherSignalKey,
  t: (key: string) => string,
) => {
  switch (signal) {
    case 'snow':
      return { icon: 'weather-snowy', label: t('weather_signal_snow') };
    case 'hail':
      return { icon: 'weather-hail', label: t('weather_signal_hail') };
    case 'lightning':
      return { icon: 'weather-lightning-rainy', label: t('weather_signal_lightning') };
    case 'thunder':
      return { icon: 'weather-lightning-rainy', label: t('weather_signal_thunder') };
    case 'rain':
    default:
      return { icon: 'weather-rainy', label: t('weather_signal_rain') };
  }
};

const impliesThunderstorm = (...values: Array<string | null | undefined>) =>
  values.some(value => THUNDER_PATTERN.test(String(value || '')));

const formatPrimaryTemperature = (raw: string | number | null | undefined): string => {
  const normalized = sanitizeTemperatureLabel(raw);
  if (!normalized || normalized === '--') return '--';
  const numeric = normalized.match(/-?\d+(?:[.,]\d+)?/);
  if (!numeric) return '--';
  const value = Number(numeric[0].replace(',', '.'));
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value)}${DEGREE_SYMBOL}`;
};

const getRoundedTemperatureValue = (
  raw: string | number | null | undefined,
): number | null => {
  const [value] = extractTemperatureNumbers(raw);
  return Number.isFinite(value) ? Math.round(value) : null;
};

const formatRoundedTemperatureValue = (value: number | null): string => {
  if (value === null) return '';
  return `${value}${DEGREE_SYMBOL}`;
};

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const WeatherWidget = React.memo(
  ({ refreshToken, operationalWeatherSignal }: WeatherWidgetProps) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { securityState } = useSecurity();
  const { width: screenWidth } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState({
    temp: '--',
    icon: 'weather-cloudy',
    label: '',
    forecast: '',
    maxTemp: '',
    minTemp: '',
    feelsLike: '',
    intelligenceSignal: null as WeatherResult['intelligenceSignal'],
    isDay: true,
    sunrise: '',
    sunset: '',
    timeZone: '',
  });
  const [forecastDays, setForecastDays] = useState<WeatherResult['forecastDays']>([]);
  const [forecastVisible, setForecastVisible] = useState(false);
  const lastSnapshot = useRef<{
    city: string;
    temp: string;
    icon: string;
    label: string;
    forecast: string;
    maxTemp: string;
    minTemp: string;
    feelsLike: string;
    intelligenceSignal: WeatherResult['intelligenceSignal'];
    isDay: boolean;
    sunrise: string;
    sunset: string;
    timeZone: string;
    forecastKey: string;
  } | null>(null);
  const loadGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phaseClockTick, setPhaseClockTick] = useState(0);

  useEffect(() => {
    void loadWeather();
  }, [securityState.location?.latitude, securityState.location?.longitude]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void loadWeather();
    }, WEATHER_AUTO_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [securityState.location?.latitude, securityState.location?.longitude]);

  const isUsableLocationName = (value?: string) => {
    return isUsableWeatherCityName(value, [t('monitoring_title'), t('gps_off'), '--']);
  };

  const locationFallback = useMemo(() => {
    const byName = toCityOnlyLabel(securityState.locationName);
    if (isUsableLocationName(byName)) return byName;
    return '';
  }, [
    securityState.locationName,
    t,
  ]);

  useEffect(() => {
    const nextLocationName = toCityOnlyLabel(securityState.locationName);
    if (!isUsableLocationName(nextLocationName)) return;
    if (city !== nextLocationName) {
      setCity(nextLocationName);
    }
  }, [city, securityState.locationName, t]);

  useEffect(() => {
    if (typeof refreshToken === 'number' && refreshToken > 0) {
      void loadWeather(true);
    }
  }, [refreshToken]);

  useEffect(() => {
    return () => {
      if (loadGuardRef.current) {
        clearTimeout(loadGuardRef.current);
        loadGuardRef.current = null;
      }
      if (phaseTickRef.current) {
        clearInterval(phaseTickRef.current);
        phaseTickRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (phaseTickRef.current) return;
    phaseTickRef.current = setInterval(() => {
      setPhaseClockTick(prev => prev + 1);
    }, 5 * 60 * 1000);
    return () => {
      if (phaseTickRef.current) {
        clearInterval(phaseTickRef.current);
        phaseTickRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (hasLoaded && loadGuardRef.current) {
      clearTimeout(loadGuardRef.current);
      loadGuardRef.current = null;
    }
  }, [hasLoaded]);

  const applyWeather = (data: {
    city: string;
    temp: string;
    icon: string;
    label: string;
    forecastLabel?: string;
    forecastDays?: WeatherResult['forecastDays'];
    maxTemp?: string;
    minTemp?: string;
      feelsLike?: string;
      intelligenceSignal?: WeatherResult['intelligenceSignal'];
      isDay?: boolean;
    sunrise?: string;
    sunset?: string;
    timeZone?: string;
  }) => {
    const sanitizedCity = sanitizeWeatherText(data.city);
    const sanitizedLabel = sanitizeWeatherText(data.label);
    const sanitizedForecastLabel = sanitizeWeatherText(data.forecastLabel);
    const directCity =
      sanitizedCity && isUsableLocationName(sanitizedCity)
        ? toCityOnlyLabel(sanitizedCity)
        : undefined;
    const resolvedCity =
      directCity ||
      locationFallback ||
      lastSnapshot.current?.city ||
      city ||
      t('gps_off');
    const resolvedLabel =
      sanitizedLabel && sanitizedLabel !== '...'
        ? sanitizedLabel
        : '--';
    const resolvedForecast = sanitizedForecastLabel || '';
    const nextForecastDays = data.forecastDays || [];
    const forecastKey = nextForecastDays
      .map(day => `${day?.dayLabel}-${day?.icon}-${day?.maxTemp}-${day?.minTemp}`)
      .join('|');
    const next = {
      city: resolvedCity,
      temp: sanitizeTemperatureLabel(data.temp) || '--',
      icon: sanitizeWeatherIconName(data.icon),
      label: resolvedLabel,
      forecast: resolvedForecast,
      maxTemp: sanitizeTemperatureLabel(data.maxTemp) || '',
      minTemp: sanitizeTemperatureLabel(data.minTemp) || '',
      feelsLike: sanitizeTemperatureLabel(data.feelsLike) || '',
      intelligenceSignal: data.intelligenceSignal
        ? {
            ...data.intelligenceSignal,
            icon: sanitizeWeatherIconName(data.intelligenceSignal.icon),
            label: sanitizeWeatherText(data.intelligenceSignal.label),
          }
        : null,
      isDay: typeof data.isDay === 'boolean' ? data.isDay : weather.isDay,
      sunrise: typeof data.sunrise === 'string' ? data.sunrise : weather.sunrise,
      sunset: typeof data.sunset === 'string' ? data.sunset : weather.sunset,
      timeZone: typeof data.timeZone === 'string' ? data.timeZone : weather.timeZone,
      forecastKey,
    };
    const prev = lastSnapshot.current;
    if (
      prev &&
      prev.city === next.city &&
      prev.temp === next.temp &&
      prev.icon === next.icon &&
      prev.label === next.label &&
      prev.forecast === next.forecast &&
      prev.maxTemp === next.maxTemp &&
      prev.minTemp === next.minTemp &&
      prev.feelsLike === next.feelsLike &&
      JSON.stringify(prev.intelligenceSignal || null) === JSON.stringify(next.intelligenceSignal || null) &&
      prev.isDay === next.isDay &&
      prev.sunrise === next.sunrise &&
      prev.sunset === next.sunset &&
      prev.timeZone === next.timeZone &&
      prev.forecastKey === next.forecastKey
    ) {
      return;
    }
    lastSnapshot.current = next;
    setCity(next.city);
    setWeather({
      temp: next.temp,
      icon: next.icon,
      label: next.label,
      forecast: next.forecast,
      maxTemp: next.maxTemp,
      minTemp: next.minTemp,
      feelsLike: next.feelsLike,
      intelligenceSignal: next.intelligenceSignal,
      isDay: next.isDay,
      sunrise: next.sunrise,
      sunset: next.sunset,
      timeZone: next.timeZone,
    });
    setForecastDays(
      nextForecastDays.map(day => ({
        ...day,
        dayLabel: sanitizeWeatherText(day.dayLabel),
        icon: sanitizeWeatherIconName(day.icon),
        maxTemp: sanitizeTemperatureLabel(day.maxTemp) || '--',
        minTemp: sanitizeTemperatureLabel(day.minTemp) || '--',
      })),
    );
  };

  const applyFallbackState = () => {
    const lastKnownCity =
      lastSnapshot.current?.city || city || locationFallback || t('gps_off');
    setCity(lastKnownCity);
    setWeather(prev => ({
      ...prev,
      label:
        prev.label && prev.label !== '...' && prev.label !== '--'
          ? prev.label
          : '',
      intelligenceSignal: prev.intelligenceSignal || null,
    }));
    setLoading(false);
    setHasLoaded(true);
  };

  const loadWeather = async (force = false) => {
    const hasStableSnapshot = Boolean(lastSnapshot.current);

    if (!hasLoaded && !hasStableSnapshot && !loadGuardRef.current) {
      loadGuardRef.current = setTimeout(() => {
        applyFallbackState();
      }, WEATHER_LOAD_GUARD_MS);
    }

    if (!hasLoaded && !hasStableSnapshot) {
      setLoading(true);
    }

    try {
      if (!force) {
        const cached = await WeatherService.getCachedWeather();
        if (cached) {
          applyWeather(cached);
          setLoading(false);
          setHasLoaded(true);
        }
      }

      const lat = securityState.location?.latitude;
      const lon = securityState.location?.longitude;
      const hasCoordinates =
        canUseLocationForRiskMaps(securityState) && isFiniteCoordinatePair(lat, lon);

      const resolve = async (latitude: number, longitude: number) => {
        const data = await WeatherService.getCurrentWeather(latitude, longitude, { force });
        applyWeather(data);
        setLoading(false);
        setHasLoaded(true);
      };

      if (hasCoordinates && isFiniteCoordinate(lat) && isFiniteCoordinate(lon)) {
        await resolve(lat, lon);
        return;
      }

      if (!hasStableSnapshot && !hasLoaded) {
        applyFallbackState();
      } else {
        setLoading(false);
      }
    } catch {
      if (!hasStableSnapshot && !hasLoaded) {
        applyFallbackState();
      } else {
        setLoading(false);
      }
    }
  };

  const isInitialLoading = loading && !hasLoaded;

  const openForecast = () => {
    ReactNativeHapticFeedback.trigger(ThemeTokens.haptics.light);
    setForecastVisible(true);
  };

  const timeOfDayPhase = useMemo(
    () =>
      getTimeOfDayPhase({
        now: new Date(),
        timezone: weather.timeZone || undefined,
        isDay: weather.isDay,
        sunrise: weather.sunrise || undefined,
        sunset: weather.sunset || undefined,
      }),
    [phaseClockTick, weather.isDay, weather.sunrise, weather.sunset, weather.timeZone],
  );
  const weatherBarColors = useMemo(
    () => ({
      backgroundColor: ThemeTokens.WeatherBar.bg[timeOfDayPhase],
      borderColor: ThemeTokens.WeatherBar.border[timeOfDayPhase],
      textColor: ThemeTokens.WeatherBar.text[timeOfDayPhase],
      textSecondaryColor: ThemeTokens.WeatherBar.textSecondary[timeOfDayPhase],
      textTertiaryColor: ThemeTokens.WeatherBar.textTertiary[timeOfDayPhase],
      iconTint: ThemeTokens.WeatherBar.iconTint[timeOfDayPhase],
    }),
    [timeOfDayPhase],
  );

  const homeWeatherBarColors = useMemo(
    () => ({
      backgroundColor: ThemeTokens.colors.light.primary,
      borderColor: 'rgba(17,17,17,0.08)',
      textColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.92)',
      textTertiaryColor: 'rgba(255,255,255,0.80)',
      iconTint: '#FFFFFF',
    }),
    [],
  );
  const canonicalSignal = useMemo(
    () =>
      resolveCanonicalWeatherSignal([
        operationalWeatherSignal || {},
        weather.intelligenceSignal || {},
        { icon: weather.icon, label: weather.label },
        { label: weather.forecast },
      ]),
    [
      operationalWeatherSignal,
      weather.forecast,
      weather.icon,
      weather.intelligenceSignal,
      weather.label,
    ],
  );
  const canonicalPresentation = canonicalSignal
    ? mapCanonicalSignalToWeatherPresentation(canonicalSignal, t)
    : null;
  const displayedIcon = sanitizeWeatherIconName(
    canonicalPresentation?.icon ||
      (impliesThunderstorm(
        operationalWeatherSignal?.label,
        weather.intelligenceSignal?.label,
        weather.label,
        weather.forecast,
      )
        ? 'weather-lightning-rainy'
        : operationalWeatherSignal?.icon && operationalWeatherSignal.icon.trim()
          ? operationalWeatherSignal.icon
          : weather.intelligenceSignal?.icon && weather.intelligenceSignal.icon.trim()
            ? weather.intelligenceSignal.icon
            : weather.icon),
  );
  const displayedConditionLabel = sanitizeWeatherText(
    canonicalPresentation?.label ||
      (operationalWeatherSignal?.label && operationalWeatherSignal.label.trim()
        ? operationalWeatherSignal.label
        : weather.intelligenceSignal?.label && weather.intelligenceSignal.label.trim()
          ? weather.intelligenceSignal.label
          : weather.label),
  );
  const tempDisplay = formatPrimaryTemperature(weather.temp);

  const feelsLikeValue = getRoundedTemperatureValue(weather.feelsLike);
  const fallbackRangeValues = extractTemperatureNumbers(weather.forecast);
  const maxTempValue = getRoundedTemperatureValue(weather.maxTemp) ?? (fallbackRangeValues[0] ?? null);
  const minTempValue = getRoundedTemperatureValue(weather.minTemp) ?? (fallbackRangeValues[1] ?? null);
  const feelsLikeDisplay = formatRoundedTemperatureValue(feelsLikeValue);
  const maxMinLabel =
    maxTempValue !== null && minTempValue !== null
      ? `${formatRoundedTemperatureValue(maxTempValue)}/${formatRoundedTemperatureValue(minTempValue)}`
      : formatTemperatureRangeDisplay(weather.maxTemp, weather.minTemp, weather.forecast);
  const feelsLikeLabel = feelsLikeDisplay
    ? t('weather_feels_like', { temp: feelsLikeDisplay })
    : '';
  const safeCity = sanitizeWeatherText(city);
  const cityDisplay =
    safeCity && isUsableLocationName(safeCity) ? safeCity : locationFallback || t('gps_off');
  const conditionLabel =
    typeof displayedConditionLabel === 'string' ? displayedConditionLabel.trim() : '';
  const conditionDisplay =
    conditionLabel &&
    conditionLabel !== '...' &&
    conditionLabel !== '--' &&
    conditionLabel !== '?'
      ? conditionLabel
      : t('forecast_unavailable');
  const weatherAccessibilityLabel = t('weather_city_accessibility', {
    city: cityDisplay,
    temp: tempDisplay,
    condition: conditionDisplay,
  });
  const cityAccessibilityLabel = t('city_accessibility_label', {
    defaultValue: `Cidade: ${cityDisplay}`,
    city: cityDisplay,
  });
  const cityAllowsTwoLines = cityDisplay.length > 20 && screenWidth >= 390;
  const cityNumberOfLines = cityAllowsTwoLines ? 2 : 1;
  const homeIconSize =
    screenWidth < 360
      ? ThemeTokens.WeatherIcon.sizes.homeCompact + 10
      : ThemeTokens.WeatherIcon.sizes.home + 12;
  const homeIconHitArea = Math.max(
    homeIconSize + 4,
    ThemeTokens.WeatherIcon.sizes.hitArea + 4,
  );
  const iconLatitude = isFiniteCoordinate(securityState.location?.latitude)
    ? securityState.location.latitude
    : null;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: homeWeatherBarColors.backgroundColor,
            borderColor: homeWeatherBarColors.borderColor,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.mainTapArea}
          activeOpacity={0.88}
          onPress={openForecast}
          accessibilityRole="button"
          accessibilityLabel={weatherAccessibilityLabel}
          accessibilityHint={t('home_bar_tap_details')}
        >
          <View style={styles.topRow}>
            <Text style={[styles.tempBig, { color: homeWeatherBarColors.textColor }]}>{tempDisplay}</Text>
            <View style={[styles.weatherIconSlot, { width: homeIconHitArea, height: homeIconHitArea }]}>
              {isInitialLoading ? (
                <ActivityIndicator color={homeWeatherBarColors.iconTint} />
              ) : (
                <WeatherAnimatedIcon
                  conditionCode={displayedIcon}
                  isDay={weather.isDay}
                  latitude={iconLatitude}
                  size={homeIconSize}
                  renderMode="hero"
                  style={styles.weatherIconWrap}
                />
              )}
            </View>
          </View>

          <View style={styles.centerMeta}>
            <View style={styles.cityRow}>
              <Icon
                name="map-marker"
                size={18}
                color={homeWeatherBarColors.iconTint}
                style={styles.cityIcon}
              />
              <View style={styles.cityTextWrap}>
                <Text
                  style={[styles.cityName, { color: homeWeatherBarColors.textColor }]}
                  accessibilityRole="text"
                  accessibilityLabel={cityAccessibilityLabel}
                  numberOfLines={cityNumberOfLines}
                  ellipsizeMode="tail"
                  allowFontScaling
                  maxFontSizeMultiplier={ThemeTokens.WeatherBar.CityText.maxFontSizeMultiplier}
                >
                  {cityDisplay}
                </Text>
              </View>
            </View>
            <Text style={[styles.conditionText, { color: homeWeatherBarColors.textSecondaryColor }]}>{conditionDisplay}</Text>
            {maxMinLabel ? <Text style={[styles.maxMinText, { color: homeWeatherBarColors.textSecondaryColor }]}>{maxMinLabel}</Text> : null}
            {feelsLikeLabel ? <Text style={[styles.feelsLikeText, { color: homeWeatherBarColors.textTertiaryColor }]}>{feelsLikeLabel}</Text> : null}
          </View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={forecastVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForecastVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setForecastVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              {
                backgroundColor: weatherBarColors.backgroundColor,
                borderColor: weatherBarColors.borderColor,
              },
            ]}
            onPress={() => {}}
          >
            <Text style={[styles.modalTitleCentered, { color: weatherBarColors.textColor }]}>
              {cityDisplay}
            </Text>

            {forecastDays && forecastDays.length > 0 ? (
              <View style={styles.forecastGrid}>
                {forecastDays.map((day, index) => (
                  <View key={`${day.dayLabel}-${index}`} style={styles.forecastItem}>
                    <Text style={[styles.forecastDay, { color: weatherBarColors.textColor }]}>
                      {day.dayLabel}
                    </Text>
                    <WeatherIcon icon={day.icon} size={32} />
                    <Text
                      style={[
                        styles.forecastTemps,
                        { color: weatherBarColors.textSecondaryColor },
                      ]}
                    >
                      {sanitizeTemperatureLabel(day.maxTemp)} / {sanitizeTemperatureLabel(day.minTemp)}
                    </Text>
                    {typeof day.rainChance === 'number' ? (
                      <Text
                        style={[
                          styles.forecastRain,
                          { color: weatherBarColors.textSecondaryColor },
                        ]}
                      >
                        {t('forecast_rain_chance', { chance: day.rainChance })}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text
                style={[
                  styles.emptyForecast,
                  { color: weatherBarColors.textSecondaryColor },
                ]}
              >
                {t('forecast_unavailable')}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={() => setForecastVisible(false)}
            >
              <Text style={styles.modalButtonText}>{t('close')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
  },
);

WeatherWidget.displayName = 'WeatherWidget';

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.md,
  },
  loadingContainer: { height: 110, justifyContent: 'center' },
  card: {
    borderRadius: ThemeTokens.radius.xl,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 110,
    borderWidth: 1,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  mainTapArea: {
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingTop: ThemeTokens.spacing.xs,
    paddingBottom: ThemeTokens.spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tempBig: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 36,
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  weatherIconSlot: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherIconWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -1 }, { scale: 1.04 }],
  },
  centerMeta: { alignItems: 'stretch', marginTop: 4 },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: ThemeTokens.spacing.sm,
    paddingHorizontal: ThemeTokens.spacing.xs,
  },
  cityIcon: {
    flexShrink: 0,
  },
  cityTextWrap: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '88%',
  },
  cityName: {
    fontSize: ThemeTokens.WeatherBar.CityText.fontSize,
    fontWeight: ThemeTokens.WeatherBar.CityText.fontWeight,
    letterSpacing: ThemeTokens.WeatherBar.CityText.letterSpacing,
    lineHeight: ThemeTokens.WeatherBar.CityText.lineHeight,
    fontFamily: FONT_FAMILY,
    color: '#FFF',
    textAlign: 'center',
    includeFontPadding: false,
  },
  conditionText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    alignSelf: 'center',
  },
  maxMinText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
    lineHeight: 21,
    fontFamily: FONT_FAMILY,
  },
  feelsLikeText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 1,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
  },
  forecastText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
    fontFamily: FONT_FAMILY,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: ThemeTokens.spacing.xl,
  },
  modalCard: {
    borderRadius: ThemeTokens.radius.lg,
    padding: ThemeTokens.spacing.lg,
    borderWidth: 1,
  },
  modalTitleCentered: {
    fontSize: ThemeTokens.typography.sizes.title,
    fontWeight: '800',
    marginBottom: ThemeTokens.spacing.lg,
    textAlign: 'center',
    fontFamily: FONT_FAMILY,
  },
  forecastGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: ThemeTokens.spacing.lg,
  },
  forecastItem: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  forecastDay: {
    fontSize: ThemeTokens.typography.sizes.body,
    fontWeight: '700',
    marginBottom: 6,
    fontFamily: FONT_FAMILY,
  },
  forecastTemps: {
    fontSize: ThemeTokens.typography.sizes.body,
    fontWeight: '600',
    marginTop: 6,
    fontFamily: FONT_FAMILY,
  },
  forecastRain: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    fontFamily: FONT_FAMILY,
  },
  emptyForecast: {
    fontSize: ThemeTokens.typography.sizes.body,
    textAlign: 'center',
    marginBottom: ThemeTokens.spacing.lg,
    fontFamily: FONT_FAMILY,
  },
  modalButton: {
    height: 46,
    borderRadius: ThemeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: ThemeTokens.typography.sizes.body,
    fontFamily: FONT_FAMILY,
  },
});

