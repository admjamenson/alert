import { getMoonPhase, Hemisphere, inferHemisphere, MoonPhase } from '../../utils/moonPhase';

export type NormalizedWeatherKind =
  | 'clear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'hail'
  | 'fog'
  | 'wind'
  | 'extreme';

export type WeatherOverlayKind = 'none' | 'cloud' | 'rain' | 'storm' | 'snow' | 'hail';

export type WeatherIconVariant = {
  kind: NormalizedWeatherKind;
  staticIcon: string;
  lottieKey: string;
  a11yLabelKey: string;
  moonPhase?: MoonPhase;
  overlayKind?: WeatherOverlayKind;
  hemisphere?: Hemisphere;
};

const fromNumericCode = (code: number): NormalizedWeatherKind => {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 57) return 'rain';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 79) return 'hail';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'cloudy';
};

const fromStringCode = (raw: string): NormalizedWeatherKind => {
  const key = raw.toLowerCase();
  if (!key.trim()) return 'cloudy';
  if (key.includes('lightning') || key.includes('thunder') || key.includes('storm')) return 'storm';
  if (key.includes('hail') || key.includes('graupel') || key.includes('ice-pellets')) {
    return 'hail';
  }
  if (key.includes('snow') || key.includes('sleet')) return 'snow';
  if (
    key.includes('rain') ||
    key.includes('drizzle') ||
    key.includes('pouring') ||
    key.includes('shower')
  ) {
    return 'rain';
  }
  if (key.includes('fog') || key.includes('mist') || key.includes('haze')) return 'fog';
  if (key.includes('wind') || key.includes('gale') || key.includes('breeze')) return 'wind';
  if (key.includes('night-partly-cloudy')) return 'partlyCloudy';
  if (key.includes('partly') || key.includes('few-clouds')) return 'partlyCloudy';
  if (key.includes('sun') || key.includes('clear') || key.includes('night')) return 'clear';
  if (key.includes('extreme')) return 'extreme';
  return 'cloudy';
};

const normalizeKind = (conditionCode: number | string | null | undefined): NormalizedWeatherKind => {
  if (typeof conditionCode === 'number' && Number.isFinite(conditionCode)) {
    return fromNumericCode(conditionCode);
  }
  if (typeof conditionCode === 'string') {
    const parsed = Number(conditionCode);
    if (Number.isFinite(parsed)) return fromNumericCode(parsed);
    return fromStringCode(conditionCode);
  }
  return 'cloudy';
};

const overlayFromKind = (kind: NormalizedWeatherKind): WeatherOverlayKind => {
  if (kind === 'clear') return 'none';
  if (kind === 'partlyCloudy' || kind === 'cloudy' || kind === 'fog' || kind === 'wind') {
    return 'cloud';
  }
  if (kind === 'rain') return 'rain';
  if (kind === 'storm' || kind === 'extreme') return 'storm';
  if (kind === 'snow') return 'snow';
  if (kind === 'hail') return 'hail';
  return 'cloud';
};

type WeatherIconMapOptions = {
  date?: Date;
  latitude?: number | null;
  hemisphere?: Hemisphere;
};

export const mapConditionToIcon = (
  conditionCode: number | string | null | undefined,
  isDay: boolean,
  options?: WeatherIconMapOptions,
): WeatherIconVariant => {
  const kind = normalizeKind(conditionCode);
  const dayPart = isDay ? 'day' : 'night';
  const moonMeta = !isDay
    ? {
        moonPhase: getMoonPhase(options?.date || new Date()).phase,
        overlayKind: overlayFromKind(kind),
        hemisphere: options?.hemisphere || inferHemisphere(options?.latitude),
      }
    : undefined;

  switch (kind) {
    case 'clear':
      return {
        kind,
        staticIcon: isDay ? 'weather-sunny' : 'weather-night',
        lottieKey: isDay ? 'clear_day' : 'moon_clear',
        a11yLabelKey: isDay ? 'weather_icon_clear_day' : 'weather_icon_clear_night',
        ...moonMeta,
      };
    case 'partlyCloudy':
      return {
        kind,
        staticIcon: isDay ? 'weather-partly-cloudy' : 'weather-night-partly-cloudy',
        lottieKey: isDay ? 'partly_cloudy_day' : 'moon_cloudy',
        a11yLabelKey: isDay ? 'weather_icon_partly_cloudy_day' : 'weather_icon_partly_cloudy_night',
        ...moonMeta,
      };
    case 'rain':
      return {
        kind,
        staticIcon: 'weather-rainy',
        lottieKey: `rain_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_rain_day' : 'weather_icon_rain_night',
        ...moonMeta,
      };
    case 'storm':
      return {
        kind,
        staticIcon: 'weather-lightning-rainy',
        lottieKey: `storm_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_storm_day' : 'weather_icon_storm_night',
        ...moonMeta,
      };
    case 'snow':
      return {
        kind,
        staticIcon: 'weather-snowy',
        lottieKey: `snow_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_snow_day' : 'weather_icon_snow_night',
        ...moonMeta,
      };
    case 'hail':
      return {
        kind,
        staticIcon: 'weather-hail',
        lottieKey: `snow_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_hail_day' : 'weather_icon_hail_night',
        ...moonMeta,
      };
    case 'fog':
      return {
        kind,
        staticIcon: 'weather-fog',
        lottieKey: `fog_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_fog_day' : 'weather_icon_fog_night',
        ...moonMeta,
      };
    case 'wind':
      return {
        kind,
        staticIcon: 'weather-windy',
        lottieKey: `wind_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_wind_day' : 'weather_icon_wind_night',
        ...moonMeta,
      };
    case 'extreme':
      return {
        kind,
        staticIcon: 'weather-hurricane',
        lottieKey: `extreme_${dayPart}`,
        a11yLabelKey: isDay ? 'weather_icon_extreme_day' : 'weather_icon_extreme_night',
        ...moonMeta,
      };
    case 'cloudy':
    default:
      return {
        kind: 'cloudy',
        staticIcon: isDay ? 'weather-cloudy' : 'weather-night-partly-cloudy',
        lottieKey: isDay ? 'cloudy_day' : 'moon_cloudy',
        a11yLabelKey: isDay ? 'weather_icon_cloudy_day' : 'weather_icon_cloudy_night',
        ...moonMeta,
      };
  }
};
