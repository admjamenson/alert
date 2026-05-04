import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import { TelemetryService } from '../../services/TelemetryService';
import { RefreshWidgetSnapshotsCommand } from '../application/commands/RefreshWidgetSnapshotsCommand';
import { SelectWidgetPresetCommand } from '../application/commands/SelectWidgetPresetCommand';
import { GetWidgetCatalogQuery } from '../application/queries/GetWidgetCatalogQuery';
import {
  GetWidgetPreviewModelQuery,
  WidgetPreviewModel,
} from '../application/queries/GetWidgetPreviewModelQuery';
import { WidgetPreset } from '../domain/WidgetPreset';
import { widgetBridge } from '../infra/WidgetBridge';
import { widgetSnapshotRepository } from '../infra/WidgetSnapshotRepository';
import { WidgetPickerHeader } from './WidgetPickerHeader';
import { WidgetPresetRow } from './WidgetPresetRow';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const buildFallbackModel = (
  preset: WidgetPreset,
  t: (key: string, options?: Record<string, unknown>) => string,
): WidgetPreviewModel => ({
  preset,
  title: t(`widget_preset_${preset}`, { defaultValue: preset }),
  subtitle:
    preset === 'commute'
      ? t('widget_destination_default', { defaultValue: 'Work' })
      : preset === 'alerts_ticker'
        ? t('widget_alerts_focus_local_attention', { defaultValue: 'Local caution' })
        : preset === 'city_pulse'
          ? t('widget_alerts_status_attention', { defaultValue: 'Attention nearby' })
          : '',
  metric: preset === 'commute' ? '9m' : '18',
  confidence: 'MEDIUM',
  confidenceLabel: t('widget_confidence_medium', { defaultValue: 'Medium confidence' }),
  updatedAtLabel: t('widget_updated_now', { defaultValue: 'Updated now' }),
  chips: [],
  deeplink: 'alertapp://home',
  level: 18,
  segmentProfile:
    preset === 'commute'
      ? [28, 38, 46, 38, 30]
      : preset === 'city_pulse'
        ? [32, 48, 58, 48, 34]
        : [26, 32, 38, 34, 28],
  statusBadge:
    preset === 'commute'
      ? {
          tone: 'normal',
          label: t('widget_alerts_status_normal', { defaultValue: 'No alerts' }),
        }
      : {
          tone: 'attention',
          label: t('widget_alerts_status_attention', { defaultValue: 'Attention nearby' }),
        },
  iconKey:
    preset === 'commute'
      ? 'commute'
      : preset === 'city_pulse'
        ? 'city'
        : preset === 'alerts_ticker'
          ? 'ticker'
          : 'risk',
});

export const WidgetCatalogScreen = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<WidgetPreset>('risk_now');
  const [loading, setLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [canPinWidget, setCanPinWidget] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [previewModels, setPreviewModels] = useState<
    Partial<Record<WidgetPreset, WidgetPreviewModel>>
  >({});
  const mountedRef = useRef(true);

  const catalog = useMemo(() => GetWidgetCatalogQuery.execute(), []);

  const syncSelectionAndSnapshots = useCallback(async () => {
    const [all, persistedPreset] = await Promise.all([
      GetWidgetPreviewModelQuery.executeAll(),
      widgetSnapshotRepository.getDefaultPreset(),
    ]);
    if (!mountedRef.current) return;
    setPreviewModels(all);
    setSelected(persistedPreset);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await RefreshWidgetSnapshotsCommand.execute({ force: true });
      await syncSelectionAndSnapshots();
      TelemetryService.trackEvent('widget_picker_refresh', {
        screen: 'WidgetCatalog',
        source: 'manual',
      });
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [syncSelectionAndSnapshots]);

  const selectPreset = useCallback(
    async (preset: WidgetPreset) => {
      setSelected(preset);
      ReactNativeHapticFeedback.trigger(ThemeTokens.haptics.light, {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      TelemetryService.trackEvent('widget_picker_select', {
        screen: 'WidgetCatalog',
        preset,
      });
      await SelectWidgetPresetCommand.execute({ preset });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    TelemetryService.trackEvent('widget_picker_open', { screen: 'WidgetCatalog' });
    void syncSelectionAndSnapshots();
    return () => {
      mountedRef.current = false;
    };
  }, [syncSelectionAndSnapshots]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(value => {
        if (mountedRef.current) setReduceMotion(Boolean(value));
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', enabled => {
      if (mountedRef.current) setReduceMotion(Boolean(enabled));
    });
    return () => {
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    widgetBridge
      .canRequestPinWidget()
      .then(value => {
        if (active) setCanPinWidget(Boolean(value));
      })
      .catch(() => {
        if (active) setCanPinWidget(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const pinSelectedPreset = useCallback(async () => {
    if (!canPinWidget || pinning) return;
    setPinning(true);
    try {
      await RefreshWidgetSnapshotsCommand.execute({ force: true });
      const requested = await widgetBridge.requestPinWidget(selected);
      if (!requested) {
        Alert.alert(
          t('widget_pin_unavailable_title'),
          t('widget_pin_unavailable_body'),
        );
      }
    } finally {
      if (mountedRef.current) {
        setPinning(false);
      }
    }
  }, [canPinWidget, pinning, selected, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#0A0C12' }]} edges={['top']}>
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <FlatList
          data={catalog}
          keyExtractor={item => item.preset}
          ListHeaderComponent={<WidgetPickerHeader count={catalog.length} />}
          contentContainerStyle={styles.listContent}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          renderItem={({ item }) => (
            <WidgetPresetRow
              item={item}
              model={previewModels[item.preset] || buildFallbackModel(item.preset, t)}
              selected={selected === item.preset}
              reduceMotion={reduceMotion}
              onPress={() => {
                void selectPreset(item.preset);
              }}
            />
          )}
          ListFooterComponent={
            <View style={styles.footerWrap}>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: loading ? 0.7 : 1,
                  },
                ]}
                onPress={() => {
                  void refresh();
                }}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={t('monitoring_action_refresh')}
              >
                <Icon name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.actionText}>
                  {loading ? t('widget_refreshing') : t('monitoring_action_refresh')}
                </Text>
              </TouchableOpacity>
              {Platform.OS === 'android' && canPinWidget ? (
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      opacity: pinning ? 0.7 : 1,
                    },
                  ]}
                  onPress={() => {
                    void pinSelectedPreset();
                  }}
                  disabled={pinning}
                  accessibilityRole="button"
                  accessibilityLabel={t('widget_pin_to_home')}
                >
                  <Icon name="plus-box-outline" size={18} color={colors.text} />
                  <Text style={[styles.secondaryText, { color: colors.text }]}>
                    {pinning ? t('widget_pinning') : t('widget_pin_to_home')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    marginTop: 4,
    borderTopLeftRadius: ThemeTokens.Widgets.pickerSheetRadius,
    borderTopRightRadius: ThemeTokens.Widgets.pickerSheetRadius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listContent: {
    paddingBottom: 20,
    paddingHorizontal: 14,
  },
  rowGap: {
    height: ThemeTokens.Widgets.previewGap,
  },
  footerWrap: {
    paddingTop: ThemeTokens.Widgets.previewGap,
    paddingBottom: 14,
    gap: 10,
  },
  actionBtn: {
    minHeight: ThemeTokens.Widgets.minTap,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtn: {
    minHeight: ThemeTokens.Widgets.minTap,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  secondaryText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});
