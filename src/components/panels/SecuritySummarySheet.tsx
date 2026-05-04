import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  I18nManager,
  PanResponder,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import {
  SecurityConfidence,
  SecurityIncidentItem,
  SecurityScope,
} from '../../services/data/UnifiedIncidentStore';
import ScopeSegmentedControl, {
  ScopeValue,
} from '../controls/ScopeSegmentedControl';
import ShareSaveBar from '../actions/ShareSaveBar';
import AppText from '../ui/AppText';

type LayerRow = {
  key: string;
  label: string;
  icon: string;
  count: number;
  tone: SecurityConfidence;
};

type Props = {
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  title: string;
  statusLabel: string;
  confidenceLabel: string;
  summary: string;
  updatedAtLabel: string;
  scope: SecurityScope;
  onScopeChange: (scope: SecurityScope) => void;
  items: SecurityIncidentItem[];
  layerRows: LayerRow[];
  layersTitle: string;
  layersSearchPlaceholder: string;
  eventsTitle: string;
  detailsCtaLabel: string;
  viewAllLabel: string;
  shareLabel: string;
  saveLabel: string;
  collapseLabel: string;
  onShare: () => void;
  onSave: () => void;
  onViewAll: () => void;
  scopeA11yHint: string;
  shareA11yHint: string;
  saveA11yHint: string;
  saveBusy?: boolean;
  scopeItems: Array<{
    value: ScopeValue;
    label: string;
    icon: string;
  }>;
};

const DRAG_THRESHOLD = 72;
const screenHeight = Dimensions.get('window').height;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const confidenceColor = (label: string) => {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('alta') || normalized.includes('high')) return '#66BB6A';
  if (normalized.includes('media') || normalized.includes('medium')) return '#FFB74D';
  return '#BDBDBD';
};

const DARK_SHEET_GLASS = `rgba(17,17,17,${ThemeTokens.SecurityMap.glassOpacityDark})`;

const toneColor = (tone: SecurityConfidence) => {
  if (tone === 'high') return '#4CAF50';
  if (tone === 'medium') return '#FFA726';
  return '#90A4AE';
};

export const SecuritySummarySheet: React.FC<Props> = ({
  expanded,
  onExpandedChange,
  title,
  statusLabel,
  confidenceLabel,
  summary,
  updatedAtLabel,
  scope,
  onScopeChange,
  items,
  layerRows,
  layersTitle,
  layersSearchPlaceholder,
  eventsTitle,
  detailsCtaLabel,
  viewAllLabel,
  shareLabel,
  saveLabel,
  collapseLabel,
  onShare,
  onSave,
  onViewAll,
  scopeA11yHint,
  shareA11yHint,
  saveA11yHint,
  saveBusy = false,
  scopeItems,
}) => {
  const { t } = useTranslation();
  const isRTL = I18nManager.isRTL;
  const expandedHeight = Math.round(screenHeight * ThemeTokens.SecurityMap.expandedHeightRatio);
  const compactHeight = ThemeTokens.SecurityMap.compactHeight;
  const collapsedY = Math.max(0, expandedHeight - compactHeight);
  const translateY = useRef(new Animated.Value(expanded ? 0 : collapsedY)).current;
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, collapsedY],
    outputRange: [0.24, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: expanded ? 0 : collapsedY,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [collapsedY, expanded, translateY]);

  const setExpanded = React.useCallback((next: boolean) => {
    if (next === expanded) {
      Animated.timing(translateY, {
        toValue: next ? 0 : collapsedY,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }
    onExpandedChange(next);
  }, [collapsedY, expanded, onExpandedChange, translateY]);

  useEffect(() => {
    if (!expanded) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [expanded, setExpanded]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dx) < Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          const next = Math.max(0, Math.min(collapsedY, (expanded ? 0 : collapsedY) + gesture.dy));
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy <= -DRAG_THRESHOLD) {
            setExpanded(true);
            return;
          }
          if (gesture.dy >= DRAG_THRESHOLD) {
            setExpanded(false);
            return;
          }
          const shouldExpand = gesture.dy < 0 ? true : expanded;
          setExpanded(shouldExpand);
        },
        onPanResponderTerminate: () => {
          Animated.timing(translateY, {
            toValue: expanded ? 0 : collapsedY,
            duration: 180,
            useNativeDriver: true,
          }).start();
        },
      }),
    [collapsedY, expanded, setExpanded, translateY],
  );

  return (
    <>
      <AnimatedPressable
        accessibilityLabel={collapseLabel}
        accessibilityRole="button"
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        onPress={() => setExpanded(false)}
        pointerEvents={expanded ? 'auto' : 'none'}
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      />
      <Animated.View
        style={[
          styles.sheet,
          {
            height: expandedHeight,
            transform: [{ translateY }],
            backgroundColor: DARK_SHEET_GLASS,
          },
        ]}
      >
        <View style={styles.dragHandleWrap} {...panResponder.panHandlers}>
          <View style={styles.dragHandle} />
        </View>

        <View style={styles.compactHeader}>
          <View style={styles.compactTextWrap}>
            <AppText variant="caption1" tone="inverseSecondary" style={styles.statusText} numberOfLines={1}>
              {statusLabel}
            </AppText>
            <AppText variant="callout" weight="semibold" tone="inverse" style={styles.summaryText} numberOfLines={1}>
              {summary}
            </AppText>
          </View>
          <TouchableOpacity
            style={styles.detailsBtn}
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={detailsCtaLabel}
            hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
          >
            <AppText variant="caption1" tone="inverse" style={styles.detailsBtnText}>
              {detailsCtaLabel}
            </AppText>
            <Icon
              name={isRTL ? 'chevron-left' : 'chevron-right'}
              size={16}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </View>

        {expanded ? (
          <View style={styles.expandedBody}>
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <AppText variant="largeTitle" tone="inverse" style={styles.titleText} numberOfLines={1}>
                  {title}
                </AppText>
                <AppText variant="caption1" tone="inverseSecondary" style={styles.updatedText} numberOfLines={1}>
                  {updatedAtLabel}
                </AppText>
              </View>
              <TouchableOpacity
                style={styles.collapseBtn}
                onPress={() => setExpanded(false)}
                accessibilityRole="button"
                accessibilityLabel={collapseLabel}
                hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
              >
                <Icon name="chevron-down" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.metaRow}>
              <View style={styles.statusBadge}>
                <Icon name="shield-check-outline" size={13} color="#81D4FA" />
                <AppText variant="caption1" tone="inverseSecondary" style={styles.statusBadgeText} numberOfLines={1}>
                  {statusLabel}
                </AppText>
              </View>
              <View
                style={[
                  styles.confidenceChip,
                  { borderColor: confidenceColor(confidenceLabel) },
                ]}
              >
                <Icon name="shield-star-outline" size={13} color={confidenceColor(confidenceLabel)} />
                <AppText
                  variant="caption1"
                  weight="semibold"
                  style={[styles.confidenceText, { color: confidenceColor(confidenceLabel) }]}
                  numberOfLines={1}
                >
                  {confidenceLabel}
                </AppText>
              </View>
            </View>

            <ScopeSegmentedControl
              items={scopeItems}
              value={scope}
              onChange={onScopeChange}
              accessibilityHint={scopeA11yHint}
            />

            <View style={styles.layersCard}>
              <AppText variant="title2" tone="inverse" style={styles.layersTitle}>
                {layersTitle}
              </AppText>
              <View style={styles.searchRow}>
                <Icon name="magnify" size={16} color="rgba(255,255,255,0.74)" />
                <AppText variant="subhead" tone="inverseSecondary" style={styles.searchText} numberOfLines={1}>
                  {layersSearchPlaceholder}
                </AppText>
              </View>

              {layerRows.map(row => (
                <View key={row.key} style={styles.layerRow}>
                  <View style={styles.layerLeading}>
                    <Icon name={row.icon} size={16} color={toneColor(row.tone)} />
                    <AppText variant="body" weight="semibold" tone="inverse" style={styles.layerLabel} numberOfLines={1}>
                      {row.label}
                    </AppText>
                  </View>
                  <AppText variant="title3" tone="inverseSecondary" style={styles.layerCount} numberOfLines={1}>
                    {row.count}
                  </AppText>
                </View>
              ))}
            </View>

            <View style={styles.eventsCard}>
              <View style={styles.eventsHeader}>
                <AppText variant="headline" tone="inverse" style={styles.eventsTitle}>
                  {eventsTitle}
                </AppText>
                <TouchableOpacity
                  style={styles.viewAllBtn}
                  onPress={onViewAll}
                  accessibilityRole="button"
                  accessibilityLabel={viewAllLabel}
                  hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
                >
                  <AppText variant="caption1" tone="inverse" style={styles.viewAllText}>
                    {viewAllLabel}
                  </AppText>
                </TouchableOpacity>
              </View>

              {items.slice(0, 5).map(item => (
                <View key={item.id} style={styles.listRow}>
                  <View style={styles.listRowText}>
                    <AppText variant="subhead" weight="semibold" tone="inverse" style={styles.listRowTitle} numberOfLines={1}>
                      {item.title}
                    </AppText>
                    <AppText variant="footnote" tone="inverseSecondary" style={styles.listRowSummary} numberOfLines={1}>
                      {item.summary}
                    </AppText>
                  </View>
                  <AppText variant="caption1" tone="inverseSecondary" style={styles.listRowBadge} numberOfLines={1}>
                    {item.confidence}
                  </AppText>
                </View>
              ))}

              {items.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Icon name="shield-search-outline" size={16} color="rgba(255,255,255,0.84)" />
                  <AppText variant="subhead" tone="inverseSecondary" style={styles.emptyText} numberOfLines={2}>
                    {summary}
                  </AppText>
                </View>
              ) : null}
            </View>

            <ShareSaveBar
              shareLabel={shareLabel}
              saveLabel={saveLabel}
              onShare={onShare}
              onSave={onSave}
              saveBusy={saveBusy}
              shareA11yHint={shareA11yHint}
              saveA11yHint={saveA11yHint}
            />

            <AppText variant="caption2" tone="inverseSecondary" style={styles.sosDisclaimer}>
              {t('legal_sos_disclaimer')}
            </AppText>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#010309',
    zIndex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    borderTopLeftRadius: ThemeTokens.SecurityMap.overlayRadius,
    borderTopRightRadius: ThemeTokens.SecurityMap.overlayRadius,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    paddingHorizontal: ThemeTokens.SecurityMap.overlayPadding,
    zIndex: 2,
  },
  dragHandleWrap: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    width: 46,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  compactHeader: {
    minHeight: ThemeTokens.SecurityMap.compactSummaryMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
  },
  compactTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  statusText: {
    textTransform: 'uppercase',
  },
  summaryText: {
    marginTop: 2,
  },
  detailsBtn: {
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 4,
    maxWidth: '42%',
  },
  detailsBtnText: {
    flexShrink: 1,
  },
  expandedBody: {
    paddingBottom: 14,
    gap: 12,
  },
  headerRow: {
    minHeight: ThemeTokens.SecurityMap.expandedHeaderMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    color: '#FFFFFF',
  },
  updatedText: {
    marginTop: 2,
  },
  collapseBtn: {
    width: ThemeTokens.SecurityMap.buttonMinSize,
    height: ThemeTokens.SecurityMap.buttonMinSize,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flex: 1,
    minHeight: 32,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexDirection: 'row',
    gap: 6,
  },
  statusBadgeText: {
    flex: 1,
  },
  confidenceChip: {
    minHeight: 32,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    maxWidth: '48%',
  },
  confidenceText: {
    textTransform: 'uppercase',
  },
  layersCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 10,
    gap: 8,
  },
  layersTitle: {
    color: '#FFFFFF',
  },
  searchRow: {
    minHeight: ThemeTokens.SecurityMap.layerSearchMinHeight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchText: {
    flex: 1,
  },
  layerRow: {
    minHeight: ThemeTokens.SecurityMap.layerRowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  layerLeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  layerLabel: {
    flexShrink: 1,
  },
  layerCount: {
    color: 'rgba(255,255,255,0.86)',
  },
  eventsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 10,
    gap: 8,
  },
  eventsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventsTitle: {
    color: '#FFFFFF',
  },
  viewAllBtn: {
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewAllText: {
    color: '#FFFFFF',
  },
  listRow: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listRowText: {
    flex: 1,
    minWidth: 0,
  },
  listRowTitle: {
    color: '#FFFFFF',
  },
  listRowSummary: {
    marginTop: 2,
  },
  listRowBadge: {
    color: '#E3F2FD',
    textTransform: 'uppercase',
  },
  emptyRow: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    flex: 1,
  },
  sosDisclaimer: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
    opacity: 0.7,
  },
});

export default SecuritySummarySheet;
