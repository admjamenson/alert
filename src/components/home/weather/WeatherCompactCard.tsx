import React, {memo, useMemo} from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {useTranslation} from 'react-i18next';

import {ThemeTokens} from '../../../constants/ThemeTokens';
import {selectWeatherVisual} from '../../../domain/weather/WeatherVisualSelector';
import {WeatherResult} from '../../../services/WeatherService';
import {getTypographyStyle} from '../../../theme/typography';
import type {TemperatureUnit} from '../../../utils/measurementUnits';
import {CinematicWeatherHero} from '../../weather/CinematicWeatherHero';
import {WeatherHeroIcon, mapConditionToHeroIcon} from './WeatherHeroIcon';

// MoonPhaseVisualBadge is rendered by CinematicWeatherHero for lunar decisions.
const signalText = (weatherResult: WeatherResult | null, fallback: string) =>
  [
    weatherResult?.conditionCode,
    weatherResult?.icon,
    weatherResult?.label,
    weatherResult?.conditionLabel,
    weatherResult?.intelligenceSignal?.kind,
    weatherResult?.intelligenceSignal?.label,
    weatherResult?.weatherAlert?.code,
    weatherResult?.weatherAlert?.label,
    fallback,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const includesAny = (value: string, terms: string[]) =>
  terms.some(term => value.includes(term));

const inferPrecipitationType = (
  weatherResult: WeatherResult | null,
  fallback: string,
) => {
  const text = signalText(weatherResult, fallback);
  if (includesAny(text, ['hail', 'granizo', 'graupel', 'ice-pellets'])) {
    return 'hail';
  }
  if (includesAny(text, ['snow', 'neve', 'sleet'])) {
    return 'snow';
  }
  if (includesAny(text, ['rain', 'chuva', 'drizzle', 'shower'])) {
    return 'rain';
  }
  return 'none';
};

interface WeatherCompactCardProps {
  tempDisplay: string;
  conditionDisplay: string;
  cityDisplay: string;
  feelsLikeDisplay: string;
  rangeDisplay: string;
  precipDisplay: string;
  alertDisplay: string;
  updatedLabel: string;
  isRefreshing: boolean;
  isDark: boolean;
  timeOfDayPhase: string;
  weatherResult: WeatherResult | null;
  locationFallback: string;
  temperatureLocale: string;
  resolvedCountryCode: string | undefined;
  userTempPreference: TemperatureUnit | null;
  weatherAccessibilityLabel: string;
  onPress: () => void;
  weatherBarColors: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    textSecondaryColor: string;
    textTertiaryColor: string;
    iconTint: string;
  };
  iconConditionCode?: number | string | null;
  iconIsDay?: boolean;
}

export const WeatherCompactCard = memo<WeatherCompactCardProps>(
  ({
    tempDisplay,
    conditionDisplay,
    cityDisplay,
    feelsLikeDisplay,
    rangeDisplay,
    precipDisplay,
    alertDisplay,
    updatedLabel,
    isRefreshing,
    isDark,
    timeOfDayPhase,
    weatherResult,
    weatherAccessibilityLabel,
    onPress,
    iconConditionCode: iconConditionCodeProp,
    iconIsDay: iconIsDayProp,
  }) => {
    const resolvedIconConditionCode =
      iconConditionCodeProp ??
      weatherResult?.conditionCode ??
      weatherResult?.icon ??
      null;
    const resolvedIconIsDay = iconIsDayProp ?? weatherResult?.isDay ?? true;
    const heroIconCondition = mapConditionToHeroIcon(
      String(resolvedIconConditionCode || ''),
      resolvedIconIsDay,
    );
    const {width: screenWidth} = useWindowDimensions();
    const {t} = useTranslation();
    const isCompact = screenWidth < 380;

    const visualDecision = useMemo(() => {
      const text = signalText(weatherResult, conditionDisplay);
      return selectWeatherVisual({
        weatherCondition:
          weatherResult?.conditionCode ||
          weatherResult?.icon ||
          weatherResult?.label ||
          conditionDisplay ||
          null,
        isDay: weatherResult?.isDay ?? timeOfDayPhase !== 'night',
        localTime:
          weatherResult?.updatedAt || weatherResult?.timestamp || Date.now(),
        sunriseTime: weatherResult?.sunrise,
        sunsetTime: weatherResult?.sunset,
        precipitationType: inferPrecipitationType(
          weatherResult,
          conditionDisplay,
        ),
        thunderstormRisk: includesAny(text, [
          'thunder',
          'lightning',
          'storm',
          'raio',
          'relampago',
          'tempest',
        ]),
        hailRisk: includesAny(text, ['hail', 'granizo', 'graupel']),
        snowRisk: includesAny(text, ['snow', 'neve', 'sleet']),
        temperature: weatherResult?.currentTempC ?? null,
        precipitation: weatherResult?.precipitationProbability ?? null,
        windSpeed: weatherResult?.wind ?? null,
        riskLevel: weatherResult?.weatherAlert ? 'high' : 'none',
        timeOfDay: timeOfDayPhase as any,
        systemColorScheme: isDark ? 'dark' : 'light',
        freshness: weatherResult?.cacheState || 'unknown',
        sourceConfidence: weatherResult ? 0.82 : 0.35,
      });
    }, [alertDisplay, conditionDisplay, isDark, timeOfDayPhase, weatherResult]);

    const chips = useMemo(() => {
      const items: {
        key: string;
        label: string;
        type: 'range' | 'precip' | 'feels' | 'alert';
      }[] = [];
      if (alertDisplay) {
        items.push({key: 'alert', label: alertDisplay, type: 'alert'});
      }
      if (feelsLikeDisplay) {
        items.push({key: 'feels', label: feelsLikeDisplay, type: 'feels'});
      }
      if (rangeDisplay) {
        items.push({key: 'range', label: rangeDisplay, type: 'range'});
      }
      if (precipDisplay && !rangeDisplay) {
        items.push({key: 'precip', label: precipDisplay, type: 'precip'});
      }
      return items.slice(0, 2);
    }, [rangeDisplay, feelsLikeDisplay, precipDisplay, alertDisplay]);

    const visualTheme = visualDecision.visualTheme;
    const chipBackgroundColor = visualTheme.chipBackgroundColor;
    const riskStatus = visualTheme.riskStatus;
    const conditionCityDisplay =
      conditionDisplay && cityDisplay
        ? t('weather_condition_in_city', {
            condition: conditionDisplay,
            city: cityDisplay,
            defaultValue: `${conditionDisplay} in ${cityDisplay}`,
          })
        : conditionDisplay || cityDisplay;
    const riskLabel = t(riskStatus.i18nKey, {
      defaultValue: riskStatus.labelEn,
    });
    const safetyChipLabel = t(`weather_safety_chip_${riskStatus.level}`, {
      defaultValue:
        riskStatus.level === 'safe' || riskStatus.level === 'low'
          ? 'Safe within 1 km'
          : 'Watch 1 km',
    });

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: visualTheme.cardBackground,
            borderColor: visualTheme.borderColor,
          },
          isCompact && styles.cardCompact,
        ]}
        activeOpacity={0.9}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={weatherAccessibilityLabel}
        accessibilityHint={t('home_bar_tap_details')}>
        <CinematicWeatherHero decision={visualDecision} compact>
          <View style={styles.mainRow}>
            <View style={styles.tempSection}>
              <View style={styles.tempRow}>
                <Text
                  style={[
                    styles.temperature,
                    {color: visualTheme.textPrimaryColor},
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {tempDisplay || '--\u00B0'}
                </Text>
              </View>
              <Text
                style={[
                  styles.conditionText,
                  {color: visualTheme.textPrimaryColor},
                ]}
                numberOfLines={1}
                ellipsizeMode="tail">
                {conditionCityDisplay}
              </Text>
              <View style={styles.riskStatusRow}>
                <View
                  style={[
                    styles.riskStatusDot,
                    {backgroundColor: visualTheme.riskAccentColor},
                  ]}
                />
                <Text
                  style={[
                    styles.riskStatusText,
                    {color: visualTheme.textSecondaryColor},
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail">
                  {riskLabel}
                </Text>
              </View>
            </View>

            <View style={styles.visualSection}>
              <WeatherHeroIcon
                condition={heroIconCondition}
                size={ThemeTokens.WeatherIcon.sizes.home}
                isDark={isDark}
                primaryColor={visualTheme.iconPrimaryColor}
                secondaryColor={visualTheme.iconSecondaryColor}
              />
            </View>
          </View>

          <View style={styles.chipsRow}>
            {[
              {key: 'safety', label: safetyChipLabel},
              ...chips.map(chip => ({key: chip.key, label: chip.label})),
            ].slice(0, 3).map(chip => (
              <View
                key={chip.key}
                style={[
                  styles.chip,
                  {
                    backgroundColor: chipBackgroundColor,
                    borderColor: visualTheme.chipBorderColor,
                  },
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    {color: visualTheme.textPrimaryColor},
                  ]}
                  numberOfLines={1}>
                  {chip.label}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            {isRefreshing && (
              <View style={styles.refreshBadge}>
                <Text
                  style={[
                    styles.refreshText,
                    {color: visualTheme.textPrimaryColor},
                  ]}>
                  {t('weather_refreshing')}
                </Text>
              </View>
            )}
            {!isRefreshing && updatedLabel ? (
              <Text
                style={[
                  styles.updatedText,
                  {color: visualTheme.textSecondaryColor},
                ]}
                numberOfLines={1}>
                {updatedLabel}
              </Text>
            ) : null}
          </View>
        </CinematicWeatherHero>
      </TouchableOpacity>
    );
  },
);

WeatherCompactCard.displayName = 'WeatherCompactCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: ThemeTokens.radius.xl,
    minHeight: 122,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardCompact: {
    minHeight: 114,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tempSection: {
    flex: 1,
    marginRight: ThemeTokens.spacing.sm,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 2,
  },
  temperature: {
    ...getTypographyStyle('weatherTemperature'),
  },
  condition: {
    ...getTypographyStyle('weatherCondition'),
    opacity: 0.9,
  },
  visualSection: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
    maxWidth: 136,
  },
  cityRow: {
    marginTop: 4,
    maxWidth: 140,
  },
  conditionText: {
    ...getTypographyStyle('weatherCity'),
    opacity: 1,
    marginTop: 2,
    alignSelf: 'flex-start',
    maxWidth: 220,
  },
  riskStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    maxWidth: 230,
  },
  riskStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
  },
  riskStatusText: {
    ...getTypographyStyle('weatherMeta', {weight: 'semibold'}),
    flexShrink: 1,
    opacity: 0.96,
  },
  visualLabel: {
    ...getTypographyStyle('micro', {weight: 'semibold'}),
    opacity: 0.88,
    textAlign: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.sm,
    marginTop: ThemeTokens.spacing.sm,
  },
  chip: {
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: ThemeTokens.spacing.sm + 4,
    paddingVertical: 5,
    borderWidth: 1,
    maxWidth: '100%',
  },
  chipText: {
    ...getTypographyStyle('weatherMeta', {weight: 'semibold'}),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: ThemeTokens.spacing.sm,
  },
  updatedText: {
    ...getTypographyStyle('micro', {weight: 'semibold'}),
    opacity: 0.88,
  },
  refreshBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshText: {
    ...getTypographyStyle('micro', {weight: 'semibold'}),
  },
});
