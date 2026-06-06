import React, {memo} from 'react';
import {StyleSheet, View} from 'react-native';

import type {WeatherVisualDecision} from '../../domain/weather/WeatherVisualModels';

type WeatherGlowIntensity = 'subtle' | 'medium' | 'dramatic';

type WeatherGlowOverlayProps = {
  decision: WeatherVisualDecision;
  intensity?: WeatherGlowIntensity;
};

const opacityByIntensity: Record<WeatherGlowIntensity, number> = {
  subtle: 0.14,
  medium: 0.24,
  dramatic: 0.34,
};

export const WeatherGlowOverlay = memo<WeatherGlowOverlayProps>(
  ({decision, intensity = 'subtle'}) => {
    const opacity = opacityByIntensity[intensity];

    return (
      <View
        testID="weather-glow-overlay"
        pointerEvents="none"
        accessible={false}
        style={StyleSheet.absoluteFill}>
        <View
          style={[
            styles.primaryGlow,
            {backgroundColor: decision.glowColor, opacity},
          ]}
        />
        <View
          style={[
            styles.accentGlow,
            {backgroundColor: decision.accentColor, opacity: opacity * 0.8},
          ]}
        />
      </View>
    );
  },
);

WeatherGlowOverlay.displayName = 'WeatherGlowOverlay';

const styles = StyleSheet.create({
  primaryGlow: {
    position: 'absolute',
    top: -34,
    right: -18,
    width: 136,
    height: 136,
    borderRadius: 68,
  },
  accentGlow: {
    position: 'absolute',
    left: -30,
    bottom: -42,
    width: 116,
    height: 116,
    borderRadius: 58,
  },
});
