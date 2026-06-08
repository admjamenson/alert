import {getMoonPhase, type MoonPhase} from '../../utils/moonPhase';
import {
  findWeatherVisualAsset,
  WEATHER_VISUAL_ASSET_BY_ID,
} from './WeatherVisualCatalog';
import type {
  WeatherVisualCondition,
  WeatherVisualContext,
  WeatherVisualDecision,
} from './WeatherVisualModels';
import {resolveWeatherVisualDevPreview} from './WeatherVisualDevPreview';
import {calculateWeatherVisualPeriod} from './WeatherVisualPeriod';
import {resolveWeatherVisualTheme} from './WeatherVisualTheme';

const asDate = (value: WeatherVisualContext['localTime']): Date => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
};

const numericRisk = (value: boolean | number | null | undefined): boolean => {
  if (typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5;
};

const normalizeCondition = (
  raw: WeatherVisualContext['weatherCondition'],
): string => String(raw ?? '').trim().toLowerCase();

const phaseFromContext = (context: WeatherVisualContext, now: Date): MoonPhase =>
  context.moonPhase || getMoonPhase(now).phase;

const resolveMoonAssetId = (
  phase: MoonPhase,
  now: Date,
  illumination?: number | null,
): {assetId: string; condition: WeatherVisualCondition; reason: string} => {
  if (phase === 'NEW' || (typeof illumination === 'number' && illumination <= 0.08)) {
    return {
      assetId: 'new_moon_stars',
      condition: 'new_moon',
      reason: 'moon_phase_new',
    };
  }
  if (phase === 'WAXING_CRESCENT' || phase === 'WANING_CRESCENT') {
    return {
      assetId: 'crescent_moon',
      condition: 'crescent_moon',
      reason: 'moon_phase_crescent',
    };
  }
  if (phase === 'FULL' || (typeof illumination === 'number' && illumination >= 0.93)) {
    const variants = [
      'full_moon_yellow',
      'full_moon_blue',
      'full_moon_purple',
      'full_moon_white',
    ];
    const daySeed = Math.floor(now.getTime() / 86_400_000);
    const assetId = variants[Math.abs(daySeed) % variants.length];
    return {
      assetId,
      condition: assetId as WeatherVisualCondition,
      reason: 'moon_phase_full_deterministic_color',
    };
  }
  return {
    assetId: 'crescent_moon',
    condition: 'crescent_moon',
    reason: 'moon_phase_non_full_night',
  };
};

const isSunriseOrSunset = (
  now: Date,
  value: WeatherVisualContext['sunriseTime'],
) => {
  if (!value) return false;
  const target = asDate(value);
  return Math.abs(now.getTime() - target.getTime()) <= 45 * 60 * 1000;
};

const chooseAsset = (
  context: WeatherVisualContext,
): {assetId: string; condition: WeatherVisualCondition; reason: string} => {
  const now = asDate(context.localTime);
  const code = normalizeCondition(context.weatherCondition);
  const precipitation = context.precipitationType || 'none';
  const isDay = context.isDay !== false;

  const thunderstorm =
    numericRisk(context.thunderstormRisk) ||
    code.includes('thunder') ||
    code.includes('lightning') ||
    code.includes('storm');
  if (thunderstorm) {
    return {
      assetId: 'thunderstorm_lightning',
      condition: 'thunderstorm',
      reason: 'real_thunderstorm_or_lightning_signal',
    };
  }

  const hail =
    numericRisk(context.hailRisk) ||
    precipitation === 'hail' ||
    code.includes('hail') ||
    code.includes('graupel') ||
    code.includes('ice-pellets');
  if (hail) {
    return {
      assetId: 'hail_ice_storm',
      condition: 'hail',
      reason: 'real_hail_signal',
    };
  }

  const snow =
    numericRisk(context.snowRisk) ||
    precipitation === 'snow' ||
    code.includes('snow') ||
    code.includes('sleet');
  if (snow) {
    return {
      assetId: 'snow_superwhite',
      condition: 'snow',
      reason: 'real_snow_signal',
    };
  }

  const rain =
    precipitation === 'rain' ||
    code.includes('rain') ||
    code.includes('drizzle') ||
    code.includes('shower');
  if (rain) {
    return {
      assetId: 'rain_blue_led',
      condition: code.includes('heavy') ? 'heavy_rain' : 'rain',
      reason: 'real_rain_signal',
    };
  }

  if (code.includes('fog') || code.includes('mist') || code.includes('haze')) {
    return {
      assetId: isDay ? 'cloudy_day' : 'cloudy_night',
      condition: 'fog',
      reason: 'fog_signal_uses_muted_cloud_visual',
    };
  }

  if (
    code.includes('cloud') ||
    code.includes('overcast') ||
    (typeof context.cloudCover === 'number' && context.cloudCover > 70)
  ) {
    return {
      assetId: isDay ? 'cloudy_day' : 'cloudy_night',
      condition: isDay ? 'cloudy_day' : 'cloudy_night',
      reason: 'cloud_cover_or_cloud_condition',
    };
  }

  if (!isDay) {
    return resolveMoonAssetId(
      phaseFromContext(context, now),
      now,
      context.moonIllumination,
    );
  }

  if (isSunriseOrSunset(now, context.sunriseTime)) {
    return {
      assetId: 'sunrise_gold',
      condition: 'sunrise',
      reason: 'local_time_near_sunrise',
    };
  }
  if (isSunriseOrSunset(now, context.sunsetTime)) {
    return {
      assetId: 'sunset_purple_gold',
      condition: 'sunset',
      reason: 'local_time_near_sunset',
    };
  }

  if (!code || code.includes('unknown')) {
    return {
      assetId: 'fallback_dark',
      condition: 'fallback',
      reason: 'missing_or_unknown_weather_condition',
    };
  }

  return {
    assetId: 'clear_day_sun',
    condition: 'clear_day',
    reason: 'clear_day_without_severe_signal',
  };
};

const asTimestamp = (
  value:
    | WeatherVisualContext['localTime']
    | WeatherVisualContext['sunriseTime']
    | WeatherVisualContext['sunsetTime'],
): number | undefined => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const riskFromContext = (
  context: WeatherVisualContext,
): WeatherVisualContext['riskLevel'] => {
  if (context.riskLevel) return context.riskLevel;
  if (context.severity) return context.severity;
  if (
    numericRisk(context.thunderstormRisk) ||
    context.thunderstorm === true ||
    numericRisk(context.hailRisk)
  ) {
    return 'high';
  }
  return 'none';
};

const periodFromContext = (context: WeatherVisualContext) => {
  if (context.timeOfDay) {
    switch (context.timeOfDay) {
      case 'dawn':
        return 'sunrise';
      case 'day':
        return 'midday';
      default:
        return context.timeOfDay;
    }
  }

  return calculateWeatherVisualPeriod({
    timestamp: asTimestamp(context.localTime),
    sunriseTimestamp: asTimestamp(context.sunriseTime),
    sunsetTimestamp: asTimestamp(context.sunsetTime),
    isDay:
      typeof context.isDay === 'boolean' ? context.isDay : undefined,
    latitude:
      typeof context.latitude === 'number' ? context.latitude : undefined,
  });
};

export const selectWeatherVisual = (
  context: WeatherVisualContext,
): WeatherVisualDecision => {
  const previewChoice = resolveWeatherVisualDevPreview(context);
  const chosen = previewChoice || chooseAsset(context);
  const asset = findWeatherVisualAsset(chosen.assetId);
  const visualTheme = resolveWeatherVisualTheme({
    condition: chosen.condition,
    date: context.localTime,
    sunrise: context.sunriseTime,
    sunset: context.sunsetTime,
    timezone: context.timeZone,
    isDay: context.isDay,
    timeOfDay: periodFromContext(context),
    temperature: context.temperature,
    precipitation: context.precipitation,
    windSpeed: context.windSpeed,
    thunderstorm:
      context.thunderstorm === true || numericRisk(context.thunderstormRisk),
    riskLevel: riskFromContext(context),
    systemColorScheme: context.systemColorScheme,
  });
  const themedAsset = {
    ...asset,
    dominantColors: visualTheme.backgroundGradient,
    overlayGradient: visualTheme.overlayGradient,
    textTone: visualTheme.textPrimaryColor === '#FFFFFF' ? 'light' as const : 'dark' as const,
  };
  const fallbackUsed =
    asset.source === 'gradientFallback' || !WEATHER_VISUAL_ASSET_BY_ID[chosen.assetId];
  const confidence =
    typeof context.sourceConfidence === 'number' &&
    Number.isFinite(context.sourceConfidence)
      ? Math.max(0, Math.min(1, context.sourceConfidence))
      : chosen.condition === 'fallback'
        ? 0.35
        : context.freshness === 'stale' || context.freshness === 'expired'
          ? 0.62
          : 0.82;

  return {
    assetId: asset.id,
    condition: chosen.condition,
    reason: chosen.reason,
    confidence,
    fallbackUsed,
    overlayGradient: visualTheme.overlayGradient,
    textColor: visualTheme.textPrimaryColor,
    glowColor: visualTheme.glowColor,
    accentColor: visualTheme.accentColor,
    accessibilityLabel: asset.accessibilityI18nKey,
    accessibilityI18nKey: asset.accessibilityI18nKey,
    asset: themedAsset,
    visualTheme,
    devPreview: !!previewChoice,
  };
};
