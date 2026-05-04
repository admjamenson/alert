export type WeatherVisualState =
  | 'sunny'
  | 'cloudy'
  | 'rainy'
  | 'thunderstorm'
  | 'fallback';

export type WeatherVisualSignal = {
  icon?: string | null;
  label?: string | null;
};

const THUNDER_PATTERN =
  /(trov|trovo|trovao|trov[aã]o|raio|raios|relamp|rel[aâ]mp|thunder|lightning|storm|tempest)/i;
const RAIN_PATTERN = /(chuv|rain|drizzle|showers?|pouring)/i;
const CLEAR_PATTERN = /(ensolar|sol|sunny|clear|ceu limpo|céu limpo)/i;
const CLOUDY_PATTERN = /(cloud|nublad|overcast|nebul|fog|mist)/i;

const ICON_STATE_MAP: Record<string, WeatherVisualState> = {
  'weather-sunny': 'sunny',
  'weather-night': 'sunny',
  'weather-partly-cloudy': 'cloudy',
  'weather-night-partly-cloudy': 'cloudy',
  'weather-cloudy': 'cloudy',
  'weather-fog': 'cloudy',
  'weather-windy': 'cloudy',
  'weather-rainy': 'rainy',
  'weather-pouring': 'rainy',
  'weather-lightning-rainy': 'thunderstorm',
  'weather-hurricane': 'thunderstorm',
  'weather-snowy': 'cloudy',
  'weather-snowy-heavy': 'cloudy',
  'weather-hail': 'cloudy',
};

const normalizeSignal = (value?: string | null): string => {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/\uFFFD/g, '')
    .replace(/[?¿]+/g, '')
    .replace(/[Ã‚Ãƒ]/g, '')
    .trim()
    .toLowerCase();
};

const classifySignal = (icon?: string | null, label?: string | null): WeatherVisualState | null => {
  const safeIcon = normalizeSignal(icon);
  const safeLabel = normalizeSignal(label);
  const combined = `${safeIcon} ${safeLabel}`.trim();
  if (!combined) return null;

  if (THUNDER_PATTERN.test(combined) || ICON_STATE_MAP[safeIcon] === 'thunderstorm') {
    return 'thunderstorm';
  }
  if (RAIN_PATTERN.test(combined) || ICON_STATE_MAP[safeIcon] === 'rainy') {
    return 'rainy';
  }
  if (CLEAR_PATTERN.test(combined) || ICON_STATE_MAP[safeIcon] === 'sunny') {
    return 'sunny';
  }
  if (CLOUDY_PATTERN.test(combined) || ICON_STATE_MAP[safeIcon] === 'cloudy') {
    return 'cloudy';
  }
  return null;
};

export const resolveWeatherVisualState = (
  signals: WeatherVisualSignal[],
  fallback: WeatherVisualState = 'fallback',
): WeatherVisualState => {
  for (const signal of signals) {
    const state = classifySignal(signal.icon, signal.label);
    if (state) return state;
  }
  return fallback;
};

export const mapWeatherVisualStateToIcon = (state: WeatherVisualState): string => {
  switch (state) {
    case 'sunny':
      return 'weather-sunny';
    case 'rainy':
      return 'weather-rainy';
    case 'thunderstorm':
      return 'weather-lightning-rainy';
    case 'cloudy':
    case 'fallback':
    default:
      return 'weather-cloudy';
  }
};
