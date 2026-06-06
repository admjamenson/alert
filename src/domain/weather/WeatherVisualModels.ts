import type {ImageSourcePropType} from 'react-native';
import type {MoonPhase} from '../../utils/moonPhase';

export type WeatherVisualCondition =
  | 'clear_day'
  | 'clear_night'
  | 'sunrise'
  | 'sunset'
  | 'full_moon_yellow'
  | 'full_moon_blue'
  | 'full_moon_purple'
  | 'full_moon_white'
  | 'crescent_moon'
  | 'new_moon'
  | 'cloudy_day'
  | 'cloudy_night'
  | 'rain'
  | 'heavy_rain'
  | 'thunderstorm'
  | 'snow'
  | 'hail'
  | 'fog'
  | 'extreme_heat'
  | 'extreme_cold'
  | 'fallback';

export type WeatherVisualTextTone = 'light' | 'dark';
export type WeatherVisualPerformanceTier = 'low' | 'mid' | 'high';
export type WeatherVisualFreshness = 'fresh' | 'stale' | 'expired' | 'unknown';
export type WeatherSystemColorScheme = 'light' | 'dark' | null | undefined;
export type WeatherVisualRiskLevel =
  | 'none'
  | 'low'
  | 'moderate'
  | 'high'
  | 'severe';
export type WeatherSafetyLevel =
  | 'safe'
  | 'low'
  | 'watch'
  | 'danger'
  | 'severe';

export type WeatherSafetyStatus = {
  level: WeatherSafetyLevel;
  labelPt: string;
  labelEn: string;
  accentColor: string;
  i18nKey: string;
  source: 'official_alert' | 'internal_condition';
};

export type ResolvedWeatherVisualTheme = {
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
  surfaceColor: string;
  chipBackgroundColor: string;
  chipBorderColor: string;
  riskStatus: WeatherSafetyStatus;
  riskLabel: string;
  riskAccentColor: string;
};

export type WeatherVisualAsset = {
  id: string;
  condition: WeatherVisualCondition;
  source: 'local' | 'remote' | 'gradientFallback';
  localAsset?: ImageSourcePropType;
  expectedAssetPath?: string;
  remoteUrl?: string;
  blurHash?: string;
  dominantColors: string[];
  overlayGradient: string[];
  textTone: WeatherVisualTextTone;
  recommendedOpacity: number;
  accessibilityI18nKey: string;
  minContrastOverlay: number;
  isAnimated?: boolean;
  performanceTier: WeatherVisualPerformanceTier;
  fallbackAssetId?: string;
};

export type WeatherVisualContext = {
  weatherCondition?: string | number | null;
  isDay?: boolean | null;
  localTime?: Date | string | number | null;
  sunriseTime?: Date | string | number | null;
  sunsetTime?: Date | string | number | null;
  moonPhase?: MoonPhase | null;
  moonIllumination?: number | null;
  precipitationType?: 'none' | 'rain' | 'snow' | 'hail' | 'mixed' | null;
  thunderstormRisk?: boolean | number | null;
  hailRisk?: boolean | number | null;
  snowRisk?: boolean | number | null;
  cloudCover?: number | null;
  severity?: 'none' | 'low' | 'moderate' | 'high' | 'severe' | null;
  temperature?: number | null;
  precipitation?: number | null;
  thunderstorm?: boolean | null;
  windSpeed?: number | null;
  riskLevel?: WeatherVisualRiskLevel | null;
  timeOfDay?:
    | 'preDawn'
    | 'sunrise'
    | 'morning'
    | 'midday'
    | 'goldenHour'
    | 'sunset'
    | 'dusk'
    | 'night'
    | 'dawn'
    | 'day'
    | null;
  systemColorScheme?: WeatherSystemColorScheme;
  freshness?: WeatherVisualFreshness | null;
  sourceConfidence?: number | null;
  latitude?: number | null;
  devPreviewEnabled?: boolean | null;
  devPreviewCondition?: WeatherVisualCondition | null;
};

export type WeatherVisualDecision = {
  assetId: string;
  condition: WeatherVisualCondition;
  reason: string;
  confidence: number;
  fallbackUsed: boolean;
  overlayGradient: string[];
  textColor: string;
  glowColor: string;
  accentColor: string;
  accessibilityLabel: string;
  accessibilityI18nKey: string;
  asset: WeatherVisualAsset;
  visualTheme: ResolvedWeatherVisualTheme;
  devPreview?: boolean;
};
