import type {
  ResolvedWeatherVisualTheme,
  WeatherDayPhase,
  WeatherSafetyLevel,
  WeatherSafetyStatus,
  WeatherSystemColorScheme,
  WeatherVisualCondition,
  WeatherVisualRiskLevel,
} from './WeatherVisualModels';

type WeatherVisualThemeInput = {
  condition?: WeatherVisualCondition | string | number | null;
  date?: Date | string | number | null;
  localHour?: number | null;
  sunrise?: Date | string | number | null;
  sunset?: Date | string | number | null;
  timezone?: string | null;
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

export const WEATHER_DAY_PHASE_GRADIENTS: Record<WeatherDayPhase, string[]> = {
  morning: ['#5B86E5', '#3B5F9C', '#18243D'],
  noon: ['#4DA8FF', '#2E5EAA', '#12233F'],
  afternoon: ['#4F6D8C', '#344B63', '#161F2B'],
  sunset: ['#A35D3B', '#6A3B2A', '#241611'],
  night: ['#233A66', '#101C33', '#060B14'],
  midnight: ['#111827', '#090E18', '#03060B'],
  predawn: ['#2C3E57', '#182434', '#070B12'],
};

const MINUTES_IN_DAY = 24 * 60;
const normalizeMinutes = (value: number) => {
  const next = value % MINUTES_IN_DAY;
  return next < 0 ? next + MINUTES_IN_DAY : next;
};

const isInCircularRange = (value: number, start: number, end: number) => {
  const v = normalizeMinutes(value);
  const s = normalizeMinutes(start);
  const e = normalizeMinutes(end);
  if (s <= e) return v >= s && v <= e;
  return v >= s || v <= e;
};

const asValidDate = (value?: Date | string | number | null): Date | null => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const clockMinutesInTimeZone = (
  value?: Date | string | number | null,
  timezone?: string | null,
): number | null => {
  const date = asValidDate(value);
  if (!date) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return normalizeMinutes(hour * 60 + minute);
    }
  } catch {
    // ignore and use the runtime timezone fallback below
  }

  return normalizeMinutes(date.getHours() * 60 + date.getMinutes());
};

const phaseFromLocalMinutes = (minutes: number): WeatherDayPhase => {
  if (minutes >= 3 * 60 && minutes < 5 * 60 + 30) return 'predawn';
  if (minutes >= 5 * 60 + 30 && minutes < 11 * 60) return 'morning';
  if (minutes >= 11 * 60 && minutes < 14 * 60) return 'noon';
  if (minutes >= 14 * 60 && minutes < 17 * 60) return 'afternoon';
  if (minutes >= 17 * 60 && minutes < 19 * 60) return 'sunset';
  if (minutes >= 19 * 60 && minutes < 23 * 60) return 'night';
  return 'midnight';
};

const normalizeTimeOfDayPhase = (
  value?: string | null,
): WeatherDayPhase | null => {
  switch (value) {
    case 'preDawn':
    case 'predawn':
      return 'predawn';
    case 'dawn':
    case 'sunrise':
    case 'morning':
      return 'morning';
    case 'midday':
    case 'noon':
    case 'day':
      return 'noon';
    case 'afternoon':
      return 'afternoon';
    case 'goldenHour':
    case 'sunset':
    case 'dusk':
      return 'sunset';
    case 'night':
      return 'night';
    case 'midnight':
      return 'midnight';
    default:
      return null;
  }
};

export const resolveWeatherDayPhase = ({
  date,
  localHour,
  sunrise,
  sunset,
  timezone,
  timeOfDay,
}: {
  date?: Date | string | number | null;
  localHour?: number | null;
  sunrise?: Date | string | number | null;
  sunset?: Date | string | number | null;
  timezone?: string | null;
  timeOfDay?: string | null;
}): WeatherDayPhase => {
  const explicitPhase = normalizeTimeOfDayPhase(timeOfDay);
  if (explicitPhase) return explicitPhase;

  const currentMinutes =
    typeof localHour === 'number' && Number.isFinite(localHour)
      ? normalizeMinutes(Math.floor(localHour * 60))
      : clockMinutesInTimeZone(date || Date.now(), timezone);

  if (currentMinutes === null) return 'noon';

  const sunriseMinutes = clockMinutesInTimeZone(sunrise, timezone);
  const sunsetMinutes = clockMinutesInTimeZone(sunset, timezone);

  if (sunriseMinutes !== null && sunsetMinutes !== null) {
    const morningStart = sunriseMinutes - 20;
    const sunsetStart = sunsetMinutes - 90;
    const sunsetEnd = sunsetMinutes + 60;

    if (isInCircularRange(currentMinutes, sunsetStart, sunsetEnd)) {
      return 'sunset';
    }
    if (isInCircularRange(currentMinutes, morningStart, 11 * 60 - 1)) {
      return 'morning';
    }
    if (currentMinutes >= 11 * 60 && currentMinutes < 14 * 60) return 'noon';
    if (isInCircularRange(currentMinutes, 14 * 60, sunsetStart - 1)) {
      return 'afternoon';
    }
    if (currentMinutes >= 23 * 60 || currentMinutes < 3 * 60) {
      return 'midnight';
    }
    if (currentMinutes >= 3 * 60 && currentMinutes < morningStart) {
      return 'predawn';
    }
    return 'night';
  }

  return phaseFromLocalMinutes(currentMinutes);
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
  input.timeOfDay === 'night' ||
  input.timeOfDay === 'midnight' ||
  input.timeOfDay === 'predawn' ||
  input.timeOfDay === 'preDawn';

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
    surfaceColor: 'rgba(0,0,0,0.38)',
    chipBackgroundColor: 'rgba(0,0,0,0.38)',
    chipBorderColor: 'rgba(255,255,255,0.14)',
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

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return `${r},${g},${b}`;
};

const accentOverlay = (accentColor: string, opacity: number) => {
  const rgb = hexToRgb(accentColor);
  return rgb ? `rgba(${rgb},${opacity})` : `rgba(255,255,255,${opacity})`;
};

const applyDayPhaseGradient = (
  theme: WeatherThemeBase,
  input: WeatherVisualThemeInput,
): WeatherThemeBase => {
  const phase = resolveWeatherDayPhase({
    date: input.date,
    localHour: input.localHour,
    sunrise: input.sunrise,
    sunset: input.sunset,
    timezone: input.timezone,
    timeOfDay: input.timeOfDay,
  });
  const backgroundGradient = WEATHER_DAY_PHASE_GRADIENTS[phase];
  const deepBase = backgroundGradient[2];

  return {
    ...theme,
    backgroundGradient,
    cardBackground: deepBase,
    shadowColor: deepBase,
    overlayColor: 'rgba(3,7,16,0.42)',
    overlayGradient: [
      accentOverlay(theme.accentColor, phase === 'sunset' ? 0.08 : 0.05),
      'rgba(0,0,0,0.16)',
      'rgba(0,0,0,0.58)',
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
    addRiskAccent(applyDayPhaseGradient(base, input), riskLevel),
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
      backgroundGradient: ['#2F4D82', '#172846', '#070D19'],
      cardBackground: '#172846',
      borderColor: 'rgba(255,176,32,0.48)',
      glowColor: '#FFB000',
      iconPrimaryColor: '#FFF4B8',
      iconSecondaryColor: '#FF6F00',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB020',
      shadowColor: '#071325',
      overlayColor: 'rgba(4,8,18,0.38)',
      overlayGradient: ['rgba(255,176,32,0.05)', 'rgba(21,37,68,0.22)', 'rgba(4,8,18,0.56)'],
    };
  }

  if (isDawnLike(input)) {
    return {
      backgroundGradient: ['#355C9A', '#1C325A', '#0A1426'],
      cardBackground: '#1C325A',
      borderColor: 'rgba(255,190,112,0.42)',
      glowColor: '#FFB45E',
      iconPrimaryColor: '#FFE45C',
      iconSecondaryColor: '#FF8A3D',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFD166',
      shadowColor: '#85512A',
      overlayColor: 'rgba(4,8,18,0.38)',
      overlayGradient: ['rgba(255,209,102,0.05)', 'rgba(28,50,90,0.22)', 'rgba(4,8,18,0.56)'],
    };
  }

  if (isSunsetLike(input)) {
    return {
      backgroundGradient: ['#8A4B2A', '#5A2F1E', '#24130D'],
      cardBackground: '#5A2F1E',
      borderColor: 'rgba(255,180,94,0.44)',
      glowColor: '#FF8C42',
      iconPrimaryColor: '#FFD166',
      iconSecondaryColor: '#FF6B6B',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB45E',
      shadowColor: '#24130D',
      overlayColor: 'rgba(16,8,4,0.38)',
      overlayGradient: ['rgba(255,180,94,0.05)', 'rgba(90,47,30,0.22)', 'rgba(16,8,4,0.58)'],
    };
  }

  return {
    backgroundGradient: ['#355C9A', '#1C325A', '#0A1426'],
    cardBackground: '#1C325A',
    borderColor: 'rgba(255,209,102,0.40)',
    glowColor: '#FFD166',
    iconPrimaryColor: '#FFE45C',
    iconSecondaryColor: '#FFB300',
    textPrimaryColor: '#FFFFFF',
    textSecondaryColor: 'rgba(255,255,255,0.88)',
    accentColor: '#FFD166',
    shadowColor: '#1565A8',
    overlayColor: 'rgba(2,8,18,0.38)',
    overlayGradient: ['rgba(255,209,102,0.05)', 'rgba(28,50,90,0.22)', 'rgba(2,8,18,0.56)'],
  };
};

const clearNightBase = (): WeatherThemeBase => ({
  backgroundGradient: ['#111827', '#090E18', '#03060B'],
  cardBackground: '#090E18',
  borderColor: 'rgba(206,221,255,0.28)',
  glowColor: '#B8C7FF',
  iconPrimaryColor: '#F6F0D8',
  iconSecondaryColor: '#B8C7FF',
  textPrimaryColor: '#FFFFFF',
  textSecondaryColor: 'rgba(255,255,255,0.88)',
  accentColor: '#D9E7FF',
  shadowColor: '#02040B',
  overlayColor: 'rgba(2,5,16,0.32)',
  overlayGradient: ['rgba(206,221,255,0.04)', 'rgba(9,14,24,0.22)', 'rgba(2,4,14,0.56)'],
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
          backgroundGradient: ['#274B6B', '#16324A', '#08131D'],
          cardBackground: '#16324A',
          borderColor: 'rgba(94,225,255,0.36)',
          glowColor: '#35D5FF',
          iconPrimaryColor: '#8DEBFF',
          iconSecondaryColor: '#2E8BFF',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#37D5FF',
          shadowColor: '#031325',
          overlayColor: 'rgba(1,8,20,0.32)',
          overlayGradient: ['rgba(55,213,255,0.05)', 'rgba(22,50,74,0.24)', 'rgba(1,8,20,0.56)'],
        }
      : {
          backgroundGradient: ['#274B6B', '#16324A', '#08131D'],
          cardBackground: '#16324A',
          borderColor: 'rgba(77,227,255,0.38)',
          glowColor: '#39D7FF',
          iconPrimaryColor: '#8DEBFF',
          iconSecondaryColor: '#2E8BFF',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#4DE3FF',
          shadowColor: '#063056',
          overlayColor: 'rgba(1,8,20,0.36)',
          overlayGradient: ['rgba(77,227,255,0.05)', 'rgba(22,50,74,0.22)', 'rgba(1,8,20,0.56)'],
        };
  }
  if (condition === 'thunderstorm') {
    return {
      backgroundGradient: ['#3A3F74', '#1C234A', '#090D1C'],
      cardBackground: '#1C234A',
      borderColor: 'rgba(234,251,255,0.46)',
      glowColor: '#EAFBFF',
      iconPrimaryColor: '#FFFFFF',
      iconSecondaryColor: '#8B5CFF',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#B46BFF',
      shadowColor: '#020308',
      overlayColor: 'rgba(2,3,10,0.34)',
      overlayGradient: ['rgba(234,251,255,0.05)', 'rgba(28,35,74,0.24)', 'rgba(2,3,10,0.58)'],
    };
  }
  if (condition === 'snow' || condition === 'hail' || condition === 'extreme_cold') {
    return {
      backgroundGradient: ['#3F5E72', '#263746', '#0E161D'],
      cardBackground: '#263746',
      borderColor: 'rgba(221,251,255,0.36)',
      glowColor: '#DDFBFF',
      iconPrimaryColor: '#FFFFFF',
      iconSecondaryColor: '#6CCBFF',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#63C7FF',
      shadowColor: '#5A92D6',
      overlayColor: 'rgba(2,7,16,0.36)',
      overlayGradient: ['rgba(221,251,255,0.05)', 'rgba(38,55,70,0.22)', 'rgba(2,7,16,0.56)'],
    };
  }
  if (condition === 'fog') {
    return {
      backgroundGradient: ['#5A646E', '#343C44', '#15191D'],
      cardBackground: '#343C44',
      borderColor: 'rgba(190,207,218,0.30)',
      glowColor: '#9FB4C3',
      iconPrimaryColor: '#F1F6F9',
      iconSecondaryColor: '#8799A8',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#B7C7D4',
      shadowColor: '#4C6072',
      overlayColor: 'rgba(2,7,12,0.36)',
      overlayGradient: ['rgba(190,207,218,0.04)', 'rgba(52,60,68,0.22)', 'rgba(2,7,12,0.56)'],
    };
  }
  if (condition === 'cloudy_day' || condition === 'cloudy_night') {
    if (isSunsetLike(input)) {
      return {
        backgroundGradient: ['#6B5C57', '#3D3435', '#171314'],
        cardBackground: '#3D3435',
        borderColor: 'rgba(231,210,197,0.30)',
        glowColor: '#C7A090',
        iconPrimaryColor: '#E6EDF2',
        iconSecondaryColor: '#AEB8C1',
        textPrimaryColor: '#FFFFFF',
        textSecondaryColor: 'rgba(255,255,255,0.88)',
        accentColor: '#D7B09F',
        shadowColor: '#171314',
        overlayColor: 'rgba(8,6,6,0.34)',
        overlayGradient: ['rgba(231,210,197,0.04)', 'rgba(61,52,53,0.22)', 'rgba(8,6,6,0.56)'],
      };
    }
    return condition === 'cloudy_night' || isNight(input)
      ? {
          backgroundGradient: ['#111827', '#090E18', '#03060B'],
          cardBackground: '#090E18',
          borderColor: 'rgba(210,225,240,0.28)',
          glowColor: '#9FB8D0',
          iconPrimaryColor: '#DCE7F2',
          iconSecondaryColor: '#8EA4B8',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#B8C9DA',
          shadowColor: '#050912',
          overlayColor: 'rgba(5,9,18,0.30)',
          overlayGradient: ['rgba(220,231,242,0.04)', 'rgba(9,14,24,0.22)', 'rgba(5,9,18,0.56)'],
        }
      : {
          backgroundGradient: ['#556270', '#2F3B46', '#131A21'],
          cardBackground: '#2F3B46',
          borderColor: 'rgba(184,201,218,0.34)',
          glowColor: '#9FB8D0',
          iconPrimaryColor: '#E9F1F7',
          iconSecondaryColor: '#8B9DAE',
          textPrimaryColor: '#FFFFFF',
          textSecondaryColor: 'rgba(255,255,255,0.88)',
          accentColor: '#B8C9DA',
          shadowColor: '#526779',
          overlayColor: 'rgba(2,7,14,0.36)',
          overlayGradient: ['rgba(184,201,218,0.04)', 'rgba(47,59,70,0.22)', 'rgba(2,7,14,0.56)'],
        };
  }
  if (condition === 'extreme_heat') {
    return {
      backgroundGradient: ['#2F4D82', '#172846', '#070D19'],
      cardBackground: '#172846',
      borderColor: 'rgba(255,176,32,0.52)',
      glowColor: '#FFB020',
      iconPrimaryColor: '#FFF3B0',
      iconSecondaryColor: '#FF3D00',
      textPrimaryColor: '#FFFFFF',
      textSecondaryColor: 'rgba(255,255,255,0.88)',
      accentColor: '#FFB020',
      shadowColor: '#071325',
      overlayColor: 'rgba(4,8,18,0.36)',
      overlayGradient: ['rgba(255,176,32,0.05)', 'rgba(23,40,70,0.22)', 'rgba(4,8,18,0.58)'],
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
