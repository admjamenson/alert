import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { moonPhaseLabelKey, MoonPhase } from '../../utils/moonPhase';
import {
  mapConditionToIcon,
  NormalizedWeatherKind,
  WeatherOverlayKind,
} from './weatherIconMapper';

type LottieViewProps = {
  source: object;
  autoPlay?: boolean;
  loop?: boolean;
  style?: StyleProp<ViewStyle>;
  onAnimationFailure?: () => void;
};

type LottieComponentType = React.ComponentType<LottieViewProps>;

const resolveLottieView = (): LottieComponentType | null => {
  try {
    const moduleRef = require('lottie-react-native');
    return (moduleRef?.default || moduleRef) as LottieComponentType;
  } catch {
    return null;
  }
};

const LottieView = resolveLottieView();

const LOTTIE_SOURCE_BY_KEY: Partial<Record<string, object>> = {
  clear_day: require('../../assets/weather/lottie/clear_day.json'),
  clear_night: require('../../assets/weather/lottie/clear_night.json'),
  moon_clear: require('../../assets/weather/lottie/clear_night.json'),
  partly_cloudy_day: require('../../assets/weather/lottie/partly_cloudy_day.json'),
  partly_cloudy_night: require('../../assets/weather/lottie/partly_cloudy_night.json'),
  moon_cloudy: require('../../assets/weather/lottie/partly_cloudy_night.json'),
  cloudy_day: require('../../assets/weather/lottie/cloudy_soft.json'),
  cloudy_night: require('../../assets/weather/lottie/cloudy_soft.json'),
  rain_day: require('../../assets/weather/lottie/rain_soft.json'),
  rain_night: require('../../assets/weather/lottie/rain_soft.json'),
  storm_day: require('../../assets/weather/lottie/storm_soft.json'),
  storm_night: require('../../assets/weather/lottie/storm_soft.json'),
  snow_day: require('../../assets/weather/lottie/snow_soft.json'),
  snow_night: require('../../assets/weather/lottie/snow_soft.json'),
  fog_day: require('../../assets/weather/lottie/fog_soft.json'),
  fog_night: require('../../assets/weather/lottie/fog_soft.json'),
  wind_day: require('../../assets/weather/lottie/wind_soft.json'),
  wind_night: require('../../assets/weather/lottie/wind_soft.json'),
  extreme_day: require('../../assets/weather/lottie/storm_soft.json'),
  extreme_night: require('../../assets/weather/lottie/storm_soft.json'),
};

const shouldEnableAnimatedWeatherIcons = (): boolean => {
  const globalFlags = (globalThis as { __ALERT_FEATURE_FLAGS__?: Record<string, unknown> })
    .__ALERT_FEATURE_FLAGS__;
  if (globalFlags && typeof globalFlags.animatedWeatherIconsEnabled === 'boolean') {
    return globalFlags.animatedWeatherIconsEnabled;
  }
  return true;
};

const shouldUseBundledLottieWeatherIcons = (): boolean => {
  const globalFlags = (globalThis as { __ALERT_FEATURE_FLAGS__?: Record<string, unknown> })
    .__ALERT_FEATURE_FLAGS__;
  if (globalFlags && typeof globalFlags.weatherIconsUseLottie === 'boolean') {
    return globalFlags.weatherIconsUseLottie;
  }
  return false;
};

type IconPalette = {
  cloud: string;
  cloudShade: string;
  cloudLow: string;
  sun: string;
  moon: string;
  moonDark: string;
  moonStroke: string;
  precip: string;
  fog: string;
  wind: string;
  lightning: string;
};

const getIconPalette = (kind: NormalizedWeatherKind, isDay: boolean): IconPalette => {
  const moonFill = ThemeTokens.WeatherIcon.moonFill || '#F2EBDD';
  const moonShade = ThemeTokens.WeatherIcon.moonShade || '#CFC8BC';
  const moonStroke = ThemeTokens.WeatherIcon.moonStroke || '#FFF8EA';
  const base: IconPalette = isDay
    ? {
        cloud: '#FFFDFC',
        cloudShade: '#E5DEDE',
        cloudLow: '#CFC4C4',
        sun: '#F3C85D',
        moon: moonFill,
        moonDark: moonShade,
        moonStroke,
        precip: '#F5F0F0',
        fog: '#E8E1E1',
        wind: '#EFE8E8',
        lightning: '#FFD76A',
      }
    : {
        cloud: ThemeTokens.WeatherIcon.cloudFillNight || '#C6CEDB',
        cloudShade: ThemeTokens.WeatherIcon.cloudShadeNight || '#8E9AAE',
        cloudLow: ThemeTokens.WeatherIcon.cloudLowNight || '#72839B',
        sun: '#F0C96A',
        moon: moonFill,
        moonDark: moonShade,
        moonStroke,
        precip: '#F0E9E9',
        fog: '#D9D0D0',
        wind: '#E7DEDE',
        lightning: '#FFD978',
      };

  if (!isDay && (kind === 'rain' || kind === 'storm' || kind === 'extreme' || kind === 'hail')) {
    return {
      ...base,
      cloud: ThemeTokens.WeatherIcon.cloudRainNight || '#8A95AB',
      cloudShade: ThemeTokens.WeatherIcon.cloudRainShadeNight || '#5F6D86',
      cloudLow: ThemeTokens.WeatherIcon.cloudRainLowNight || '#4E5E78',
      precip: '#E7DCDD',
    };
  }

  if (kind === 'storm' || kind === 'extreme') {
    return {
      ...base,
      cloud: '#F2EAEA',
      cloudShade: '#C8BABC',
      cloudLow: '#8C7177',
      precip: '#F0E1E1',
    };
  }
  if (kind === 'fog') {
    return {
      ...base,
      cloud: '#F2ECEC',
      cloudShade: '#D7CDCD',
      fog: '#EAE1E1',
    };
  }
  return base;
};

const moonPhaseVisual: Record<MoonPhase, { rxScale: number; offsetRatio: number }> = {
  NEW: { rxScale: 0, offsetRatio: 0 },
  WAXING_CRESCENT: { rxScale: 0.46, offsetRatio: 0.55 },
  FIRST_QUARTER: { rxScale: 1.0, offsetRatio: 0.52 },
  WAXING_GIBBOUS: { rxScale: 1.36, offsetRatio: 0.22 },
  FULL: { rxScale: 2.0, offsetRatio: 0 },
  WANING_GIBBOUS: { rxScale: 1.36, offsetRatio: 0.22 },
  LAST_QUARTER: { rxScale: 1.0, offsetRatio: 0.52 },
  WANING_CRESCENT: { rxScale: 0.46, offsetRatio: 0.55 },
};

const isWaxingPhase = (phase: MoonPhase): boolean =>
  phase === 'WAXING_CRESCENT' || phase === 'FIRST_QUARTER' || phase === 'WAXING_GIBBOUS';

const getLitSideIsRight = (phase: MoonPhase, hemisphere: 'north' | 'south'): boolean => {
  if (phase === 'FULL' || phase === 'NEW') return true;
  const waxing = isWaxingPhase(phase);
  return hemisphere === 'south' ? waxing : !waxing;
};

const AnimatedGlyph = memo(
  ({
    kind,
    isDay,
    size,
    reducedMotion,
    moonPhase,
    overlayKind,
    hemisphere,
    renderMode = 'default',
  }: {
    kind: NormalizedWeatherKind;
    isDay: boolean;
    size: number;
    reducedMotion: boolean;
    moonPhase?: MoonPhase;
    overlayKind?: WeatherOverlayKind;
    hemisphere?: 'north' | 'south';
    renderMode?: 'default' | 'hero';
  }) => {
    const fallProgress = useRef(new Animated.Value(0)).current;
    const lightningOpacity = useRef(new Animated.Value(0)).current;
    const moonClipIdRef = useRef(`moon-clip-${Math.random().toString(36).slice(2, 10)}`);
    const sunGradientIdRef = useRef(`sun-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const sunGlowGradientIdRef = useRef(`sun-glow-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const cloudGradientIdRef = useRef(`cloud-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const cloudShadowGradientIdRef = useRef(`cloud-shadow-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const groundShadowGradientIdRef = useRef(`ground-shadow-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const moonGradientIdRef = useRef(`moon-gradient-${Math.random().toString(36).slice(2, 10)}`);
    const motionAmplitude = Math.max(2, ThemeTokens.WeatherIcon.motionAmplitude);
    const shadowOpacity = Math.min(0.24, ThemeTokens.WeatherIcon.shadowOpacity);
    const palette = useMemo(() => getIconPalette(kind, isDay), [kind, isDay]);
    const safeMoonPhase = moonPhase || 'WAXING_CRESCENT';
    const safeHemisphere = hemisphere || 'south';
    const heroMode = renderMode === 'hero';
    const nightOverlayScale = ThemeTokens.WeatherIcon.overlayScaleNight ?? 0.5;
    const nightOverlayOffset = ThemeTokens.WeatherIcon.overlayOffsetNight || { x: 26, y: 28 };
    const moonStrokeOpacity = ThemeTokens.WeatherIcon.moonStrokeOpacity ?? 0.72;
    const newMoonOpacity = ThemeTokens.WeatherIcon.newMoonOpacity ?? 0.1;

    const resolvedOverlay: WeatherOverlayKind = !isDay
      ? overlayKind || (kind === 'clear' ? 'none' : 'cloud')
      : kind === 'rain'
        ? 'rain'
        : kind === 'storm' || kind === 'extreme'
          ? 'storm'
          : kind === 'snow'
            ? 'snow'
            : kind === 'hail'
              ? 'hail'
              : kind === 'clear'
                ? 'none'
                : 'cloud';

    const showSun = isDay && (kind === 'clear' || kind === 'partlyCloudy');
    const showMoon = !isDay;
    const showCloud = resolvedOverlay !== 'none';
    const showRain = resolvedOverlay === 'rain' || resolvedOverlay === 'storm';
    const showSnow = resolvedOverlay === 'snow';
    const showHail = resolvedOverlay === 'hail';
    const showFog = kind === 'fog' && resolvedOverlay === 'cloud';
    const showWind = kind === 'wind';
    const showStorm = resolvedOverlay === 'storm';
    const showClearSunrise = kind === 'clear' && isDay;
    const compactCloudForMoon = showMoon && showCloud;
    const compactPrecipTransform = compactCloudForMoon
      ? 'translate(-20 9) scale(0.68)'
      : undefined;
    const compactSnowTransform = compactCloudForMoon
      ? 'translate(-19 8) scale(0.7)'
      : undefined;
    const compactLightningTransform = compactCloudForMoon
      ? 'translate(-19 10) scale(0.66)'
      : undefined;
    const shouldAnimatePrecipitation = !reducedMotion && (showRain || showSnow || showHail);
    const shouldAnimateStormLightning = !reducedMotion && showStorm;
    const moonCenterX = compactCloudForMoon ? 67 : 69;
    const moonCenterY = compactCloudForMoon ? 29 : 31;
    const moonRadius = compactCloudForMoon ? 19 : 19;
    const phaseVisual = moonPhaseVisual[safeMoonPhase];
    const litSideRight = getLitSideIsRight(safeMoonPhase, safeHemisphere);
    const phaseOffset = moonRadius * phaseVisual.offsetRatio * (litSideRight ? 1 : -1);
    const phaseRx = moonRadius * phaseVisual.rxScale;

    useEffect(() => {
      fallProgress.stopAnimation();
      fallProgress.setValue(0);

      if (!shouldAnimatePrecipitation) {
        return;
      }

      const fallLoop = Animated.loop(
        Animated.timing(fallProgress, {
          toValue: 1,
          duration: showRain ? 980 : 1280,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      fallLoop.start();

      return () => {
        fallLoop.stop();
      };
    }, [fallProgress, shouldAnimatePrecipitation, showRain]);

    useEffect(() => {
      lightningOpacity.stopAnimation();
      lightningOpacity.setValue(0);

      if (!shouldAnimateStormLightning) {
        return;
      }

      const lightningLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(720),
          Animated.timing(lightningOpacity, {
            toValue: 1,
            duration: 80,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(lightningOpacity, {
            toValue: 0,
            duration: 140,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(60),
        ]),
      );
      lightningLoop.start();

      return () => {
        lightningLoop.stop();
      };
    }, [lightningOpacity, shouldAnimateStormLightning]);

    const rainTranslateY = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, motionAmplitude + 11],
    });
    const rainTranslateX = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1.8],
    });
    const rainTranslateYAlt = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [3, motionAmplitude + 12],
    });
    const rainTranslateXAlt = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1.2],
    });
    const rainTranslateYThird = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, motionAmplitude + 8],
    });
    const rainTranslateXThird = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.9],
    });
    const rainOpacityPrimary = fallProgress.interpolate({
      inputRange: [0, 0.15, 0.85, 1],
      outputRange: [0.15, 0.95, 0.95, 0.15],
    });
    const rainOpacitySecondary = fallProgress.interpolate({
      inputRange: [0, 0.2, 0.9, 1],
      outputRange: [0.05, 0.65, 0.65, 0.05],
    });
    const rainOpacityTertiary = fallProgress.interpolate({
      inputRange: [0, 0.25, 0.9, 1],
      outputRange: [0.02, 0.45, 0.45, 0.02],
    });
    const snowTranslateY = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, motionAmplitude + 5],
    });
    const snowTranslateX = fallProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1.6],
    });

    return (
      <View
        style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}
      >
        {showClearSunrise ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <Defs>
                <RadialGradient id={sunGradientIdRef.current} cx="34%" cy="28%" r="72%">
                  <Stop offset="0%" stopColor="#FFF6D8" />
                  <Stop offset="48%" stopColor={palette.sun} />
                  <Stop offset="100%" stopColor="#D8821D" />
                </RadialGradient>
                <RadialGradient id={sunGlowGradientIdRef.current} cx="38%" cy="30%" r="78%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </RadialGradient>
                <SvgLinearGradient id={cloudGradientIdRef.current} x1="10%" y1="18%" x2="74%" y2="96%">
                  <Stop offset="0%" stopColor="#FFFDFC" />
                  <Stop offset="44%" stopColor={palette.cloud} />
                  <Stop offset="100%" stopColor={palette.cloudShade} />
                </SvgLinearGradient>
                <SvgLinearGradient id={cloudShadowGradientIdRef.current} x1="50%" y1="58%" x2="52%" y2="100%">
                  <Stop offset="0%" stopColor={palette.cloudShade} stopOpacity="0.14" />
                  <Stop offset="100%" stopColor={palette.cloudLow} stopOpacity="0.75" />
                </SvgLinearGradient>
              </Defs>
              <Circle cx="50" cy="58" r="17" fill={palette.sun} />
              <Path d="M18 60h64" stroke={palette.cloud} strokeWidth="6" strokeLinecap="round" />
              <Path d="M50 34v10" stroke={palette.cloud} strokeWidth="5" strokeLinecap="round" />
            </Svg>
          </View>
        ) : null}

        {showSun ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <Defs>
                <RadialGradient id={sunGradientIdRef.current} cx="34%" cy="28%" r="72%">
                  <Stop offset="0%" stopColor="#FFF6D8" />
                  <Stop offset="44%" stopColor={palette.sun} />
                  <Stop offset="100%" stopColor="#D8821D" />
                </RadialGradient>
                <RadialGradient id={sunGlowGradientIdRef.current} cx="38%" cy="30%" r="78%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.78" />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle
                cx={heroMode ? '66' : '67'}
                cy={heroMode ? '31' : '33'}
                r={heroMode ? '20' : '16'}
                fill={`url(#${sunGradientIdRef.current})`}
              />
              <Circle
                cx={heroMode ? '59' : '62'}
                cy={heroMode ? '24' : '28'}
                r={heroMode ? '9' : '5'}
                fill={`url(#${sunGlowGradientIdRef.current})`}
                opacity={heroMode ? 0.92 : 0.4}
              />
              {heroMode ? (
                <Circle
                  cx="67"
                  cy="32"
                  r="23"
                  fill="none"
                  stroke="#F1D5A3"
                  strokeOpacity="0.24"
                  strokeWidth="1.5"
                />
              ) : null}
            </Svg>
          </View>
        ) : null}

        {showMoon ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <Defs>
                <ClipPath id={moonClipIdRef.current}>
                  <Circle cx={moonCenterX} cy={moonCenterY} r={moonRadius} />
                </ClipPath>
                <RadialGradient id={moonGradientIdRef.current} cx="34%" cy="28%" r="74%">
                  <Stop offset="0%" stopColor="#FFF9F0" />
                  <Stop offset="44%" stopColor={palette.moon} />
                  <Stop offset="100%" stopColor={palette.moonDark} />
                </RadialGradient>
              </Defs>
              <Circle
                cx={moonCenterX}
                cy={moonCenterY}
                r={moonRadius}
                fill={palette.moonDark}
                fillOpacity={safeMoonPhase === 'NEW' ? newMoonOpacity : 1}
              />
              {safeMoonPhase !== 'NEW' ? (
                <Ellipse
                  cx={moonCenterX + phaseOffset}
                  cy={moonCenterY}
                  rx={phaseRx}
                  ry={moonRadius}
                  fill={`url(#${moonGradientIdRef.current})`}
                  clipPath={`url(#${moonClipIdRef.current})`}
                />
              ) : null}
              <Circle
                cx={moonCenterX}
                cy={moonCenterY}
                r={moonRadius}
                fill="none"
                stroke={palette.moonStroke}
                strokeOpacity={safeMoonPhase === 'NEW' ? Math.max(0.28, moonStrokeOpacity - 0.3) : moonStrokeOpacity}
                strokeWidth={1.2}
              />
            </Svg>
          </View>
        ) : null}

        {showCloud ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <Defs>
                <SvgLinearGradient id={cloudGradientIdRef.current} x1="16%" y1="12%" x2="78%" y2="100%">
                  <Stop offset="0%" stopColor={heroMode ? '#FFFDF9' : palette.cloud} />
                  <Stop offset="46%" stopColor={palette.cloud} />
                  <Stop offset="100%" stopColor={palette.cloudShade} />
                </SvgLinearGradient>
                <SvgLinearGradient id={cloudShadowGradientIdRef.current} x1="50%" y1="56%" x2="52%" y2="100%">
                  <Stop
                    offset="0%"
                    stopColor={palette.cloudShade}
                    stopOpacity={heroMode ? '0.18' : '0.14'}
                  />
                  <Stop
                    offset="100%"
                    stopColor={palette.cloudLow}
                    stopOpacity={heroMode ? '0.82' : '0.75'}
                  />
                </SvgLinearGradient>
                <RadialGradient id={groundShadowGradientIdRef.current} cx="50%" cy="50%" r="55%">
                  <Stop offset="0%" stopColor={palette.cloudLow} stopOpacity={heroMode ? '0.34' : '0.24'} />
                  <Stop offset="100%" stopColor={palette.cloudLow} stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <G
                transform={
                  compactCloudForMoon
                    ? `translate(${nightOverlayOffset.x} ${nightOverlayOffset.y}) scale(${nightOverlayScale})`
                    : undefined
                }
              >
                <Ellipse
                  cx="48"
                  cy={heroMode ? '74' : '70'}
                  rx={heroMode ? '34' : '30'}
                  ry={heroMode ? '12' : '10'}
                  fill={`url(#${groundShadowGradientIdRef.current})`}
                  opacity={heroMode ? 1 : shadowOpacity}
                />
                <G>
                  <Path
                    d="M21 70h52c11 0 19-7 19-17s-8-17-19-17c-2.7 0-5.2.5-7.5 1.5C61 30 54 25 45 25c-11.6 0-21 9.4-21 21v1.1C15 48.6 9 55 9 63c0 4.2 1.7 8 4.4 10.8z"
                    fill={`url(#${cloudGradientIdRef.current})`}
                  />
                  <Path
                    d="M22 70h50c9.3 0 15.9-3.7 19.4-11.2-.4 7.2-7.9 13.8-18.4 13.8H21.7C12.4 72.6 8 67 8.5 60.5c1.3 5.8 6.5 9.5 13.5 9.5z"
                    fill={`url(#${cloudShadowGradientIdRef.current})`}
                    opacity={heroMode ? 0.92 : 0.65}
                  />
                  {heroMode ? (
                    <>
                      <Ellipse cx="35" cy="39" rx="15" ry="11" fill="#FFFFFF" opacity={0.18} />
                      <Ellipse cx="57" cy="48" rx="18" ry="12" fill="#FFFFFF" opacity={0.12} />
                    </>
                  ) : null}
                </G>
              </G>
            </Svg>
          </View>
        ) : null}

        {showRain ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size, opacity: rainOpacityPrimary },
              { transform: [{ translateY: rainTranslateY }, { translateX: rainTranslateX }] },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G
                stroke={palette.precip}
                strokeWidth="3"
                strokeLinecap="round"
                opacity={0.98}
                transform={compactPrecipTransform}
              >
                <Path d="M24 62l-4.8 5.8" />
                <Path d="M35 65l-4.8 5.8" />
                <Path d="M46 63l-4.8 5.8" />
                <Path d="M57 66l-4.8 5.8" />
                <Path d="M68 64l-4.8 5.8" />
                <Path d="M79 67l-4.8 5.8" />
              </G>
            </Svg>
          </Animated.View>
        ) : null}

        {showRain ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size, opacity: rainOpacitySecondary },
              { transform: [{ translateY: rainTranslateYAlt }, { translateX: rainTranslateXAlt }] },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G
                stroke={palette.precip}
                strokeWidth="2.3"
                strokeLinecap="round"
                opacity={0.78}
                transform={compactPrecipTransform}
              >
                <Path d="M29 69l-3.7 4.6" />
                <Path d="M41 72l-3.7 4.6" />
                <Path d="M53 70l-3.7 4.6" />
                <Path d="M65 73l-3.7 4.6" />
                <Path d="M77 71l-3.7 4.6" />
              </G>
            </Svg>
          </Animated.View>
        ) : null}

        {showRain ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size, opacity: rainOpacityTertiary },
              {
                transform: [
                  { translateY: rainTranslateYThird },
                  { translateX: rainTranslateXThird },
                ],
              },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G
                stroke={palette.precip}
                strokeWidth="1.9"
                strokeLinecap="round"
                opacity={0.72}
                transform={compactPrecipTransform}
              >
                <Path d="M26 76l-3.1 3.9" />
                <Path d="M38 78l-3.1 3.9" />
                <Path d="M50 76l-3.1 3.9" />
                <Path d="M62 79l-3.1 3.9" />
                <Path d="M74 77l-3.1 3.9" />
              </G>
            </Svg>
          </Animated.View>
        ) : null}

        {showSnow ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size },
              { transform: [{ translateY: snowTranslateY }, { translateX: snowTranslateX }] },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G transform={compactSnowTransform}>
                <Circle cx="34" cy="74" r="3.3" fill={palette.precip} />
                <Circle cx="50" cy="80" r="3.3" fill={palette.precip} />
                <Circle cx="66" cy="74" r="3.3" fill={palette.precip} />
              </G>
            </Svg>
          </Animated.View>
        ) : null}

        {showFog ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G stroke={palette.fog} strokeWidth="4.5" strokeLinecap="round">
                <Path d="M20 66h56c6 0 10-3 10-7 0-5-4-8-9-8-4 0-7 2-8.7 5" fill="none" />
                <Path d="M26 79h46c5 0 8 2.8 8 6.5s-3 6.5-8 6.5c-3 0-5.4-1-7-3" fill="none" />
              </G>
            </Svg>
          </View>
        ) : null}

        {showHail ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size, opacity: rainOpacitySecondary },
              { transform: [{ translateY: rainTranslateYAlt }, { translateX: rainTranslateXAlt }] },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G transform={compactPrecipTransform}>
                <Circle cx="30" cy="71" r="2.7" fill={palette.precip} />
                <Circle cx="43" cy="74" r="2.7" fill={palette.precip} />
                <Circle cx="56" cy="72" r="2.7" fill={palette.precip} />
                <Circle cx="69" cy="75" r="2.7" fill={palette.precip} />
              </G>
            </Svg>
          </Animated.View>
        ) : null}

        {showWind ? (
          <View style={{ position: 'absolute', width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G stroke={palette.wind} strokeWidth="4.2" strokeLinecap="round">
                <Path d="M18 46h46c7 0 11-4.8 11-9 0-5-4-9-9.5-9-4 0-7.5 2-9.5 5" fill="none" />
                <Path d="M20 60h55c6 0 10 3.7 10 8s-4 8-10 8c-4 0-7.2-1.7-9-4.8" fill="none" />
              </G>
            </Svg>
          </View>
        ) : null}

        {showStorm ? (
          <Animated.View
            style={[
              { position: 'absolute', width: size, height: size, opacity: lightningOpacity },
            ]}
          >
            <Svg width={size} height={size} viewBox="0 0 100 100">
              <G transform={compactLightningTransform}>
                <Path d="M50 59l-8 12h7l-5 16 17-21h-8l6-7z" fill={palette.lightning} />
              </G>
            </Svg>
          </Animated.View>
        ) : null}
      </View>
    );
  },
);

AnimatedGlyph.displayName = 'AnimatedGlyph';

type WeatherAnimatedIconProps = {
  conditionCode: number | string | null | undefined;
  isDay: boolean;
  latitude?: number | null;
  size?: number;
  reducedMotion?: boolean;
  renderMode?: 'default' | 'hero';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

export const WeatherAnimatedIcon = memo(
  ({
    conditionCode,
    isDay,
    latitude,
    size = ThemeTokens.WeatherIcon.sizes.home,
    reducedMotion = false,
    renderMode = 'default',
    style,
    accessibilityLabel,
    testID,
  }: WeatherAnimatedIconProps) => {
    const { t } = useTranslation();
    const [isSystemReducedMotion, setSystemReducedMotion] = useState(false);
    const [isLowPowerMode, setLowPowerMode] = useState(false);
    const [isLowPerformanceDevice, setLowPerformanceDevice] = useState(false);
    const [lottieFailed, setLottieFailed] = useState(false);

    useEffect(() => {
      let active = true;
      AccessibilityInfo.isReduceMotionEnabled?.()
        .then(enabled => {
          if (active) setSystemReducedMotion(Boolean(enabled));
        })
        .catch(() => {
          if (active) setSystemReducedMotion(false);
        });

      const subscription = AccessibilityInfo.addEventListener?.(
        'reduceMotionChanged',
        enabled => {
          if (active) setSystemReducedMotion(Boolean(enabled));
        },
      );

      return () => {
        active = false;
        subscription?.remove?.();
      };
    }, []);

    useEffect(() => {
      let active = true;
      DeviceInfo.getPowerState()
        .then(state => {
          if (active) setLowPowerMode(Boolean(state?.lowPowerMode));
        })
        .catch(() => {
          if (active) setLowPowerMode(false);
        });

      DeviceInfo.getTotalMemory()
        .then(totalMemory => {
          if (!active) return;
          const memoryThreshold = 2 * 1024 * 1024 * 1024; // 2GB
          setLowPerformanceDevice(Number(totalMemory) > 0 && Number(totalMemory) < memoryThreshold);
        })
        .catch(() => {
          if (active) setLowPerformanceDevice(false);
        });

      return () => {
        active = false;
      };
    }, []);

    const variant = useMemo(
      () =>
        mapConditionToIcon(conditionCode, isDay, {
          date: new Date(),
          latitude,
        }),
      [conditionCode, isDay, latitude],
    );

    const motionBlocked =
      reducedMotion ||
      isSystemReducedMotion ||
      isLowPowerMode ||
      isLowPerformanceDevice ||
      !shouldEnableAnimatedWeatherIcons();

    const lottieSource = !motionBlocked ? LOTTIE_SOURCE_BY_KEY[variant.lottieKey] : undefined;
    const shouldUseLottie =
      renderMode !== 'hero' &&
      shouldUseBundledLottieWeatherIcons() &&
      Boolean(LottieView && lottieSource && !lottieFailed) &&
      !(!isDay && variant.moonPhase);

    useEffect(() => {
      setLottieFailed(false);
    }, [variant.lottieKey]);

    const defaultA11yLabel = useMemo(() => {
      if (!isDay && variant.moonPhase) {
        const phaseLabel =
          variant.moonPhase === 'NEW'
            ? t('moon_phase_new_invisible', { defaultValue: 'New moon (not visible)' })
            : t(moonPhaseLabelKey(variant.moonPhase));
        const conditionLabel = t(variant.a11yLabelKey);
        return t('weather_icon_moon_phase_condition', {
          defaultValue: '{{phase}}, {{condition}}',
          phase: phaseLabel,
          condition: conditionLabel,
        });
      }
      return t(variant.a11yLabelKey);
    }, [isDay, t, variant.a11yLabelKey, variant.moonPhase]);

    const resolvedA11yLabel = accessibilityLabel || defaultA11yLabel;
    const containerStyle: StyleProp<ViewStyle> = [
      {
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      },
      style,
    ];

    if (motionBlocked) {
      return (
        <View
          testID={testID}
          accessible
          accessibilityRole="image"
          accessibilityLabel={resolvedA11yLabel}
          style={containerStyle}
        >
          <AnimatedGlyph
            kind={variant.kind}
            isDay={isDay}
            size={size}
            reducedMotion
            moonPhase={variant.moonPhase}
            overlayKind={variant.overlayKind}
            hemisphere={variant.hemisphere}
            renderMode={renderMode}
          />
        </View>
      );
    }

    if (shouldUseLottie && LottieView && lottieSource) {
      return (
        <View
          testID={testID}
          accessible
          accessibilityRole="image"
          accessibilityLabel={resolvedA11yLabel}
          style={containerStyle}
        >
          <LottieView
            source={lottieSource}
            autoPlay
            loop
            style={{ width: size, height: size }}
            onAnimationFailure={() => setLottieFailed(true)}
          />
        </View>
      );
    }

    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={resolvedA11yLabel}
        style={containerStyle}
      >
        <AnimatedGlyph
          kind={variant.kind}
          isDay={isDay}
          size={size}
          reducedMotion={motionBlocked}
          moonPhase={variant.moonPhase}
          overlayKind={variant.overlayKind}
          hemisphere={variant.hemisphere}
          renderMode={renderMode}
        />
      </View>
    );
  },
);

WeatherAnimatedIcon.displayName = 'WeatherAnimatedIcon';
