import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { SecurityConfidence, SecurityDomain } from '../../services/data/UnifiedIncidentStore';

type Props = {
  total: number;
  confidence: SecurityConfidence;
  domains: Array<{
    domain: SecurityDomain;
    severity: 0 | 1 | 2 | 3;
  }>;
  size?: number;
};

const severityColor = (severity: 0 | 1 | 2 | 3) => {
  if (severity >= 3) return '#EF5350';
  if (severity >= 2) return '#FFB74D';
  if (severity >= 1) return '#66BB6A';
  return 'rgba(255,255,255,0.24)';
};

const confidenceColor = (confidence: SecurityConfidence) => {
  if (confidence === 'high') return '#4DD0E1';
  if (confidence === 'medium') return '#FFD54F';
  return '#BDBDBD';
};

export const CityGlyph: React.FC<Props> = ({
  total,
  confidence,
  domains,
  size = 64,
}) => {
  const safeDomains = domains.slice(0, 6);
  const radius = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 6;
  const circumference = 2 * Math.PI * radius;
  const segmentLength = circumference / 6 - 5;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={strokeWidth}
          fill="rgba(5,10,24,0.62)"
        />
        <G rotation={-90} origin={`${cx}, ${cy}`}>
          {safeDomains.map((item, index) => (
            <Circle
              key={`${item.domain}-${index}`}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={severityColor(item.severity)}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${Math.max(3, segmentLength)} ${circumference}`}
              strokeDashoffset={-index * (circumference / 6)}
            />
          ))}
        </G>
      </Svg>

      <View style={styles.center}>
        <Text style={styles.totalText} numberOfLines={1}>
          {total}
        </Text>
      </View>
      <View
        style={[
          styles.confidenceDot,
          { backgroundColor: confidenceColor(confidence) },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(3,9,23,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  totalText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: ThemeTokens.typography.families.android,
  },
  confidenceDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.34)',
  },
});

export default CityGlyph;
