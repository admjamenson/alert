import React, { memo, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { formatDateTime, formatTime } from '../../utils/dateTimeFormat';

export type RealtimeSeriesPoint = {
  timestamp: string;
  value: number;
};

type RealtimeSeriesChartProps = {
  points: RealtimeSeriesPoint[];
  color: string;
  accentColor?: string;
  gridColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  locale: string;
  timeZone?: string;
  reducedMotion?: boolean;
  metricLabel: string;
  title?: string;
  accessibilityLabel?: string;
  timestampLabel?: string;
  emptyLabel?: string;
  testID?: string;
};

const CHART_HEIGHT = 176;
const PAD_X = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildPath = (coords: Array<{ x: number; y: number }>) => {
  if (coords.length === 0) return '';
  if (coords.length === 1) {
    const p = coords[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  return coords.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
};

const formatMetricValue = (value: number, locale: string) => {
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(Math.round(value));
  }
};

export const RealtimeSeriesChart = memo((props: RealtimeSeriesChartProps) => {
  const {
    points,
    color,
    accentColor,
    gridColor = 'rgba(255,255,255,0.12)',
    textColor = '#FFFFFF',
    mutedTextColor = 'rgba(255,255,255,0.72)',
    locale,
    timeZone,
    metricLabel,
    title,
    accessibilityLabel,
    timestampLabel = 'Timestamp',
    emptyLabel = 'No data',
    testID,
  } = props;

  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
    if (nextWidth !== width) setWidth(nextWidth);
  };

  const safePoints = useMemo(() => {
    return points
      .filter(p => Number.isFinite(Number(p?.value)))
      .map(p => ({ ...p, value: Number(p.value) }));
  }, [points]);

  const selectedPoint =
    safePoints.length === 0
      ? null
      : safePoints[
          clamp(
            selectedIndex ?? safePoints.length - 1,
            0,
            Math.max(0, safePoints.length - 1),
          )
        ];

  const chart = useMemo(() => {
    const innerWidth = Math.max(0, width - PAD_X * 2);
    const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

    if (!width || safePoints.length === 0) {
      return {
        coords: [] as Array<{ x: number; y: number }>,
        path: '',
        yMin: 0,
        yMax: 1,
      };
    }

    const values = safePoints.map(p => p.value);
    let yMin = Math.min(...values);
    let yMax = Math.max(...values);
    if (yMin === yMax) {
      yMin = Math.max(0, yMin - 1);
      yMax = yMax + 1;
    }
    const pad = Math.max(1, (yMax - yMin) * 0.08);
    yMin = Math.max(0, yMin - pad);
    yMax = yMax + pad;

    const coords = safePoints.map((point, index) => {
      const x =
        safePoints.length === 1
          ? PAD_X + innerWidth / 2
          : PAD_X + (index / (safePoints.length - 1)) * innerWidth;
      const yRatio = (point.value - yMin) / Math.max(1e-9, yMax - yMin);
      const y = PAD_TOP + (1 - yRatio) * innerHeight;
      return { x, y };
    });

    return {
      coords,
      path: buildPath(coords),
      yMin,
      yMax,
    };
  }, [safePoints, width]);

  const tickLabels = useMemo(() => {
    if (safePoints.length === 0) return [];
    const indexes = Array.from(
      new Set([
        0,
        Math.floor((safePoints.length - 1) / 2),
        Math.max(0, safePoints.length - 1),
      ]),
    );
    return indexes.map(index => ({
      index,
      label:
        safePoints.length >= 12
          ? formatDateTime(safePoints[index].timestamp, locale, timeZone, {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : formatTime(safePoints[index].timestamp, locale, timeZone),
    }));
  }, [locale, safePoints, timeZone]);

  const onPressChart = (event: any) => {
    if (!width || safePoints.length === 0) return;
    const x = Number(event?.nativeEvent?.locationX);
    if (!Number.isFinite(x)) return;
    const innerWidth = Math.max(1, width - PAD_X * 2);
    const ratio = clamp((x - PAD_X) / innerWidth, 0, 1);
    const next = Math.round(ratio * (safePoints.length - 1));
    setSelectedIndex(next);
  };

  return (
    <View style={styles.container} testID={testID}>
      {title ? (
        <Text style={[styles.title, { color: textColor }]} allowFontScaling maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      ) : null}

      <Pressable
        onPress={onPressChart}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={styles.chartPressable}
      >
        <View onLayout={onLayout} style={styles.chartLayout}>
          {width > 0 ? (
            <Svg width={width} height={CHART_HEIGHT}>
              <Line
                x1={PAD_X}
                y1={PAD_TOP}
                x2={width - PAD_X}
                y2={PAD_TOP}
                stroke={gridColor}
                strokeWidth={1}
              />
              <Line
                x1={PAD_X}
                y1={PAD_TOP + (CHART_HEIGHT - PAD_TOP - PAD_BOTTOM) / 2}
                x2={width - PAD_X}
                y2={PAD_TOP + (CHART_HEIGHT - PAD_TOP - PAD_BOTTOM) / 2}
                stroke={gridColor}
                strokeWidth={1}
              />
              <Line
                x1={PAD_X}
                y1={CHART_HEIGHT - PAD_BOTTOM}
                x2={width - PAD_X}
                y2={CHART_HEIGHT - PAD_BOTTOM}
                stroke={gridColor}
                strokeWidth={1}
              />

              {chart.path ? (
                <Path
                  d={chart.path}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}

              {selectedPoint && chart.coords.length > 0 ? (
                (() => {
                  const idx = clamp(selectedIndex ?? chart.coords.length - 1, 0, chart.coords.length - 1);
                  const p = chart.coords[idx];
                  return (
                    <>
                      <Line
                        x1={p.x}
                        y1={PAD_TOP}
                        x2={p.x}
                        y2={CHART_HEIGHT - PAD_BOTTOM}
                        stroke={gridColor}
                        strokeWidth={1}
                      />
                      <Circle cx={p.x} cy={p.y} r={4.5} fill={accentColor || color} />
                      <Circle cx={p.x} cy={p.y} r={8} fill={accentColor || color} opacity={0.12} />
                    </>
                  );
                })()
              ) : null}
            </Svg>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.metaRow}>
        <View style={styles.metaBlock}>
          <Text style={[styles.metaLabel, { color: mutedTextColor }]} allowFontScaling>
            {metricLabel}
          </Text>
          <Text style={[styles.metaValue, { color: textColor }]} allowFontScaling maxFontSizeMultiplier={1.3}>
            {selectedPoint ? formatMetricValue(selectedPoint.value, locale) : '--'}
          </Text>
        </View>
        <View style={[styles.metaBlock, styles.metaBlockRight]}>
          <Text style={[styles.metaLabel, { color: mutedTextColor }]} allowFontScaling>
            {safePoints.length > 0 ? timestampLabel : emptyLabel}
          </Text>
          <Text
            style={[styles.metaValueSmall, { color: textColor }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            {selectedPoint ? formatDateTime(selectedPoint.timestamp, locale, timeZone) : '--'}
          </Text>
        </View>
      </View>

      <View style={styles.tickRow}>
        {tickLabels.map(tick => (
          <Text
            key={`${tick.index}-${tick.label}`}
            style={[styles.tickText, { color: mutedTextColor }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling
            maxFontSizeMultiplier={1.15}
          >
            {tick.label}
          </Text>
        ))}
      </View>
    </View>
  );
});

RealtimeSeriesChart.displayName = 'RealtimeSeriesChart';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.md,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: ThemeTokens.spacing.sm,
  },
  chartPressable: {
    width: '100%',
  },
  chartLayout: {
    width: '100%',
    height: CHART_HEIGHT,
    justifyContent: 'center',
  },
  metaRow: {
    marginTop: ThemeTokens.spacing.sm,
    flexDirection: 'row',
    gap: ThemeTokens.spacing.md,
    alignItems: 'flex-start',
  },
  metaBlock: {
    flex: 1,
    minWidth: 0,
  },
  metaBlockRight: {
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  metaValue: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  metaValueSmall: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
    maxWidth: 180,
  },
  tickRow: {
    marginTop: ThemeTokens.spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: ThemeTokens.spacing.sm,
  },
  tickText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
  },
});

export default RealtimeSeriesChart;
