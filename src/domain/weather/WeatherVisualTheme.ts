import type {
  ResolvedWeatherVisualTheme,
  WeatherSafetyLevel,
  WeatherSafetyStatus,
  WeatherSystemColorScheme,
  WeatherVisualCondition,
  WeatherVisualRiskLevel,
} from './WeatherVisualModels';

type WeatherVisualThemeInput = {
  condition?: WeatherVisualCondition | string | number | null;
  isDay?: boolean | null;
  timeOfDay?: string | null;
  temperature?: number | null;
  precipitation?: number | null;
  thunderstorm?: boolean | null;
  riskLevel?: WeatherVisualRiskLevel | null;
  windSpeed?: number | null;
  systemColorScheme?: WeatherSystemColorScheme;
};

type WeatherThemeBase = {
  backgroundGradient: string[];
  cardBackground: string;
  borderColor: string;
  glowColor: string;
  iconPrimaryColor: string;
  iconSecondaryColor: string;
  textPrimaryColor: string;
  textSecondaryColor: string;
  accentColor: string;
  shadowColor: string;
  overlayColor: string;
  overlayGradient: string[];
};

export type WeatherTheme = {
  condition: WeatherVisualCondition;
  dominantColors: string[];
  overlayGradient: string[];
  glowColor: string;
  accentColor: string;
  textTone: 'light' | 'dark';
  visualTheme: ResolvedWeatherVisualTheme;
};

const normalizeCondition = (
  condition: WeatherVisualThemeInput['condition'],
  isDay?: boolean | null,
): WeatherVisualCondition => {
  const value = String(condition ?? '').trim().toLowerCase();

  if (value.includes('thunder') || value.includes('lightning') || value.includes('storm')) {
    return 'thunderstorm';
  }
  if (value.includes('hail') || value.includes('graupel') || value.includes('ice-pellets')) {
    return 'hail';
  }
  if (value.includes('snow') || value.includes('sleet')) return 'snow';
  if (value.includes('rain') || value.includes('drizzle') || value.includes('shower')) {
    return value.includes('heavy') ? 'heavy_rain' : 'rain';
  }
  if (value.includes('fog') || value.includes('mist') || value.includes('haze')) return 'fog';
  if (value.includes('cloud') || value.includes('overcast') || value.includes('partly')) {
    return isDay === false ? 'cloudy_night' : 'cloudy_day';
  }
  if (value.includes('heat')) return 'extreme_heat';
  if (value.includes('cold')) return 'extreme_cold';
  if (
    value.includes('moon') ||
    value.includes('night') ||
    value === 'clear_night' ||
    isDay === false
  ) {
    return 'clear_night';
  }
  if (value.includes('sunrise')) return 'sunrise';
  if (value.includes('sunset')) return 'sunset';
  if (value.includes('clear') || value.includes('sunny') || value.includes('sol')) {
    return 'clear_day';
  }
  return 'fallback';
};

const isNight = (input: WeatherVisualThemeInput) =>
  (typeof input.isDay === 'boolean' && !input.isDay) ||
  input.timeOfDay === 'night';

const isSunsetLike = (input: WeatherVisualThemeInput) =>
  input.timeOfDay === 'sunset' ||
  input.timeOfDay === 'dusk' ||
  input.timeOfDay === 'goldenHour';

const isDawnLike = (input: WeatherVisualThemeInput) =>
  input.timeOfDay === 'sunrise' ||
  input.timeOfDay === 'dawn' ||
  input.timeOfDay === 'preDawn';

const SAFETY_STATUS_COPY: Record<
  WeatherSafetyLevel,
  Omit<WeatherSafetyStatus, 'level' | 'source'>
> = {
  safe: {
    labelPt: 'Seguro agora',
    labelEn: 'Safe now',
    accentColor: '#34D399',
    i18nKey: 'weather_safety_safe_now',
  },
  low: {
    labelPt: 'Baixo risco climático agora',
    labelEn: 'Low weather risk now',
    accentColor: '#A7F3D0',
    i18nKey: 'weather_safety_low_now',
  },
  watch: {
    labelPt: 'Atenção climática próxima',
    labelEn: 'Weather watch nearby',
    accentColor: '#FBBF24',
    i18nKey: 'weather_safety_watch_nearby',
  },
  danger: {
    labelPt: 'Perigo climático próximo',
    labelEn: 'Weather danger nearby',
    accentColor: '#F97316',
    i18nKey: 'weather_safety_danger_nearby',
  },
  severe: {
    labelPt: 'Condição severa',
    labelEn: 'Severe condition',
    accentColor: '#FF3B6B',
    i18nKey: 'weather_safety_severe_condition',
  },
};

const makeSafetyStatus = (
  level: WeatherSafetyLevel,
  source: WeatherSafetyStatus['source'],
): WeatherSafetyStatus => ({
  level,
  source,
  ...SAFETY_STATUS_COPY[level],
});

export const resolveWeatherSafetyStatus = ({
  condition,
  precipitation,
  thunderstorm,
  temperature,
  windSpeed,
  riskLevel,
}: {
  condition?: WeatherVisualCondition | string | number | null;
  precipitation?: number | null;
  thunderstorm?: boolean | null;
  temperature?: number | null;
  windSpeed?: number | null;
  riskLevel?: WeatherVisualRiskLevel | null;
}): WeatherSafetyStatus => {
  const normalizedCondition = normalizeCondition(condition, undefined);
  const source: WeatherSafetyStatus['source'] =
    riskLevel === 'high' || riskLevel === 'severe'
      ? 'official_alert'
      : 'internal_condition';

  if (riskLevel === 'severe') return makeSafetyStatus('severe', source);
  if (riskLevel === 'high') return makeSafetyStatus('danger', source);
  if (thunderstorm || normalizedCondition === 'thunderstorm') {
    return makeSafetyStatus('danger', source);
  }
  if (
    normalizedCondition === 'extreme_heat' &&
    typeof temperature === 'number' &&
    Number.isFinite(temperature) &&
    temperature >= 40
  ) {
    return makeSafetyStatus('danger', source);
  }
  if (
    normalizedCondition === 'rain' ||
    normalizedCondition === 'heavy_rain' ||
    normalizedCondition === 'hail' ||
    normalizedCondition === 'snow' ||
    normalizedCondition === 'fog' ||
    normalizedCondition === 'extreme_cold' ||
    normalizedCondition === 'extreme_heat'
  ) {
    return makeSafetyStatus('watch', source);
  }
  if (
    typeof precipitation === 'number' &&
    Number.isFinite(precipitation) &&
    precipitation >= 50
  ) {
    return makeSafetyStatus('watch', source);
  }
  if (
    typeof windSpeed === 'number' &&
    Number.isFinite(windSpeed) &&
    windSpeed >= 45
  ) {
    return makeSafetyStatus('watch', source);
  }
  if (normalizedCondition === 'cloudy_day' || normalizedCondition === 'cloudy_night') {
    return makeSafetyStatus('low', source);
  }
  return makeSafetyStatus('safe', source);
};

const withContrastAdjustment = (
  base: WeatherThemeBase,
  systemColorScheme: WeatherSystemColorScheme,
  riskStatus: WeatherSafetyStatus,
): ResolvedWeatherVisualTheme => {
  const darkSystem = systemColorScheme === 'dark';
  const lightSystem = systemColorScheme === 'light';

  return {
    ...base,
    textPrimaryColor: '#FFFFFF',
    textSecondaryColor: 'rgba(255,255,255,0.88)',
    overlayColor: base.overlayColor || 'rgba(3,7,16,0.42)',
    overlayGradient: base.overlayGradient.map((color, index) => {
      if (darkSystem && index === base.overlayGradient.length - 1) {
        return color.replace(/0\.\d+\)/, '0.78)');
      }
      if (lightSystem && index === 0) {
        return color.replace(/0\.\d+\)/, '0.08)');
      }
      return color;
    }),
    surfaceColor: 'rgba(0,0,0,0.44)',
    chipBackgroundColor: 'rgba(0,0,0,0.46)',
    chipBorderColor: 'rgba(255,255,255,0.16)',
    riskStatus,
    riskLabel: riskStatus.labelEn,
    riskAccentColor: riskStatus.accentColor,
  };
};

const addRiskAccent = (
  theme: WeatherThemeBase,
  riskLevel?: WeatherVisualRiskLevel | null,
): WeatherThemeBase => {
  if (riskLevel !== 'high' && riskLevel !== 'severe') return theme;

  const riskColor = riskLevel === 'severe' ? '#FF3B6B' : '#FFB020';
  return {
    ...theme,
    borderColor: riskLevel === 'severe' ? 'rgba(255,59,107,0.72)' : 'rgba(255,176,32,0.66)',
    accentColor: riskColor,
    shadowColor: riskLevel === 'severe' ? '#7A1234' : '#8A4F00',
    overlayGradient: [
      `rgba(${riskLevel === 'severe' ? '255,59,107' : '255,176,32'},0.14)`,
      ...theme.overlayGradient.slice(1),
    ],
  };
};

const makeTheme = (
  condition: WeatherVisualCondition,
  base: WeatherThemeBase,
  input: WeatherVisualThemeInput,
  systemColorScheme: WeatherSystemColorScheme,
  riskLevel?: WeatherVisualRiskLevel | null,
): ResolvedWeatherVisualTheme => {
  const riskStatus = resolveWeatherSafetyStatus({
    condition,
    precipitation: input.precipitation,
    thunderstorm: input.thunderstorm,
    temperature: input.temperature,
    windSpeed: input.windSpeed,
    riskLevel,
  });
  return withContrastAdjustment(
    addRiskAccent(base, riskLevel),
    systemColorScheme,
    riskStatus,
  );
};

const clearDayBase = (input: WeatherVisualThemeInput): WeatherThemeBase => {
  const hot =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature >= 34
      : false;

  if (hot) {
    return {
      backgroundGradient: ['#3A2412', '#1A1010', '#080505'],
      cardBackground: '#3A2412',
      borderColor: 'rgba(255,176,32,0.48)',
      glowColor: '#FFB000',
      iconPrimaryColor: '#FFF4B8',
      iconSecondaryColor: '#FF6F00',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB020',
      shadowColor: '#8A3B00',
      overlayColor: 'rgba(8,4,0,0.42)',
      overlayGradient: ['rgba(255,176,32,0.08)', 'rgba(60,22,3,0.34)', 'rgba(4,8,16,0.78)'],
    };
  }

  if (isDawnLike(input)) {
    return {
      backgroundGradient: ['#26365A', '#101B34', '#060812'],
      cardBackground: '#26365A',
      borderColor: 'rgba(255,190,112,0.42)',
      glowColor: '#FFB45E',
      iconPrimaryColor: '#FFE45C',
      iconSecondaryColor: '#FF8A3D',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFD166',
      shadowColor: '#85512A',
      overlayColor: 'rgba(4,8,18,0.42)',
      overlayGradient: ['rgba(255,209,102,0.07)', 'rgba(31,49,82,0.36)', 'rgba(4,8,18,0.78)'],
    };
  }

  if (isSunsetLike(input)) {
    return {
      backgroundGradient: ['#26365A', '#101B34', '#060812'],
      cardBackground: '#26365A',
      borderColor: 'rgba(255,180,94,0.44)',
      glowColor: '#FF8C42',
      iconPrimaryColor: '#FFD166',
      iconSecondaryColor: '#FF6B6B',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB45E',
      shadowColor: '#53327A',
      overlayColor: 'rgba(5,7,18,0.44)',
      overlayGradient: ['rgba(255,180,94,0.08)', 'rgba(75,30,69,0.36)', 'rgba(5,7,18,0.80)'],
    };
  }

  return {
    backgroundGradient: ['#26365A', '#101B34', '#060812'],
    cardBackground: '#26365A',
    borderColor: 'rgba(255,209,102,0.40)',
    glowColor: '#FFD166',
    iconPrimaryColor: '#FFE45C',
    iconSecondaryColor: '#FFB300',
    textPrimaryColor: '#FFFFFF',
    textSecondaryColor: 'rgba(255,255,255,0.88)',
    accentColor: '#FFD166',
    shadowColor: '#1565A8',
    overlayColor: 'rgba(2,8,18,0.42)',
    overlayGradient: ['rgba(255,209,102,0.07)', 'rgba(11,42,74,0.34)', 'rgba(2,8,18,0.78)'],
  };
};

const clearNightBase = (): WeatherThemeBase => ({
  backgroundGradient: ['#1B2A55', '#0B1020', '#04060C'],
  cardBackground: '#1B2A55',
  borderColor: 'rgba(206,221,255,0.28)',
  glowColor: '#B8C7FF',
  iconPrimaryColor: '#F6F0D8',
  iconSecondaryColor: '#B8C7FF',
  textPrimaryColor: '#FFFFFF',
  textSecondaryColor: 'rgba(255,255,255,0.88)',
  accentColor: '#D9E7FF',
  shadowColor: '#02040B',
  overlayColor: 'rgba(2,5,16,0.30)',
  overlayGradient: ['rgba(255,255,255,0.05)', 'rgba(12,16,52,0.32)', 'rgba(2,4,14,0.70)'],
});

const baseByCondition = (
  condition: WeatherVisualCondition,
  input: WeatherVisualThemeInput,
): WeatherThemeBase => {
  if (condition === 'clear_day' || condition === 'sunrise' || condition === 'sunset') {
    return clearDayBase(input);
  }
  if (
    condition === 'clear_night' ||
    condition === 'full_moon_yellow' ||
    condition === 'full_moon_blue' ||
    condition === 'full_moon_purple' ||
    condition === 'full_moon_white' ||
    condition === 'crescent_moon' ||
    condition === 'new_moon'
  ) {
    return clearNightBase();
  }
  if (condition === 'rain' || condition === 'heavy_rain') {
    return isNight(input)
      ? {
          backgroundGradient: ['#12324A', '#081B2A', '#04070C'],
          cardBackground: '#12324A',
          borderColor: 'rgba(94,225,255,0.36)',
          glowColor: '#35D5FF',
          iconPrimaryColor: '#8DEBFF',
          iconSecondaryColor: '#2E8BFF',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#37D5FF',
          shadowColor: '#031325',
          overlayColor: 'rgba(1,8,20,0.34)',
          overlayGradient: ['rgba(55,213,255,0.10)', 'rgba(4,28,58,0.38)', 'rgba(1,8,20,0.74)'],
        }
      : {
          backgroundGradient: ['#12324A', '#081B2A', '#04070C'],
          cardBackground: '#12324A',
          borderColor: 'rgba(77,227,255,0.38)',
          glowColor: '#39D7FF',
          iconPrimaryColor: '#8DEBFF',
          iconSecondaryColor: '#2E8BFF',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#4DE3FF',
          shadowColor: '#063056',
          overlayColor: 'rgba(1,8,20,0.42)',
          overlayGradient: ['rgba(77,227,255,0.08)', 'rgba(7,52,95,0.36)', 'rgba(1,8,20,0.78)'],
        };
  }
  if (condition === 'thunderstorm') {
    return {
      backgroundGradient: ['#281B4D', '#101527', '#05070F'],
      cardBackground: '#281B4D',
      borderColor: 'rgba(234,251,255,0.46)',
      glowColor: '#EAFBFF',
      iconPrimaryColor: '#FFFFFF',
      iconSecondaryColor: '#8B5CFF',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#B46BFF',
      shadowColor: '#020308',
      overlayColor: 'rgba(2,3,10,0.36)',
      overlayGradient: ['rgba(234,251,255,0.10)', 'rgba(26,11,61,0.42)', 'rgba(2,3,10,0.78)'],
    };
  }
  if (condition === 'snow' || condition === 'hail' || condition === 'extreme_cold') {
    return {
      backgroundGradient: ['#223647', '#0E1B2A', '#05090F'],
      cardBackground: '#223647',
      borderColor: 'rgba(221,251,255,0.36)',
      glowColor: '#DDFBFF',
      iconPrimaryColor: '#FFFFFF',
      iconSecondaryColor: '#6CCBFF',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#63C7FF',
      shadowColor: '#5A92D6',
      overlayColor: 'rgba(2,7,16,0.44)',
      overlayGradient: ['rgba(221,251,255,0.07)', 'rgba(20,49,74,0.36)', 'rgba(2,7,16,0.78)'],
    };
  }
  if (condition === 'fog') {
    return {
      backgroundGradient: ['#2D3742', '#151A22', '#07090D'],
      cardBackground: '#2D3742',
      borderColor: 'rgba(190,207,218,0.30)',
      glowColor: '#9FB4C3',
      iconPrimaryColor: '#F1F6F9',
      iconSecondaryColor: '#8799A8',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#B7C7D4',
      shadowColor: '#4C6072',
      overlayColor: 'rgba(2,7,12,0.46)',
      overlayGradient: ['rgba(190,207,218,0.07)', 'rgba(27,43,56,0.36)', 'rgba(2,7,12,0.80)'],
    };
  }
  if (condition === 'cloudy_day' || condition === 'cloudy_night') {
    return condition === 'cloudy_night' || isNight(input)
      ? {
          backgroundGradient: ['#263746', '#101820', '#060A0F'],
          cardBackground: '#263746',
          borderColor: 'rgba(210,225,240,0.28)',
          glowColor: '#9FB8D0',
          iconPrimaryColor: '#DCE7F2',
          iconSecondaryColor: '#8EA4B8',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#B8C9DA',
          shadowColor: '#050912',
          overlayColor: 'rgba(5,9,18,0.30)',
          overlayGradient: ['rgba(220,231,242,0.07)', 'rgba(35,54,80,0.34)', 'rgba(5,9,18,0.70)'],
        }
      : {
          backgroundGradient: ['#263746', '#101820', '#060A0F'],
          cardBackground: '#263746',
          borderColor: 'rgba(184,201,218,0.34)',
          glowColor: '#9FB8D0',
          iconPrimaryColor: '#E9F1F7',
          iconSecondaryColor: '#8B9DAE',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#B8C9DA',
          shadowColor: '#526779',
          overlayColor: 'rgba(2,7,14,0.44)',
          overlayGradient: ['rgba(184,201,218,0.07)', 'rgba(26,42,61,0.36)', 'rgba(2,7,14,0.80)'],
        };
  }
  if (condition === 'extreme_heat') {
    return {
      backgroundGradient: ['#3A2412', '#1A1010', '#080505'],
      cardBackground: '#3A2412',
      borderColor: 'rgba(255,176,32,0.52)',
      glowColor: '#FFB020',
      iconPrimaryColor: '#FFF3B0',
      iconSecondaryColor: '#FF3D00',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB020',
      shadowColor: '#651500',
      overlayColor: 'rgba(8,4,0,0.44)',
      overlayGradient: ['rgba(255,176,32,0.08)', 'rgba(92,28,0,0.38)', 'rgba(8,4,0,0.80)'],
    };
  }
  return isNight(input) ? clearNightBase() : clearDayBase(input);
};

export const resolveWeatherVisualTheme = (
  input: WeatherVisualThemeInput,
): ResolvedWeatherVisualTheme => {
  const condition =
    input.thunderstorm === true
      ? 'thunderstorm'
      : normalizeCondition(input.condition, input.isDay);
  const riskLevel = input.riskLevel;
  return makeTheme(
    condition,
    baseByCondition(condition, input),
    input,
    input.systemColorScheme,
    riskLevel,
  );
};

const toWeatherTheme = (
  condition: WeatherVisualCondition,
  input: WeatherVisualThemeInput = {},
): WeatherTheme => {
  const visualTheme = resolveWeatherVisualTheme({...input, condition});
  return {
    condition,
    dominantColors: visualTheme.backgroundGradient,
    overlayGradient: visualTheme.overlayGradient,
    glowColor: visualTheme.glowColor,
    accentColor: visualTheme.accentColor,
    textTone: visualTheme.textPrimaryColor === '#FFFFFF' ? 'light' : 'dark',
    visualTheme,
  };
};

const ASSET_CONDITIONS: Record<string, WeatherVisualCondition> = {
  clear_day_sun: 'clear_day',
  sunrise_gold: 'sunrise',
  sunset_purple_gold: 'sunset',
  full_moon_yellow: 'full_moon_yellow',
  full_moon_blue: 'full_moon_blue',
  full_moon_purple: 'full_moon_purple',
  full_moon_white: 'full_moon_white',
  crescent_moon: 'crescent_moon',
  new_moon_stars: 'new_moon',
  rain_blue_led: 'rain',
  thunderstorm_lightning: 'thunderstorm',
  snow_superwhite: 'snow',
  hail_ice_storm: 'hail',
  cloudy_day: 'cloudy_day',
  cloudy_night: 'cloudy_night',
  extreme_heat: 'extreme_heat',
  extreme_cold: 'extreme_cold',
  fallback_dark: 'fallback',
};

export const getWeatherTheme = (assetId: string): WeatherTheme => {
  return toWeatherTheme(ASSET_CONDITIONS[assetId] || 'fallback');
};

export const getWeatherThemeByCondition = (
  condition: WeatherVisualCondition,
): WeatherTheme => toWeatherTheme(condition);

export const ALL_THEMES = Object.keys(ASSET_CONDITIONS);
