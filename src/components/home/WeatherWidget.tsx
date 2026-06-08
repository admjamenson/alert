/**
 * WeatherWidget — Premium Compact Weather Widget for Home
 *
 * Redesigned complete weather widget with:
 * - Compact card matching RiskMapWidget size
 * - Beautiful SVG weather icons (WeatherHeroIcon)
 * - Horizontal layout with temperature dominance
 * - Chips for range, feels like
 * - Clean update status
 * - All functional behavior preserved (cache, SWR, background refresh)
 * - FIXED: Weather unavailable no longer blocks neon visual rendering
 * - FIXED: Renderable check relaxed for cache/partial data
 * - FIXED: showUnavailable doesn't hide visual card
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {useTranslation} from 'react-i18next';
import {useFocusEffect} from '@react-navigation/native';
import {getCountry} from 'react-native-localize';

import BasePopup from '../ui/BasePopup';
import {WeatherIcon} from '../weather/WeatherIcon';
import {GetWeatherFeedQuery} from '../../application/queries/GetWeatherFeedQuery';
import {useTheme} from '../../context/ThemeContext';
import {useSecurity} from '../../context/SecurityContext';
import {ThemeTokens} from '../../constants/ThemeTokens';
import {selectWeatherVisual} from '../../domain/weather/WeatherVisualSelector';
import {isUsableWeatherCityName, toCityOnlyLabel} from './weatherCityUtils';
import {getTimeOfDayPhase} from '../../utils/weatherTimeOfDay';
import {isFiniteCoordinatePair} from '../../utils/locationQuality';
import {
  formatTemperatureCelsius,
  getUserTemperaturePreference,
  TemperatureUnit,
} from '../../utils/measurementUnits';
import {
  buildPremiumForecastDays,
  WeatherResult,
} from '../../services/WeatherService';
import {getTypographyStyle} from '../../theme/typography';
import {WeatherCompactCard} from './weather/WeatherCompactCard';

type WeatherWidgetProps = {
  refreshToken?: number;
  operationalWeatherSignal?: {
    icon: string;
    label: string;
  } | null;
};

const WEATHER_AUTO_REFRESH_MS = 5 * 60 * 1000;
const MIN_BACKGROUND_REFRESH_INTERVAL_MS = 60 * 1000;
const isFiniteTemperature = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hasAnyWeatherTemperature = (
  value: WeatherResult | null | undefined,
): boolean =>
  Boolean(
    value &&
      (isFiniteTemperature(value.currentTempC) ||
        isFiniteTemperature(value.highTempC) ||
        isFiniteTemperature(value.lowTempC)),
  );

const isLikelyBrazilCoordinate = (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean =>
  typeof latitude === 'number' &&
  Number.isFinite(latitude) &&
  typeof longitude === 'number' &&
  Number.isFinite(longitude) &&
  latitude >= -34 &&
  latitude <= 6 &&
  longitude >= -74 &&
  longitude <= -28;

const isUsablePreservedLocationName = (value?: string) =>
  isUsableWeatherCityName(value, [
    '--',
    '...',
    'GPS disabled',
    'GPS desativado',
    'monitoring_title',
  ]);

const includesAnyWeatherTerm = (value: string, terms: string[]) =>
  terms.some(term => value.includes(term));

const inferWeatherWidgetPrecipitationType = (
  result: WeatherResult | null,
): 'none' | 'rain' | 'snow' | 'hail' => {
  const text = [
    result?.conditionCode,
    result?.icon,
    result?.label,
    result?.conditionLabel,
    result?.weatherAlert?.code,
    result?.weatherAlert?.label,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (includesAnyWeatherTerm(text, ['hail', 'granizo', 'graupel'])) {
    return 'hail';
  }
  if (includesAnyWeatherTerm(text, ['snow', 'neve', 'sleet'])) {
    return 'snow';
  }
  if (includesAnyWeatherTerm(text, ['rain', 'chuva', 'drizzle', 'shower'])) {
    return 'rain';
  }
  return 'none';
};

const isVisualDayPhase = (phase: string) =>
  phase !== 'night' && phase !== 'midnight' && phase !== 'predawn';

const getWeatherConditionLabelKey = (
  conditionCode: WeatherResult['conditionCode'] | null | undefined,
): string => {
  switch (conditionCode) {
    case 'clear_day':
      return 'weather_clear_sky_day';
    case 'clear_night':
      return 'weather_clear_sky_night';
    case 'partly_cloudy_day':
    case 'partly_cloudy_night':
      return 'weather_partly_cloudy';
    case 'cloudy':
      return 'weather_overcast';
    case 'fog':
      return 'weather_fog';
    case 'rain':
      return 'weather_rain';
    case 'heavy_rain':
      return 'weather_alert_heavy_rain';
    case 'thunderstorm':
      return 'weather_signal_thunder';
    case 'lightning':
      return 'weather_signal_lightning';
    case 'snow':
      return 'weather_snow';
    case 'wind':
      return 'weather_wind';
    case 'hail':
      return 'weather_hail';
    case 'unknown':
    default:
      return '';
  }
};

const sanitizeWeatherText = (raw: string | null | undefined): string => {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\uFFFD/g, '')
    .replace(/[?Â¿]+/g, '')
    .replace(/[^\p{L}\p{N}\s\-_,./:+()%]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildWeatherAgeLabel = (
  updatedAt: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  const parsedMs = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(parsedMs)) {
    return t('widget_updated_now');
  }

  const ageMs = Math.max(0, Date.now() - parsedMs);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return t('widget_updated_now');
  if (minutes < 60) {
    return t('widget_updated_minutes_ago', {count: minutes});
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('widget_updated_hours_ago', {count: hours});
  }

  return t('widget_updated_days_ago', {
    count: Math.floor(hours / 24),
  });
};

/**
 * Relaxed renderable check — accepts partial weather data for cache/fallback.
 * The card must show SOMETHING even if temperature is missing, as long as
 * we have a city name or condition code.
 */
const isRelaxedWeatherResult = (
  value: WeatherResult | null | undefined,
): value is WeatherResult =>
  Boolean(
    value &&
      (isFiniteTemperature(value.currentTempC) ||
        isFiniteTemperature(value.highTempC) ||
        isFiniteTemperature(value.lowTempC) ||
        sanitizeWeatherText(value.cityName || value.city) ||
        (value.conditionCode && value.conditionCode !== 'unknown')),
  );

/**
 * Strict renderable check for fully valid weather data (premium display).
 * Falls back to relaxed check for partial/cache data.
 */
const isRenderableWeatherResult = (
  value: WeatherResult | null | undefined,
): value is WeatherResult =>
  Boolean(
    value &&
      (isFiniteTemperature(value.currentTempC) ||
        isFiniteTemperature(value.highTempC) ||
        isFiniteTemperature(value.lowTempC)) &&
      sanitizeWeatherText(value.conditionLabel) &&
      Number.isFinite(Date.parse(String(value.updatedAt || ''))),
  );

const formatRangeLabel = (
  result: WeatherResult | null,
  locale: string,
  countryCode: string | null | undefined,
  userPreference: TemperatureUnit | null,
): string => {
  if (!result) return '';
  const high = isFiniteTemperature(result.highTempC)
    ? formatTemperatureCelsius(
        result.highTempC,
        locale,
        countryCode,
        userPreference,
      )
    : result.maxTemp || '';
  const low = isFiniteTemperature(result.lowTempC)
    ? formatTemperatureCelsius(
        result.lowTempC,
        locale,
        countryCode,
        userPreference,
      )
    : result.minTemp || '';
  if (high && low) return `${high}/${low}`;
  return high || low || '';
};

const WeatherCardSkeleton = ({isDark}: {isDark: boolean}) => {
  const blockColor = isDark
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(255,255,255,0.18)';
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.skeletonMainRow}>
        <View style={styles.skeletonTempBlock}>
          <View style={[styles.skeletonTemp, {backgroundColor: blockColor}]} />
          <View
            style={[styles.skeletonCondition, {backgroundColor: blockColor}]}
          />
        </View>
        <View style={[styles.skeletonIcon, {backgroundColor: blockColor}]} />
      </View>
      <View style={styles.skeletonChipsRow}>
        <View style={[styles.skeletonChip, {backgroundColor: blockColor}]} />
        <View style={[styles.skeletonChip, {backgroundColor: blockColor}]} />
      </View>
      <View style={[styles.skeletonFooter, {backgroundColor: blockColor}]} />
    </View>
  );
};

export const WeatherWidget = React.memo(
  ({refreshToken, operationalWeatherSignal}: WeatherWidgetProps) => {
    const {colors, isDark} = useTheme();
    const {t, i18n} = useTranslation();
    const {securityState} = useSecurity();
    const {width: screenWidth} = useWindowDimensions();

    const initialLocationFallback = toCityOnlyLabel(securityState.locationName);
    const initialCachedWeather = GetWeatherFeedQuery.peekCached({
      latitude: securityState.location?.latitude,
      longitude: securityState.location?.longitude,
      cityHint: initialLocationFallback,
    });

    // Relaxed initial state: accept partial cached data
    const [weatherResult, setWeatherResult] = useState<WeatherResult | null>(
      isRelaxedWeatherResult(initialCachedWeather)
        ? initialCachedWeather
        : null,
    );
    const [loading, setLoading] = useState(
      !isRelaxedWeatherResult(initialCachedWeather),
    );
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showUnavailable, setShowUnavailable] = useState(false);
    const [forecastVisible, setForecastVisible] = useState(false);
    const [userTempPreference, setUserTempPreference] =
      useState<TemperatureUnit | null>(null);
    const [phaseClockTick, setPhaseClockTick] = useState(0);
    const [weatherLocaleOverride, setWeatherLocaleOverride] = useState<
      string | null
    >(null);

    const lastValidWeatherRef = useRef<WeatherResult | null>(
      isRelaxedWeatherResult(initialCachedWeather)
        ? initialCachedWeather
        : null,
    );
    const lastNetworkRefreshAtRef = useRef<number>(0);

    const isUsableLocationName = useCallback(
      (value?: string) =>
        isUsableWeatherCityName(value, [
          t('monitoring_title'),
          t('gps_off'),
          '--',
          '...',
        ]),
      [t],
    );

    const locationFallback = useMemo(() => {
      const byName = toCityOnlyLabel(securityState.locationName);
      return isUsableLocationName(byName) ? byName : '';
    }, [isUsableLocationName, securityState.locationName]);
    const locationFallbackRef = useRef(locationFallback);

    useEffect(() => {
      locationFallbackRef.current = locationFallback;
    }, [locationFallback]);

    const applyWeatherResult = useCallback(
      (next: WeatherResult, reason: 'cache' | 'network') => {
        if (!isRelaxedWeatherResult(next)) {
          return false;
        }
        if (
          reason === 'network' &&
          hasAnyWeatherTemperature(lastValidWeatherRef.current) &&
          !hasAnyWeatherTemperature(next)
        ) {
          return false;
        }

        const previous = lastValidWeatherRef.current;
        const nextCity = toCityOnlyLabel(next.cityName || next.city);
        const previousCity = toCityOnlyLabel(
          previous?.cityName ||
            previous?.city ||
            locationFallbackRef.current,
        );
        const appliedNext =
          reason === 'network' &&
          !isUsablePreservedLocationName(nextCity) &&
          isUsablePreservedLocationName(previousCity)
            ? {
                ...next,
                city: previousCity,
                cityName: previousCity,
              }
            : next;

        lastValidWeatherRef.current = appliedNext;
        setWeatherResult(current => {
          if (
            current &&
            current.updatedAt === appliedNext.updatedAt &&
            current.conditionCode === appliedNext.conditionCode &&
            current.currentTempC === appliedNext.currentTempC &&
            current.cityName === appliedNext.cityName &&
            current.precipitationProbability ===
              appliedNext.precipitationProbability &&
            current.weatherAlert?.label === appliedNext.weatherAlert?.label
          ) {
            return current;
          }
          return appliedNext;
        });
        setLoading(false);
        setShowUnavailable(false);
        try {
          const forecastDetails = (appliedNext.forecastDays || []).map(d => ({
            date: d.date,
            maxTemp: d.maxTemp,
            minTemp: d.minTemp,
            isUnavailable: Boolean(d.isUnavailable),
          }));
          console.info(
            `[weather/home] applied_${reason}`,
            JSON.stringify({
              city: appliedNext.cityName || appliedNext.city,
              conditionCode: appliedNext.conditionCode,
              updatedAt: appliedNext.updatedAt,
              source: appliedNext.source,
              cacheState: appliedNext.cacheState,
              forecastCount: appliedNext.forecastDays?.length || 0,
              labels: appliedNext.forecastDays?.map(day => day.dayLabel) || [],
              forecastDetails,
            }),
          );
        } catch (e) {
          console.info(`[weather/home] applied_${reason} (diag failed)`, e);
        }
        return true;
      },
      [],
    );

    const loadWeather = useCallback(
      async (forceNetwork = false) => {
        const latitude = securityState.location?.latitude;
        const longitude = securityState.location?.longitude;
        const context = {
          latitude,
          longitude,
          cityHint: locationFallback,
        };
        const hasVisibleWeather = isRelaxedWeatherResult(
          lastValidWeatherRef.current,
        );

        if (hasVisibleWeather) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
        }

        try {
          await GetWeatherFeedQuery.primeCache();
          const cached = await GetWeatherFeedQuery.getCached(context);

          // FIXED: Use relaxed check to accept partial cache data
          if (isRelaxedWeatherResult(cached)) {
            applyWeatherResult(cached, 'cache');
          } else if (!hasVisibleWeather) {
            // Even with partial/incomplete cache, still show the card with unavailable state
            // but KEEP the visual card rendered — never hide it completely
            setShowUnavailable(true);
          }

          if (!isFiniteCoordinatePair(latitude, longitude)) {
            // Location unavailable, but we have cache — don't set unavailable
            if (!isRelaxedWeatherResult(lastValidWeatherRef.current)) {
              setShowUnavailable(true);
            }
            return;
          }

          const safeLatitude = latitude as number;
          const safeLongitude = longitude as number;

          const shouldRefreshNetwork =
            forceNetwork ||
            !hasVisibleWeather ||
            Date.now() - lastNetworkRefreshAtRef.current >=
              MIN_BACKGROUND_REFRESH_INTERVAL_MS;
          if (!shouldRefreshNetwork) {
            return;
          }

          console.info(
            '[weather/home] refresh_start',
            JSON.stringify({
              hasLocation: true,
              hasVisibleWeather,
              forceNetwork,
            }),
          );

          const fresh = await GetWeatherFeedQuery.execute({
            latitude: safeLatitude,
            longitude: safeLongitude,
            force: true,
          });
          lastNetworkRefreshAtRef.current = Date.now();
          if (!applyWeatherResult(fresh, 'network')) {
            console.warn('[weather/home] ignored_invalid_network_payload');
          }
        } catch (error) {
          console.warn('[weather/home] refresh_failed_keep_cache');
          // FIXED: Don't set unavailable if we already have visible weather
          if (!isRelaxedWeatherResult(lastValidWeatherRef.current)) {
            setShowUnavailable(true);
          }
        } finally {
          setLoading(false);
          setIsRefreshing(false);
        }
      },
      [
        applyWeatherResult,
        locationFallback,
        securityState.location?.latitude,
        securityState.location?.longitude,
      ],
    );

    useEffect(() => {
      void (async () => {
        const pref = await getUserTemperaturePreference();
        setUserTempPreference(pref);
      })();
    }, []);

    useFocusEffect(
      useCallback(() => {
        let active = true;
        void (async () => {
          const pref = await getUserTemperaturePreference();
          if (active) {
            setUserTempPreference(pref);
          }
        })();
        void loadWeather(false);
        return () => {
          active = false;
        };
      }, [loadWeather]),
    );

    useEffect(() => {
      void loadWeather(false);
    }, [loadWeather]);

    useEffect(() => {
      if (typeof refreshToken === 'number' && refreshToken > 0) {
        void loadWeather(true);
      }
    }, [loadWeather, refreshToken]);

    useEffect(() => {
      const intervalId = setInterval(() => {
        void loadWeather(false);
      }, WEATHER_AUTO_REFRESH_MS);
      return () => clearInterval(intervalId);
    }, [loadWeather]);

    useEffect(() => {
      const phaseTimer = setInterval(
        () => {
          setPhaseClockTick(value => value + 1);
        },
        5 * 60 * 1000,
      );
      return () => clearInterval(phaseTimer);
    }, []);

    useEffect(() => {
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') {
          void loadWeather(false);
        }
      });
      return () => subscription.remove();
    }, [loadWeather]);

    const timeOfDayPhase = useMemo(
      () =>
        getTimeOfDayPhase({
          now: new Date(),
          timezone: weatherResult?.timeZone || undefined,
          isDay: weatherResult?.isDay ?? true,
          sunrise: weatherResult?.sunrise || undefined,
          sunset: weatherResult?.sunset || undefined,
        }),
      [
        phaseClockTick,
        weatherResult?.isDay,
        weatherResult?.sunrise,
        weatherResult?.sunset,
        weatherResult?.timeZone,
      ],
    );

    const weatherBarColors = useMemo(() => {
      const text = [
        weatherResult?.conditionCode,
        weatherResult?.icon,
        weatherResult?.label,
        weatherResult?.conditionLabel,
        weatherResult?.weatherAlert?.code,
        weatherResult?.weatherAlert?.label,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const decision = selectWeatherVisual({
        weatherCondition:
          weatherResult?.conditionCode ||
          weatherResult?.icon ||
          weatherResult?.label ||
          null,
        isDay: weatherResult?.isDay ?? isVisualDayPhase(timeOfDayPhase),
        localTime:
          weatherResult?.updatedAt || weatherResult?.timestamp || Date.now(),
        sunriseTime: weatherResult?.sunrise,
        sunsetTime: weatherResult?.sunset,
        timeZone: weatherResult?.timeZone || null,
        precipitationType: inferWeatherWidgetPrecipitationType(weatherResult),
        thunderstormRisk: includesAnyWeatherTerm(text, [
          'thunder',
          'lightning',
          'storm',
          'raio',
          'relampago',
          'tempest',
        ]),
        hailRisk: includesAnyWeatherTerm(text, ['hail', 'granizo', 'graupel']),
        snowRisk: includesAnyWeatherTerm(text, ['snow', 'neve', 'sleet']),
        temperature: weatherResult?.currentTempC ?? null,
        precipitation: weatherResult?.precipitationProbability ?? null,
        windSpeed: weatherResult?.wind ?? null,
        riskLevel: weatherResult?.weatherAlert ? 'high' : 'none',
        timeOfDay: timeOfDayPhase as any,
        systemColorScheme: isDark ? 'dark' : 'light',
        freshness: weatherResult?.cacheState || 'unknown',
        sourceConfidence: weatherResult ? 0.82 : 0.35,
      });
      const visualTheme = decision.visualTheme;

      return {
        backgroundColor: visualTheme.cardBackground,
        borderColor: visualTheme.borderColor,
        textColor: visualTheme.textPrimaryColor,
        textSecondaryColor: visualTheme.textSecondaryColor,
        textTertiaryColor: visualTheme.textSecondaryColor,
        iconTint: visualTheme.iconPrimaryColor,
      };
    }, [isDark, timeOfDayPhase, weatherResult]);

    const deviceCountryCode = useMemo(() => {
      try {
        const country = getCountry();
        return typeof country === 'string' && country.trim().length === 2
          ? country.trim().toUpperCase()
          : undefined;
      } catch {
        return undefined;
      }
    }, []);

    const coordinateCountryCode = isLikelyBrazilCoordinate(
      securityState.location?.latitude,
      securityState.location?.longitude,
    )
      ? 'BR'
      : undefined;
    const resolvedCountryCode =
      typeof securityState.locationCountryCode === 'string' &&
      securityState.locationCountryCode.trim().length === 2
        ? securityState.locationCountryCode.trim().toUpperCase()
        : coordinateCountryCode || deviceCountryCode;

    useEffect(() => {
      if (resolvedCountryCode === 'BR') {
        setWeatherLocaleOverride('pt-BR');
      } else {
        setWeatherLocaleOverride(null);
      }
    }, [resolvedCountryCode]);

    const weatherLocale = weatherLocaleOverride || i18n.language;
    const weatherT = useMemo(() => {
      if (typeof i18n.getFixedT === 'function') {
        return i18n.getFixedT(weatherLocale);
      }
      return t;
    }, [i18n, t, weatherLocale]);
    const currentLocationDisplay = useMemo(() => {
      if (resolvedCountryCode === 'BR' && typeof i18n.getFixedT === 'function') {
        return i18n.getFixedT('pt-BR')('current_location');
      }
      const localizedCurrentLocation = sanitizeWeatherText(
        weatherT('current_location'),
      );
      return localizedCurrentLocation.toLowerCase() === 'your location'
        ? weatherT('weather_local')
        : localizedCurrentLocation;
    }, [i18n, resolvedCountryCode, weatherT]);
    const temperatureLocale = weatherLocale;
    const weatherCityCandidate = sanitizeWeatherText(
      weatherResult?.cityName || weatherResult?.city,
    );
    const weatherCity = isUsableLocationName(weatherCityCandidate)
      ? toCityOnlyLabel(weatherCityCandidate)
      : '';
    const cityDisplay =
      weatherCity || locationFallback || currentLocationDisplay;
    const tempDisplay = isFiniteTemperature(weatherResult?.currentTempC)
      ? formatTemperatureCelsius(
          weatherResult?.currentTempC || 0,
          temperatureLocale,
          resolvedCountryCode,
          userTempPreference,
        )
      : '';
    const localizedConditionKey = weatherResult
      ? getWeatherConditionLabelKey(weatherResult.conditionCode)
      : '';
    const localizedConditionDisplay = localizedConditionKey
      ? sanitizeWeatherText(
          weatherT(localizedConditionKey, {
            defaultValue: '',
          }),
        )
      : '';
    const rawConditionDisplay = sanitizeWeatherText(
      weatherResult?.conditionLabel,
    );
    const unavailableConditionLabels = new Set(
      [
        weatherT('weather_unknown'),
        'Weather unavailable',
        'Clima indisponível',
        'Clima indisponivel',
      ]
        .map(sanitizeWeatherText)
        .filter(Boolean),
    );
    const safeRawConditionDisplay = unavailableConditionLabels.has(
      rawConditionDisplay,
    )
      ? ''
      : rawConditionDisplay;
    const conditionDisplay =
      localizedConditionDisplay ||
      safeRawConditionDisplay ||
      (showUnavailable
        ? weatherT('weather_updating_data')
        : weatherT('weather_local'));

    // Dev probe: log the exact card state for debugging on Samsung
    if (__DEV__) {
      console.log(
        '[ALERT_WEATHER_CARD_STATE]',
        JSON.stringify({
          hasWeatherResult: Boolean(weatherResult),
          showUnavailable,
          conditionDisplay,
          cityDisplay,
          iconConditionCode:
            weatherResult?.conditionCode || weatherResult?.icon || null,
          isDark,
          resolvedBackgroundColor: weatherBarColors.backgroundColor,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // FIXED: Always provide a fallback conditionCode for WeatherAnimatedIcon
    // so the neon icon always renders even when weatherResult is null
    const iconConditionCode =
      weatherResult?.conditionCode || weatherResult?.icon || null;
    const iconIsDay =
      weatherResult?.isDay ?? isVisualDayPhase(timeOfDayPhase);
    const rangeDisplay = formatRangeLabel(
      weatherResult,
      temperatureLocale,
      resolvedCountryCode,
      userTempPreference,
    );
    const feelsLikeDisplay = isFiniteTemperature(weatherResult?.feelsLikeTempC)
      ? weatherT('weather_feels_like', {
          temp: formatTemperatureCelsius(
            weatherResult?.feelsLikeTempC || 0,
            temperatureLocale,
            resolvedCountryCode,
            userTempPreference,
          ),
        })
      : '';
    const precipDisplay =
      typeof weatherResult?.precipitationProbability === 'number'
        ? weatherT('forecast_rain_chance', {
            chance: weatherResult.precipitationProbability,
          })
        : '';
    const alertDisplay =
      weatherResult?.weatherAlert?.label ||
      sanitizeWeatherText(operationalWeatherSignal?.label) ||
      '';
    const updatedLabel = weatherResult?.updatedAt
      ? buildWeatherAgeLabel(weatherResult.updatedAt, weatherT)
      : '';
    const weatherAccessibilityLabel = weatherT('weather_city_accessibility', {
      city: cityDisplay,
      temp: tempDisplay || weatherT('weather_updating_data'),
      condition: conditionDisplay || weatherT('weather_local'),
    });
    const hasRenderableWeather = isRelaxedWeatherResult(weatherResult);
    const effectiveForecastTimeZone =
      resolvedCountryCode === 'BR' &&
      (!weatherResult?.timeZone || weatherResult.timeZone === 'UTC')
        ? 'America/Fortaleza'
        : weatherResult?.timeZone;
    const visibleForecastDays = useMemo(
      () =>
        weatherResult
          ? buildPremiumForecastDays(weatherResult.forecastDays || [], {
              localeTag: weatherLocale,
              timeZone: effectiveForecastTimeZone,
              now: Date.now(),
              maxDays: 5,
            })
          : [],
      [effectiveForecastTimeZone, weatherLocale, weatherResult],
    );
    const modalForecastDays = useMemo(
      () => visibleForecastDays.slice(0, 5),
      [visibleForecastDays],
    );
    const shouldRenderForecastCarousel = modalForecastDays.length > 0;
    const forecastViewportWidth = Math.min(screenWidth - 48, 520) - 48;
    const forecastCardGap = 10;
    const forecastCardWidth = Math.min(
      136,
      Math.max(
        66,
        Math.floor((forecastViewportWidth - forecastCardGap * 2) / 3),
      ),
    );
    const forecastCardStride = forecastCardWidth + forecastCardGap;
    const forecastPageCount = Math.max(
      1,
      Math.ceil(modalForecastDays.length / 3),
    );
    const [activeForecastPage, setActiveForecastPage] = useState(0);
    const forecastSnapOffsets =
      forecastPageCount > 1
        ? Array.from(
            {length: forecastPageCount},
            (_, index) => index * forecastCardStride * 3,
          )
        : undefined;
    const forecastTrailingSpacer =
      forecastPageCount > 1 ? forecastCardStride * (forecastPageCount - 1) : 0;
    const logForecastCarouselPosition = useCallback(
      (offsetX: number) => {
        if (
          !forecastVisible ||
          modalForecastDays.length === 0 ||
          !forecastSnapOffsets
        ) {
          return;
        }
        const pageIndex = forecastSnapOffsets.reduce(
          (closestIndex, offset, index) =>
            Math.abs(offsetX - offset) <
            Math.abs(offsetX - forecastSnapOffsets[closestIndex])
              ? index
              : closestIndex,
          0,
        );
        const visibleDays = modalForecastDays.slice(
          pageIndex * 3,
          pageIndex * 3 + 3,
        );
        try {
          console.info(
            '[weather/forecast] carousel_visible',
            JSON.stringify({
              offsetX: Math.round(offsetX),
              visibleForecastLabels: visibleDays.map(day => day.dayLabel),
              visibleForecastCount: visibleDays.length,
              modalForecastCount: modalForecastDays.length,
            }),
          );
        } catch {
          // Forecast diagnostics must never block scrolling.
        }
      },
      [forecastSnapOffsets, forecastVisible, modalForecastDays],
    );
    const updateForecastPage = useCallback(
      (offsetX: number) => {
        if (!forecastSnapOffsets) {
          return;
        }
        const nextPage = forecastSnapOffsets.reduce(
          (closestIndex, offset, index) =>
            Math.abs(offsetX - offset) <
            Math.abs(offsetX - forecastSnapOffsets[closestIndex])
              ? index
              : closestIndex,
          0,
        );
        setActiveForecastPage(nextPage);
      },
      [forecastSnapOffsets],
    );
    const handleForecastCarouselScrollEnd = useCallback(
      (offsetX: number) => {
        updateForecastPage(offsetX);
        logForecastCarouselPosition(offsetX);
      },
      [logForecastCarouselPosition, updateForecastPage],
    );

    useEffect(() => {
      if (forecastVisible) {
        setActiveForecastPage(0);
      }
    }, [forecastVisible, modalForecastDays.length]);

    useEffect(() => {
      if (!forecastVisible) {
        return;
      }
      try {
        console.info(
          '[weather/forecast] modal_render',
          JSON.stringify({
            received: weatherResult?.forecastDays?.length || 0,
            backendForecastCount: weatherResult?.forecastDays?.length || 0,
            cacheForecastCount:
              weatherResult?.source === 'cache'
                ? weatherResult?.forecastDays?.length || 0
                : 0,
            modalForecastCount: modalForecastDays.length,
            renderedForecastCount: shouldRenderForecastCarousel
              ? modalForecastDays.length
              : 0,
            timeZone:
              effectiveForecastTimeZone || weatherResult?.timeZone || null,
            locale: weatherLocale,
            labels: modalForecastDays.map(day => day.dayLabel),
            modalForecastLabels: modalForecastDays.map(day => day.dayLabel),
            forecastDetails: modalForecastDays.map(day => ({
              date: day.date,
              label: day.dayLabel,
              maxTemp: day.maxTemp,
              minTemp: day.minTemp,
              isUnavailable: Boolean(day.isUnavailable),
            })),
            reason:
              modalForecastDays.length === 0
                ? 'forecast_empty_no_carousel'
                : undefined,
          }),
        );
      } catch {
        // Forecast diagnostics must never block modal rendering.
      }
    }, [
      forecastVisible,
      i18n.language,
      effectiveForecastTimeZone,
      modalForecastDays,
      shouldRenderForecastCarousel,
      weatherLocale,
      weatherResult?.forecastDays?.length,
      weatherResult?.source,
      weatherResult?.timeZone,
    ]);

    const openForecast = () => {
      ReactNativeHapticFeedback.trigger(ThemeTokens.haptics.light);
      try {
        console.info(
          '[weather/forecast] modal_open',
          JSON.stringify({
            backendForecastCount: weatherResult?.forecastDays?.length || 0,
            cacheForecastCount:
              weatherResult?.source === 'cache'
                ? weatherResult?.forecastDays?.length || 0
                : 0,
            modalForecastCount: modalForecastDays.length,
            renderedForecastCount: modalForecastDays.length,
            modalForecastLabels: modalForecastDays.map(day => day.dayLabel),
            forecastDetails: modalForecastDays.map(day => ({
              date: day.date,
              label: day.dayLabel,
              maxTemp: day.maxTemp,
              minTemp: day.minTemp,
              isUnavailable: Boolean(day.isUnavailable),
            })),
          }),
        );
      } catch {
        // Forecast diagnostics must never block opening the modal.
      }
      setForecastVisible(true);
    };

    return (
      <View style={styles.container}>
        {loading && !hasRenderableWeather ? (
          <View
            style={[
              styles.cardSkeleton,
              {
                backgroundColor: weatherBarColors.backgroundColor,
              },
            ]}>
            <WeatherCardSkeleton isDark={isDark} />
          </View>
        ) : (
          <WeatherCompactCard
            tempDisplay={tempDisplay}
            conditionDisplay={conditionDisplay}
            cityDisplay={cityDisplay}
            feelsLikeDisplay={feelsLikeDisplay}
            rangeDisplay={rangeDisplay}
            precipDisplay={precipDisplay}
            alertDisplay={alertDisplay}
            updatedLabel={updatedLabel}
            isRefreshing={isRefreshing}
            isDark={isDark}
            timeOfDayPhase={timeOfDayPhase}
            weatherResult={weatherResult}
            locationFallback={locationFallback}
            temperatureLocale={temperatureLocale}
            resolvedCountryCode={resolvedCountryCode}
            userTempPreference={userTempPreference}
            weatherAccessibilityLabel={weatherAccessibilityLabel}
            onPress={openForecast}
            weatherBarColors={weatherBarColors}
            // FIXED: Pass explicit icon props so neon renders even without weatherResult
            iconConditionCode={iconConditionCode}
            iconIsDay={iconIsDay}
          />
        )}

        <BasePopup
          accessibilityLabel={cityDisplay}
          contentStyle={[
            styles.modalCard,
            {
              backgroundColor: weatherBarColors.backgroundColor,
              borderColor: weatherBarColors.borderColor,
            },
          ]}
          maxWidth={520}
          backdropAccessibilityLabel={t('close')}
          onClose={() => setForecastVisible(false)}
          placement="center"
          visible={forecastVisible}>
          <Text
            style={[
              styles.modalTitleCentered,
              {color: weatherBarColors.textColor},
            ]}>
            {cityDisplay}
          </Text>
          {weatherResult?.cacheState === 'stale' && updatedLabel ? (
            <View style={styles.staleBadgeWrap}>
              <Text
                style={[
                  styles.modalStatusText,
                  {color: weatherBarColors.textSecondaryColor},
                ]}>
                {updatedLabel}
              </Text>
            </View>
          ) : null}

          {shouldRenderForecastCarousel ? (
            <>
              <View style={styles.forecastCarouselWrap}>
                <ScrollView
                  horizontal
                  decelerationRate="normal"
                  directionalLockEnabled
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  scrollEnabled
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                  disableIntervalMomentum
                  snapToAlignment="start"
                  snapToOffsets={forecastSnapOffsets}
                  style={styles.forecastCarousel}
                  onMomentumScrollEnd={event => {
                    const offsetX = Number(
                      event.nativeEvent.contentOffset.x || 0,
                    );
                    handleForecastCarouselScrollEnd(offsetX);
                  }}
                  onScrollEndDrag={event => {
                    const offsetX = Number(
                      event.nativeEvent.contentOffset.x || 0,
                    );
                    handleForecastCarouselScrollEnd(offsetX);
                  }}
                  contentContainerStyle={[
                    styles.forecastCarouselContent,
                    {paddingRight: forecastTrailingSpacer},
                  ]}>
                  {modalForecastDays.map((day, index) => (
                    <View
                      accessible
                      accessibilityLabel={`${day.dayLabel}, ${day.maxTemp}/${day.minTemp}`}
                      key={`${day.date}-${index}`}
                      style={[
                        styles.forecastItem,
                        {
                          width: forecastCardWidth,
                          marginRight:
                            index === modalForecastDays.length - 1
                              ? 0
                              : forecastCardGap,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.forecastDay,
                          {color: weatherBarColors.textColor},
                        ]}>
                        {day.dayLabel}
                      </Text>
                      <WeatherIcon
                        icon={day.icon}
                        size={ThemeTokens.WeatherIcon.sizes.forecast}
                      />
                      <Text
                        style={[
                          styles.forecastTemps,
                          {color: weatherBarColors.textSecondaryColor},
                        ]}>
                        {`${day.maxTemp}/${day.minTemp}`}
                      </Text>
                      {typeof day.rainChance === 'number' ? (
                        <Text
                          style={[
                            styles.forecastRain,
                            {color: weatherBarColors.textSecondaryColor},
                          ]}>
                          {weatherT('forecast_rain_chance', {
                            chance: day.rainChance,
                          })}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              </View>
              {modalForecastDays.length > 3 ? (
                <>
                  <View
                    testID="forecastSwipeHintRow"
                    style={styles.forecastSwipeHintRow}>
                    {Array.from({length: forecastPageCount}, (_, index) => (
                      <View
                        key={`forecast-swipe-dot-${index}`}
                        testID={`forecastSwipeDot-${index}`}
                        accessibilityState={{
                          selected: index === activeForecastPage,
                        }}
                        style={[
                          styles.forecastSwipeDot,
                          index !== activeForecastPage &&
                            styles.forecastSwipeDotFaded,
                        ]}
                      />
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.forecastSwipeHintText,
                      {color: weatherBarColors.textSecondaryColor},
                    ]}>
                    {weatherT('forecast_swipe_hint', {
                      defaultValue: 'Deslize para ver mais',
                    })}
                  </Text>
                </>
              ) : null}
            </>
          ) : null}

          <TouchableOpacity
            accessibilityLabel={t('close')}
            accessibilityRole="button"
            style={[styles.modalButton, {backgroundColor: colors.primary}]}
            onPress={() => setForecastVisible(false)}>
            <Text style={styles.modalButtonText}>{t('close')}</Text>
          </TouchableOpacity>
        </BasePopup>
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
  cardSkeleton: {
    borderRadius: ThemeTokens.radius.xl,
    overflow: 'hidden',
    minHeight: 110,
  },
  // Skeleton styles
  skeletonWrap: {
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.sm + 2,
  },
  skeletonMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: ThemeTokens.spacing.sm,
  },
  skeletonTempBlock: {
    flex: 1,
  },
  skeletonTemp: {
    width: 100,
    height: 38,
    borderRadius: 10,
    marginBottom: 4,
  },
  skeletonCondition: {
    width: 80,
    height: 14,
    borderRadius: 7,
  },
  skeletonIcon: {
    width: ThemeTokens.WeatherIcon.sizes.home,
    height: ThemeTokens.WeatherIcon.sizes.home,
    borderRadius: ThemeTokens.WeatherIcon.sizes.home / 2,
  },
  skeletonChipsRow: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.sm,
    marginBottom: ThemeTokens.spacing.sm,
  },
  skeletonChip: {
    width: 80,
    height: 26,
    borderRadius: 13,
  },
  skeletonFooter: {
    width: 100,
    height: 11,
    borderRadius: 5.5,
  },
  // Modal styles
  modalCard: {
    borderRadius: 28,
    padding: ThemeTokens.spacing.lg,
    borderWidth: 1,
  },
  modalTitleCentered: {
    ...getTypographyStyle('modalTitle'),
    textAlign: 'center',
  },
  modalStatusText: {
    ...getTypographyStyle('micro', {weight: 'semibold'}),
    textAlign: 'center',
    opacity: 0.75,
  },
  staleBadgeWrap: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: ThemeTokens.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(1,6,16,0.68)',
  },
  forecastCarouselWrap: {
    paddingVertical: 12,
    marginBottom: ThemeTokens.spacing.sm,
  },
  forecastCarousel: {
    marginHorizontal: -2,
    marginBottom: ThemeTokens.spacing.lg,
  },
  forecastCarouselContent: {
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  forecastSwipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: ThemeTokens.spacing.xs,
  },
  forecastSwipeHintText: {
    ...getTypographyStyle('footnote', {weight: 'semibold'}),
    textAlign: 'center',
    marginTop: ThemeTokens.spacing.xs,
    opacity: 0.77,
  },
  forecastSwipeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  forecastSwipeDotFaded: {
    opacity: 0.38,
  },
  forecastItem: {
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 164,
    marginRight: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(1,6,16,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  forecastDay: {
    ...getTypographyStyle('label'),
    marginBottom: 8,
  },
  forecastTemps: {
    ...getTypographyStyle('metricSmall'),
    marginTop: 8,
  },
  forecastRain: {
    ...getTypographyStyle('footnote', {weight: 'semibold'}),
    marginTop: 4,
    textAlign: 'center',
  },
  modalButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    ...getTypographyStyle('buttonLabel'),
    color: '#FFF',
  },
});
