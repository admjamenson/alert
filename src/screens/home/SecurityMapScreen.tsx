import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ViewShot from 'react-native-view-shot';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import {
  MAP_STYLE_MODE_STORAGE_KEY,
  MapStyleMode,
} from '../../constants/MapStyles';
import { ThemeTokens } from '../../constants/ThemeTokens';
import UnifiedIncidentStore, {
  SecurityDomain,
  SecurityMapSnapshot,
  SecurityScope,
} from '../../services/data/UnifiedIncidentStore';
import { formatUpdatedAtDisplay } from '../../utils/dateTimeFormat';
import { PermissionManager } from '../../utils/permissions';
import SecurityMapView from '../../components/map/SecurityMapView';
import SecuritySummarySheet from '../../components/panels/SecuritySummarySheet';
import type { ScopeValue } from '../../components/controls/ScopeSegmentedControl';
import RedactionLogger from '../../privacy/RedactionLogger';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const buildScreenshotFileName = () => {
  const now = new Date();
  const toPad = (v: number) => String(v).padStart(2, '0');
  return `Alert_security_map_${now.getFullYear()}${toPad(now.getMonth() + 1)}${toPad(now.getDate())}_${toPad(now.getHours())}${toPad(now.getMinutes())}${toPad(now.getSeconds())}`;
};

const getRelativeAgeLabel = (updatedAt: string | undefined, t: any) => {
  if (!updatedAt) return t('monitoring_overlay_status_monitoring');
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) return t('monitoring_overlay_status_monitoring');
  const minutes = Math.max(1, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 60) {
    return t('monitoring_updated_ago_minutes', {
      count: minutes,
      defaultValue: `${minutes} min`,
    });
  }
  const hours = Math.max(1, Math.floor(minutes / 60));
  if (hours < 24) {
    return t('monitoring_updated_ago_hours', {
      count: hours,
      defaultValue: `${hours} h`,
    });
  }
  const days = Math.max(1, Math.floor(hours / 24));
  return t('monitoring_updated_ago_days', {
    count: days,
    defaultValue: `${days} d`,
  });
};

export const SecurityMapScreen = ({ navigation, route }: any) => {
  const { colors, isDark } = useTheme();
  const { securityState } = useSecurity();
  const { t, i18n } = useTranslation();
  const routeInitialScope = route?.params?.initialScope;
  const initialScope: SecurityScope =
    routeInitialScope === 'STATE' || routeInitialScope === 'COUNTRY'
      ? routeInitialScope
      : 'CITY';
  const initialExpanded = route?.params?.initialState === 'expanded';

  const viewShotRef = useRef<ViewShot | null>(null);

  const [expanded, setExpanded] = useState(initialExpanded);
  const [scope, setScope] = useState<SecurityScope>(initialScope);
  const [liveDataEnabled, setLiveDataEnabled] = useState(true);
  const [snapshot, setSnapshot] = useState<SecurityMapSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapMode, setMapMode] = useState<MapStyleMode>('default');
  const [mapChromeHidden, setMapChromeHidden] = useState(false);

  const routeLat = route?.params?.targetLocation?.latitude;
  const routeLon = route?.params?.targetLocation?.longitude;
  const userLat =
    typeof routeLat === 'number' && Number.isFinite(routeLat)
      ? routeLat
      : securityState.location?.latitude;
  const userLon =
    typeof routeLon === 'number' && Number.isFinite(routeLon)
      ? routeLon
      : securityState.location?.longitude;
  const hasUserLocation =
    typeof userLat === 'number' &&
    Number.isFinite(userLat) &&
    typeof userLon === 'number' &&
    Number.isFinite(userLon);

  const locale = String(i18n.resolvedLanguage || i18n.language || 'en-US');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const scopeItems = useMemo<Array<{ value: ScopeValue; label: string; icon: string }>>(
    () => [
      { value: 'CITY', label: t('security_map_scope_city'), icon: 'city' },
      { value: 'STATE', label: t('security_map_scope_state'), icon: 'map-outline' },
      { value: 'COUNTRY', label: t('security_map_scope_country'), icon: 'earth' },
    ],
    [t],
  );

  const loadSnapshot = useCallback(
    async (force = false, scopeOverride?: SecurityScope) => {
      const effectiveScope = scopeOverride || scope;
      if (!hasUserLocation || typeof userLat !== 'number' || typeof userLon !== 'number') {
        setSnapshot({
          status: 'LIMITED_COVERAGE',
          confidence: 'low',
          updatedAt: undefined,
          hasOfficialLocal: false,
          sourcesCount: 0,
          evidenceLinks: [],
          items: [],
          glyphs: [],
        });
        return;
      }

      setLoading(true);
      try {
        const next = await UnifiedIncidentStore.getSnapshot({
          latitude: userLat,
          longitude: userLon,
          scope: effectiveScope,
          locale,
          timeZone,
          force,
        });
        setSnapshot(next);
      } catch (error) {
        RedactionLogger.safeLog('SecurityMapScreen.loadSnapshot.error', {
          message: String((error as any)?.message || error || 'unknown'),
        });
      } finally {
        setLoading(false);
      }
    },
    [hasUserLocation, locale, scope, timeZone, userLat, userLon],
  );

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(MAP_STYLE_MODE_STORAGE_KEY)
      .then(stored => {
        if (!active) return;
        if (stored === 'satellite' || stored === 'default') {
          setMapMode(stored);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadSnapshot(false);
  }, [loadSnapshot]);

  useEffect(() => {
    if (!liveDataEnabled) return;
    const id = setInterval(() => {
      void loadSnapshot(false);
    }, 45_000);
    return () => clearInterval(id);
  }, [liveDataEnabled, loadSnapshot]);

  const toggleMapMode = useCallback(() => {
    setMapMode(prev => {
      const next: MapStyleMode = prev === 'satellite' ? 'default' : 'satellite';
      AsyncStorage.setItem(MAP_STYLE_MODE_STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const handleMapPress = useCallback(() => {
    setMapChromeHidden(prev => {
      const next = !prev;
      if (next) {
        setExpanded(false);
      }
      return next;
    });
  }, []);

  const formattedUpdatedAt = useMemo(
    () =>
      formatUpdatedAtDisplay(snapshot?.updatedAt || '', locale, timeZone) ||
      t('monitoring_overlay_status_monitoring'),
    [locale, snapshot?.updatedAt, t, timeZone],
  );

  const statusLabel = useMemo(() => {
    const sourcesCount = snapshot?.sourcesCount || 0;
    if (snapshot?.status === 'LIVE') {
      const age = getRelativeAgeLabel(snapshot.updatedAt, t);
      return t('monitoring_overlay_updated_live', {
        age,
        count: sourcesCount,
      });
    }
    if (snapshot?.status === 'SNAPSHOT_VERIFIED') {
      return t('monitoring_continuity_snapshot_verified', {
        time: formattedUpdatedAt,
      });
    }
    if (snapshot?.status === 'CROWD_SIGNAL') {
      return t('monitoring_continuity_unconfirmed_crowd');
    }
    return t('monitoring_continuity_no_official_local');
  }, [formattedUpdatedAt, snapshot?.sourcesCount, snapshot?.status, snapshot?.updatedAt, t]);

  const localizedItems = useMemo(
    () =>
      (snapshot?.items || []).map(item => {
        const localizedTitle = t(`monitoring_event_${item.category}`, {
          defaultValue: item.title,
        });
        const fallbackSummary = t('security_map_status_crowd_reports');
        const localizedSummary =
          item.summary && item.summary.trim().length > 0 ? item.summary : fallbackSummary;
        return {
          ...item,
          title: localizedTitle,
          summary: localizedSummary,
        };
      }),
    [snapshot?.items, t],
  );

  const summaryLabel = useMemo(() => {
    if (snapshot?.status === 'LIVE') {
      return localizedItems[0]?.summary || t('security_map_status_live');
    }
    if (snapshot?.status === 'SNAPSHOT_VERIFIED') {
      return t('monitoring_continuity_monitoring_now');
    }
    if (snapshot?.status === 'CROWD_SIGNAL') {
      return t('security_map_status_crowd_reports');
    }
    return t('security_map_status_limited_coverage');
  }, [localizedItems, snapshot?.status, t]);

  const confidenceLabel = useMemo(() => {
    if (snapshot?.confidence === 'high') return t('monitoring_feed_confidence_high');
    if (snapshot?.confidence === 'medium') return t('monitoring_feed_confidence_medium');
    return t('monitoring_feed_confidence_low');
  }, [snapshot?.confidence, t]);

  const onShare = useCallback(async () => {
    const eventNames = localizedItems
      .slice(0, 3)
      .map(item => item.title)
      .filter(Boolean)
      .join(', ');
    const baseText = t('security_map_share_message', {
      scope: t(
        scope === 'CITY'
          ? 'security_map_scope_city'
          : scope === 'STATE'
            ? 'security_map_scope_state'
            : 'security_map_scope_country',
      ),
      status: statusLabel,
      confidence: confidenceLabel,
      updatedAt: formattedUpdatedAt,
      events: eventNames || t('security_map_share_no_events'),
    });

    try {
      const captureUri = await (viewShotRef.current?.capture as any)?.({
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: buildScreenshotFileName(),
        snapshotContentContainer: false,
        handleGLSurfaceViewOnAndroid: true,
      });
      await Share.share(
        captureUri ? { message: baseText, url: captureUri } : { message: baseText },
      );
    } catch {
      await Share.share({ message: baseText }).catch(() => {});
    }
  }, [confidenceLabel, formattedUpdatedAt, localizedItems, scope, statusLabel, t]);

  const onSave = useCallback(async () => {
    if (saving) return;
    const permissionStatus = await PermissionManager.requestStoragePermission();
    if (permissionStatus !== 'granted') {
      const message = t('monitoring_feed_save_permission_error');
      if (permissionStatus === 'blocked') {
        Alert.alert(
          t('auth_permission_required_title'),
          message,
          [
            {
              text: t('common_cancel'),
              style: 'cancel',
            },
            {
              text: t('common_open_settings'),
              onPress: () => PermissionManager.openSettings(),
            },
          ],
        );
      } else {
        Alert.alert(message);
      }
      return;
    }

    setSaving(true);
    try {
      const uri = await (viewShotRef.current?.capture as any)?.({
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: buildScreenshotFileName(),
        snapshotContentContainer: false,
        handleGLSurfaceViewOnAndroid: true,
      });
      if (uri) {
        await CameraRoll.save(uri, { type: 'photo' });
        Alert.alert(t('monitoring_feed_save_success_with_time', { time: formattedUpdatedAt }));
      } else {
        Alert.alert(t('monitoring_feed_save_error'));
      }
    } catch {
      Alert.alert(t('monitoring_feed_save_error'));
    } finally {
      setSaving(false);
    }
  }, [formattedUpdatedAt, saving, t]);

  const scopeA11yHint = t('monitoring_feed_scope_hint');
  const updatedLabel = t('monitoring_overlay_updated_label', {
    value: formattedUpdatedAt,
  });
  const titleLabel = t('security_map_state_expanded_title');
  const layersTitle = t('security_map_layers_title');
  const layersSearchPlaceholder = t('security_map_layers_search_placeholder');
  const eventsTitle = t('security_map_events_title');

  const layerRows = useMemo(() => {
    const domainConfig: Array<{
      key: SecurityDomain;
      label: string;
      icon: string;
    }> = [
      {
        key: 'SECURITY',
        label: t('security_map_domain_security'),
        icon: 'shield-alert-outline',
      },
      {
        key: 'HEALTH',
        label: t('security_map_domain_health'),
        icon: 'medical-bag',
      },
      {
        key: 'CLIMATE',
        label: t('security_map_domain_climate'),
        icon: 'weather-lightning-rainy',
      },
      {
        key: 'INFRA',
        label: t('security_map_domain_infra'),
        icon: 'office-building-cog-outline',
      },
      {
        key: 'MOBILITY',
        label: t('security_map_domain_mobility'),
        icon: 'car-multiple',
      },
      {
        key: 'OPERATIONS',
        label: t('security_map_domain_operations'),
        icon: 'chart-line-variant',
      },
    ];

    return domainConfig.map(domain => {
      const domainItems = localizedItems.filter(item => item.domain === domain.key);
      const highestScore = Math.max(
        0,
        ...domainItems.map(item => Number(item.confidenceScore || 0)),
      );
      const tone: 'high' | 'medium' | 'low' =
        highestScore >= 0.8 ? 'high' : highestScore >= 0.6 ? 'medium' : 'low';

      return {
        key: domain.key,
        label: domain.label,
        icon: domain.icon,
        count: domainItems.length,
        tone,
      };
    });
  }, [localizedItems, t]);

  return (
    <ViewShot ref={viewShotRef} style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <SafeAreaView style={styles.container} edges={['top']}>
        {!mapChromeHidden ? (
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel={t('common_back')}
              hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
            >
              <Icon name="arrow-left" size={22} color="#FFFFFF" />
              <Text style={styles.backText}>{t('common_back')}</Text>
            </TouchableOpacity>

            <Text style={styles.appTitle} numberOfLines={1}>
              {t('security_map_title')}
            </Text>

            <View style={styles.liveToggle}>
              <Switch
                value={liveDataEnabled}
                onValueChange={value => {
                  setLiveDataEnabled(value);
                  if (value) void loadSnapshot(true);
                }}
                trackColor={{ true: '#2ECC71', false: 'rgba(255,255,255,0.24)' }}
                thumbColor="#FFFFFF"
                accessibilityLabel={t('security_map_live_data')}
              />
              <Text style={styles.liveText}>{t('security_map_live_data')}</Text>
            </View>
          </View>
        ) : null}

        <SecurityMapView
          userLocation={
            hasUserLocation && typeof userLat === 'number' && typeof userLon === 'number'
              ? { latitude: userLat, longitude: userLon }
              : null
          }
          glyphs={snapshot?.glyphs || []}
          incidents={localizedItems}
          chromeHidden={mapChromeHidden}
          mapMode={mapMode}
          onToggleMapMode={toggleMapMode}
          onMapPress={handleMapPress}
          mapModeLabel={
            mapMode === 'satellite'
              ? t('monitoring_feed_action_map_default')
              : t('monitoring_feed_action_map_satellite')
          }
          recenterLabel={t('recenter')}
          loadingLabel={loading ? t('monitoring_overlay_status_loading') : t('map_loading')}
          unavailableLabel={t('monitoring_continuity_monitoring_now')}
          watermarkText={t('alert_ai_name')}
          timeRangeLabel={t('security_map_time_range')}
          timeNowLabel={t('security_map_time_now')}
          timeFutureLabel={t('security_map_time_future_short')}
          liveDataLabel={t('security_map_live_data')}
          watermarkFooter={t('security_map_watermark_footer')}
          updatedAtFooter={formattedUpdatedAt}
          onGlyphPress={() => {
            setMapChromeHidden(false);
            setExpanded(true);
          }}
        />

        {!mapChromeHidden ? (
          <SecuritySummarySheet
            expanded={expanded}
            onExpandedChange={value => {
              setExpanded(value);
              if (value) {
                setMapChromeHidden(false);
              }
            }}
            title={titleLabel}
            statusLabel={statusLabel}
            confidenceLabel={confidenceLabel}
            summary={summaryLabel}
            updatedAtLabel={updatedLabel}
            scope={scope}
            onScopeChange={nextScope => {
              setScope(nextScope);
              void loadSnapshot(true, nextScope);
            }}
            items={localizedItems}
            layerRows={layerRows}
            layersTitle={layersTitle}
            layersSearchPlaceholder={layersSearchPlaceholder}
            eventsTitle={eventsTitle}
            detailsCtaLabel={t('security_map_state_compact_cta_details')}
            viewAllLabel={t('security_map_view_all')}
            shareLabel={t('security_map_action_share')}
            saveLabel={saving ? t('monitoring_feed_save_label_saving') : t('security_map_action_save')}
            collapseLabel={t('security_map_action_collapse')}
            onShare={onShare}
            onSave={onSave}
            onViewAll={() =>
              navigation.navigate('MonitoringFeed', {
                initialCategory: snapshot?.items?.[0]?.category,
              })
            }
            scopeA11yHint={scopeA11yHint}
            shareA11yHint={t('monitoring_feed_action_share_hint')}
            saveA11yHint={t('monitoring_feed_action_save_hint')}
            saveBusy={saving}
            scopeItems={scopeItems}
          />
        ) : null}
      </SafeAreaView>
    </ViewShot>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050A15',
  },
  topBar: {
    height: ThemeTokens.SecurityMap.topBarHeight,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(7,12,24,0.64)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 12,
  },
  backBtn: {
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    fontFamily: FONT_FAMILY,
    letterSpacing: -0.4,
    maxWidth: '42%',
  },
  liveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    paddingHorizontal: 8,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  liveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});

export default SecurityMapScreen;
