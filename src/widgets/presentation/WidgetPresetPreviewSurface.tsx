import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { WidgetPreviewModel } from '../application/queries/GetWidgetPreviewModelQuery';
import { WidgetPreviewSize, WidgetPreviewVariant } from '../domain/WidgetPreviewSpec';

type Props = {
  variant: WidgetPreviewVariant;
  format: WidgetPreviewSize;
  model: WidgetPreviewModel;
  selected: boolean;
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const levelToTier = (level: number): 'low' | 'medium' | 'high' => {
  if (level >= 70) return 'high';
  if (level >= 42) return 'medium';
  return 'low';
};

const parseCommuteMetric = (metric: string) => {
  const normalized = String(metric || '')
    .replace(/\s*\(\+\d+\)$/, '')
    .trim();
  const hourMinuteMatch = normalized.match(/^(\d+h)(\d{1,2})$/i);
  if (hourMinuteMatch) {
    return { main: hourMinuteMatch[1], accent: hourMinuteMatch[2] };
  }
  const hourOnlyMatch = normalized.match(/^(\d+h)$/i);
  if (hourOnlyMatch) {
    return { main: hourOnlyMatch[1], accent: '' };
  }
  const minuteMatch = normalized.match(/^(\d+)(m)$/i);
  if (minuteMatch) {
    return { main: minuteMatch[1], accent: minuteMatch[2] };
  }
  return { main: normalized || '--', accent: '' };
};

const isGenericStatusCopy = (value?: string) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('snapshot') ||
    normalized.includes('verified') ||
    normalized.includes('confianca') ||
    normalized.includes('confidence') ||
    normalized.includes('updated') ||
    normalized.includes('atualizado') ||
    normalized.includes('cobertura') ||
    normalized.includes('coverage')
  );
};

const accentColorForTier = (tier: 'low' | 'medium' | 'high') => {
  if (tier === 'high') return '#F45A43';
  if (tier === 'medium') return '#F4C542';
  return '#57D26E';
};

const topIconForVariant = (variant: WidgetPreviewVariant) => {
  if (variant === 'risk_now_preview') return 'alert';
  return null;
};

const statusPalette = (tone: WidgetPreviewModel['statusBadge']['tone']) => {
  if (tone === 'high') {
    return {
      colors: ['rgba(244,90,67,0.34)', 'rgba(244,90,67,0.20)'],
      borderColor: 'rgba(244,90,67,0.54)',
      textColor: '#F45A43',
    };
  }
  if (tone === 'moderate') {
    return {
      colors: ['rgba(244,197,66,0.30)', 'rgba(244,90,67,0.22)'],
      borderColor: 'rgba(240,138,53,0.62)',
      textColor: '#F4C542',
    };
  }
  if (tone === 'attention') {
    return {
      colors: ['rgba(244,197,66,0.28)', 'rgba(244,197,66,0.16)'],
      borderColor: 'rgba(244,197,66,0.52)',
      textColor: '#F4C542',
    };
  }
  return {
    colors: ['rgba(87,210,110,0.28)', 'rgba(87,210,110,0.16)'],
    borderColor: 'rgba(87,210,110,0.48)',
    textColor: '#57D26E',
  };
};

const StatusPill = ({ label, tone }: WidgetPreviewModel['statusBadge']) => {
  const palette = statusPalette(tone);
  return (
    <LinearGradient
      colors={palette.colors}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={[styles.statusPill, { borderColor: palette.borderColor }]}
    >
      <Text style={[styles.statusPillText, { color: palette.textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </LinearGradient>
  );
};

const ScoreRing = ({ level, size = 116, fontSize = 52, strokeWidth = 10 }: { level: number; size?: number; fontSize?: number; strokeWidth?: number }) => {
  const tier = levelToTier(level);
  const ringColor = accentColorForTier(tier);
  return (
    <View style={[styles.scoreRingFrame, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor, borderWidth: strokeWidth }]}>
      <View style={[styles.scoreRingCore, { width: size - strokeWidth * 3, height: size - strokeWidth * 3, borderRadius: (size - strokeWidth * 3) / 2 }]}>
        <Text style={[styles.scoreRingMetric, { fontSize, lineHeight: fontSize + 4 }]}>{Math.round(level)}</Text>
      </View>
    </View>
  );
};

export const WidgetPresetPreviewSurface = ({ variant, format, model, selected }: Props) => {
  const { t } = useTranslation();
  const previewHeight =
    format === '4x1'
      ? ThemeTokens.Widgets.preview4x1Height
      : format === '2x2'
        ? ThemeTokens.Widgets.preview2x2Size
        : ThemeTokens.Widgets.preview4x2Height;
  const previewWidth = format === '2x2' ? ThemeTokens.Widgets.preview2x2Size : '100%';
  const commuteMetric = parseCommuteMetric(model.metric);
  const scoreLevel = Math.max(0, Math.min(100, Math.round(Number(model.level || 0))));
  const accentColor = accentColorForTier(levelToTier(scoreLevel));
  const displayBadge = model.statusBadge;
  const tickerLine = model.subtitle || displayBadge.label;
  const citySubtitle = isGenericStatusCopy(model.subtitle) ? '' : model.subtitle;
  const commuteSubtitle = isGenericStatusCopy(model.subtitle) ? '' : model.subtitle;
  const topIcon = topIconForVariant(variant);
  const showDefaultBrandRow = variant !== 'alerts_ticker_preview';

  return (
    <View
      style={[
        styles.preview,
        {
          width: previewWidth,
          height: previewHeight,
          borderColor: selected ? '#2E75FF' : ThemeTokens.Widgets.previewStroke,
          alignSelf: format === '2x2' ? 'center' : 'stretch',
        },
      ]}
    >
      <LinearGradient
        colors={['#0B1222', '#0E1B35', '#0A1020']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.previewBackground}
      />
      {showDefaultBrandRow ? (
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} />
            <Text style={styles.brandText}>{t('widgets_picker_app_name')}</Text>
          </View>
          {topIcon ? <Icon name={topIcon} size={22} color="#F4F7FF" /> : <View style={styles.topIconSpacer} />}
        </View>
      ) : null}

      {variant === 'risk_now_preview' ? (
        <View style={styles.riskNowWrap}>
          <Text style={styles.riskTitle} numberOfLines={1}>
            {model.title}
          </Text>
          <ScoreRing level={scoreLevel} size={132} fontSize={56} strokeWidth={9} />
          <StatusPill {...displayBadge} />
        </View>
      ) : null}

      {variant === 'commute_preview' ? (
        <View style={styles.commuteWrap}>
          <Text style={styles.commuteRoute} numberOfLines={1}>
            {model.title}
          </Text>
          <View style={styles.commuteMetricRow}>
            <Text style={styles.commuteMetricMain} numberOfLines={1}>
              {commuteMetric.main}
            </Text>
            {commuteMetric.accent ? (
              <Text style={styles.commuteMetricAccent} numberOfLines={1}>
                {commuteMetric.accent}
              </Text>
            ) : null}
          </View>
          {commuteSubtitle ? (
            <Text style={styles.commuteSubtitle} numberOfLines={1}>
              {commuteSubtitle}
            </Text>
          ) : null}
          <Icon name="sign-direction" size={38} color="#D8E4FA" />
          <StatusPill {...displayBadge} />
        </View>
      ) : null}

      {variant === 'alerts_ticker_preview' ? (
        <View style={styles.tickerPreviewWrap}>
          <View style={styles.tickerWrap}>
            <View style={styles.tickerBrandLeft}>
              <Image source={require('../../assets/logo.png')} style={styles.tickerLogo} />
              <Text style={styles.tickerBrandText}>{t('widgets_picker_app_name')}</Text>
            </View>
            <View style={styles.tickerRingMini}>
              <ScoreRing level={scoreLevel} size={56} fontSize={22} strokeWidth={6} />
            </View>
            <View style={styles.tickerTextWrap}>
              {tickerLine ? (
                <Text style={styles.tickerLine} numberOfLines={1}>
                  {tickerLine}
                </Text>
              ) : null}
            </View>
            <Icon name="information-outline" size={18} color="#F4F7FF" />
          </View>
        </View>
      ) : null}

      {variant === 'city_pulse_preview' ? (
        <View style={styles.cityWrap}>
          <Text style={styles.cityTitle} numberOfLines={1}>
            {model.title}
          </Text>
          <View style={styles.cityBarsRow}>
            {[58, 78, 96, 78, 58].map((value, index) => (
              <View
                key={`${index}-${value}`}
                style={[
                  styles.cityBar,
                  {
                    height: value,
                    backgroundColor: '#57D26E',
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.cityFooter}>
            {citySubtitle ? (
            <Text style={styles.citySubtitle} numberOfLines={1}>
              {citySubtitle}
            </Text>
          ) : (
            <View style={styles.citySubtitleSpacer} />
          )}
            <Icon name="crosshairs-gps" size={22} color="#C9D8F0" />
          </View>
          <StatusPill {...displayBadge} />
        </View>
      ) : null}
      <View style={styles.overlay} pointerEvents="none" />
    </View>
  );
};

const styles = StyleSheet.create({
  preview: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'space-between',
    backgroundColor: '#0B1222',
  },
  previewBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(3,6,12,0.18)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topIconSpacer: {
    width: 18,
    height: 18,
  },
  logo: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  brandText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_FAMILY,
  },
  riskNowWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  riskTitle: {
    color: '#F0F4FF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
  },
  statusPill: {
    minHeight: 26,
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  statusPillText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
  },
  scoreRingFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingCore: {
    backgroundColor: '#0F1A33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingMetric: {
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    fontVariant: ['tabular-nums'],
    color: '#FFFFFF',
  },
  commuteWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  commuteRoute: {
    color: '#F0F4FF',
    fontSize: 22,
    lineHeight: 26,
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
  },
  commuteMetricRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  commuteMetricMain: {
    color: '#FFFFFF',
    fontSize: 80,
    lineHeight: 84,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    fontVariant: ['tabular-nums'],
  },
  commuteMetricAccent: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 30,
    fontFamily: FONT_FAMILY,
    fontWeight: '700',
  },
  commuteSubtitle: {
    color: '#E4ECFA',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    width: '100%',
  },
  tickerPreviewWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  tickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
  },
  tickerBrandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tickerLogo: {
    width: 14,
    height: 14,
    borderRadius: 4,
  },
  tickerBrandText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: FONT_FAMILY,
  },
  tickerTextWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
  },
  tickerRingMini: {
    width: 56,
    height: 56,
    marginLeft: 4,
  },
  tickerLine: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
  },
  cityWrap: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  cityTitle: {
    color: '#ECF3FF',
    fontSize: 22,
    lineHeight: 26,
    textAlign: 'center',
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
  },
  cityBarsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  cityBar: {
    flex: 1,
    maxWidth: 72,
    borderRadius: 18,
    minHeight: 48,
  },
  cityFooter: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  citySubtitle: {
    color: '#EDF3FF',
    fontSize: 14,
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    width: '100%',
  },
  citySubtitleSpacer: {
    width: '100%',
    height: 14,
  },
});
