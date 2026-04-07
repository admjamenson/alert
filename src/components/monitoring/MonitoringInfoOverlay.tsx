import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import AppText from '../ui/AppText';

export type MonitoringOverlayStatus = 'active' | 'none' | 'unavailable' | 'loading';
export type MonitoringOverlayTrustStatus = 'online' | 'stale' | 'offline' | 'unavailable';
export type MonitoringOverlaySourceOfficiality =
  | 'OFFICIAL'
  | 'VERIFIED'
  | 'REFERENCE'
  | 'TRUSTED_MEDIA'
  | 'TRUSTED_SOCIAL'
  | 'COMMUNITY'
  | 'ESTIMATED';

export type MonitoringOverlaySource = {
  name: string;
  url?: string | null;
  officiality: MonitoringOverlaySourceOfficiality;
};

export type MonitoringOverlayLegendItem = {
  id?: string;
  icon: string;
  label: string;
  color: string;
};

type MonitoringInfoOverlayProps = {
  title: string;
  status: MonitoringOverlayStatus;
  summary: string;
  updatedAt?: string;
  trustStatus: MonitoringOverlayTrustStatus;
  sources: MonitoringOverlaySource[];
  onRefresh: () => void;
  mapMode: 'default' | 'satellite';
  onToggleMapMode?: () => void;
  mapModeLabel: string;
  statusLabel: string;
  trustLabel: string;
  updatedLabel: string;
  sourcesLabel: string;
  legendLabel: string;
  sourceFallbackLabel?: string;
  officialityLabels: Record<MonitoringOverlaySourceOfficiality, string>;
  refreshAccessibilityLabel: string;
  refreshAccessibilityHint?: string;
  mapModeToggleAccessibilityLabel: string;
  mapModeToggleAccessibilityHint?: string;
  expandAccessibilityLabel: string;
  collapseAccessibilityLabel: string;
  swipeHintLabel?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  onOpenSource?: (source: MonitoringOverlaySource) => void;
  legendItems?: MonitoringOverlayLegendItem[];
  children?: React.ReactNode;
};

const statusChipIcon: Record<MonitoringOverlayStatus, string> = {
  active: 'pulse',
  none: 'check-circle-outline',
  unavailable: 'database-off-outline',
  loading: 'progress-clock',
};

const trustChipIcon: Record<MonitoringOverlayTrustStatus, string> = {
  online: 'shield-check',
  stale: 'clock-alert-outline',
  offline: 'wifi-strength-off-outline',
  unavailable: 'help-circle-outline',
};

const MonitoringInfoOverlay = ({
  title,
  status,
  summary,
  updatedAt,
  trustStatus,
  sources,
  onRefresh,
  mapMode,
  onToggleMapMode,
  mapModeLabel,
  statusLabel,
  trustLabel,
  updatedLabel,
  sourcesLabel,
  legendLabel,
  sourceFallbackLabel,
  officialityLabels,
  refreshAccessibilityLabel,
  refreshAccessibilityHint,
  mapModeToggleAccessibilityLabel,
  mapModeToggleAccessibilityHint,
  expandAccessibilityLabel,
  collapseAccessibilityLabel,
  swipeHintLabel,
  icon,
  loading = false,
  onOpenSource,
  legendItems = [],
  children,
}: MonitoringInfoOverlayProps) => {
  const { isDark } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const hasUpdatedAt = Boolean(updatedAt);

  const cardStyle = useMemo(
    () => ({
      backgroundColor: isDark
        ? ThemeTokens.Monitoring.overlayBgDark
        : ThemeTokens.Monitoring.overlayBgLight,
      borderColor: isDark
        ? ThemeTokens.Monitoring.overlayBorderDark
        : ThemeTokens.Monitoring.overlayBorderLight,
    }),
    [isDark],
  );

  return (
    <View style={[styles.card, cardStyle]}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <AppText
            variant="title3"
            weight="bold"
            tone="inverse"
            style={styles.title}
            numberOfLines={2}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </AppText>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.miniBtn}
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel={refreshAccessibilityLabel}
            accessibilityHint={refreshAccessibilityHint}
            hitSlop={ThemeTokens.Monitoring.railHitSlop}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Icon name="refresh" size={17} color="#FFF" />
            )}
          </TouchableOpacity>

          {onToggleMapMode ? (
            <TouchableOpacity
              style={styles.miniBtn}
              onPress={onToggleMapMode}
              accessibilityRole="button"
              accessibilityLabel={mapModeToggleAccessibilityLabel}
              accessibilityHint={mapModeToggleAccessibilityHint}
              hitSlop={ThemeTokens.Monitoring.railHitSlop}
              activeOpacity={0.9}
            >
              <Icon
                name={mapMode === 'satellite' ? 'map-outline' : 'satellite-variant'}
                size={17}
                color="#FFF"
              />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.miniBtn}
            onPress={() => setCollapsed(prev => !prev)}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? expandAccessibilityLabel : collapseAccessibilityLabel}
            hitSlop={ThemeTokens.Monitoring.railHitSlop}
            activeOpacity={0.9}
          >
            <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={17} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip} accessible accessibilityRole="text">
          <Icon name={statusChipIcon[status]} size={12} color="#E6F4FF" />
          <AppText variant="caption2" tone="inverseSecondary" style={styles.metaChipText} numberOfLines={1}>
            {statusLabel}
          </AppText>
        </View>

        <View style={styles.metaChip} accessible accessibilityRole="text">
          <Icon name={trustChipIcon[trustStatus]} size={12} color="#E6F4FF" />
          <AppText variant="caption2" tone="inverseSecondary" style={styles.metaChipText} numberOfLines={1}>
            {trustLabel}
          </AppText>
        </View>

        <View style={styles.metaChip} accessible accessibilityRole="text">
          <Icon
            name={mapMode === 'satellite' ? 'satellite-variant' : 'map-outline'}
            size={12}
            color="#E6F4FF"
          />
          <AppText variant="caption2" tone="inverseSecondary" style={styles.metaChipText} numberOfLines={1}>
            {mapModeLabel}
          </AppText>
        </View>
      </View>

      {collapsed ? null : (
        <>
          <AppText variant="modalBody" tone="inverse" style={styles.summary} numberOfLines={3} maxFontSizeMultiplier={1.35}>
            {summary}
          </AppText>

          <AppText variant="caption1" tone="inverseSecondary" style={styles.sectionLabel} numberOfLines={1}>
            {sourcesLabel}
          </AppText>

          <View style={styles.sourcesWrap}>
            {sources.map((source, index) => {
              const clickable = Boolean(source.url && onOpenSource);
              return (
                <TouchableOpacity
                  key={`${source.name}-${index}`}
                  style={styles.sourceRow}
                  disabled={!clickable}
                  onPress={() => clickable && onOpenSource?.(source)}
                  activeOpacity={clickable ? 0.86 : 1}
                  accessibilityRole={clickable ? 'button' : undefined}
                  accessibilityLabel={`${source.name}. ${officialityLabels[source.officiality]}`}
                >
                  <AppText
                    variant="footnote"
                    weight="semibold"
                    tone={clickable ? 'inverse' : 'inverseSecondary'}
                    style={[styles.sourceName, !clickable && styles.sourceNamePassive]}
                    numberOfLines={1}
                  >
                    {source.name}
                  </AppText>
                  <View style={styles.badge}>
                    <AppText variant="caption2" tone="inverse" style={styles.badgeText} numberOfLines={1}>
                      {officialityLabels[source.officiality]}
                    </AppText>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {sourceFallbackLabel ? (
            <AppText
              variant="caption1"
              tone="inverseSecondary"
              style={styles.fallbackLabel}
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}
            >
              {sourceFallbackLabel}
            </AppText>
          ) : null}

          {children}

          <AppText
            variant="caption1"
            tone="inverseSecondary"
            style={[styles.updated, !hasUpdatedAt && styles.updatedUnknown]}
            numberOfLines={2}
            maxFontSizeMultiplier={1.3}
          >
            {updatedLabel}
          </AppText>

          {legendItems.length > 0 ? (
            <>
              <AppText variant="caption1" tone="inverseSecondary" style={styles.sectionLabel} numberOfLines={1}>
                {legendLabel}
              </AppText>
              <View style={styles.legendWrap}>
                {legendItems.map((item, idx) => (
                  <View key={item.id || `${item.label}-${idx}`} style={styles.legendItem}>
                    <Icon name={item.icon} size={13} color={item.color} />
                    <AppText variant="caption1" tone="inverseSecondary" style={styles.legendText} numberOfLines={1}>
                      {item.label}
                    </AppText>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {swipeHintLabel ? (
            <AppText
              variant="caption1"
              tone="inverseSecondary"
              style={styles.swipeHint}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {swipeHintLabel}
            </AppText>
          ) : null}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: ThemeTokens.Monitoring.overlayRadius,
    borderWidth: 1,
    padding: ThemeTokens.Monitoring.overlayPadding,
    gap: ThemeTokens.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniBtn: {
    width: ThemeTokens.Monitoring.buttonSize,
    height: ThemeTokens.Monitoring.buttonSize,
    borderRadius: ThemeTokens.Monitoring.buttonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    minHeight: ThemeTokens.Monitoring.badgeHeight,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaChipText: {
    maxWidth: 140,
  },
  summary: {
    color: 'rgba(255,255,255,0.96)',
  },
  sectionLabel: {
    textTransform: 'uppercase',
  },
  sourcesWrap: {
    gap: 6,
  },
  sourceRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceName: {
    flex: 1,
    minWidth: 0,
  },
  sourceNamePassive: {
    color: 'rgba(255,255,255,0.86)',
  },
  badge: {
    minHeight: ThemeTokens.Monitoring.badgeHeight,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 120,
  },
  badgeText: {
    textTransform: 'uppercase',
  },
  fallbackLabel: {
    color: 'rgba(255,255,255,0.78)',
  },
  updated: {
    flexShrink: 1,
  },
  updatedUnknown: {
    color: 'rgba(255,255,255,0.62)',
  },
  legendWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    minHeight: 24,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  legendText: {
    maxWidth: 170,
  },
  swipeHint: {
    color: 'rgba(255,255,255,0.72)',
  },
});

export default MonitoringInfoOverlay;
