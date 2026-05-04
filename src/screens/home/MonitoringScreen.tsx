import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { GetMonitoringScreenSnapshotQuery } from '../../application/queries/GetMonitoringScreenSnapshotQuery';
import { MonitoringSourcesBR } from '../../services/MonitoringSourcesBR';
import { EpidemicSnapshot } from '../../services/EpidemicService';
import { TelemetryService } from '../../services/TelemetryService';
import HazardSymbolIcon from '../../components/map/HazardSymbolIcon';
import {
  DEFAULT_FEATURED_EVENT_IDS,
  FEATURED_EVENTS_KEY,
  MANUAL_ONLY_EVENT_IDS,
  MONITORING_EVENTS,
  MonitoringEvent,
} from '../../constants/MonitoringEvents';
import { useTranslation } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import {
  formatUpdatedAtDisplay,
  isInvalidFormattedDateLike,
  isNativeDateStringLike,
  normalizeToIsoDateTime,
  resolveLocale,
  resolveTimeZone,
} from '../../utils/dateTimeFormat';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';

const ALWAYS_OFFICIAL_IDS = new Set(['pandemic', 'epidemic']);
const OFFICIAL_EVENT_IDS = new Set([
  ...Object.keys(MonitoringSourcesBR),
  ...Array.from(ALWAYS_OFFICIAL_IDS),
]);
const OFFICIAL_EVENTS: MonitoringEvent[] = MONITORING_EVENTS.filter(event =>
  OFFICIAL_EVENT_IDS.has(event.id),
);
const EVENT_ORDER = new Map(MONITORING_EVENTS.map((event, index) => [event.id, index]));

const joinStatus = (main: string, source?: string) => {
  if (!source) return main;
  if (main.includes(source)) return main;
  return `${main}\n${source}`;
};

export const MonitoringScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const { securityState } = useSecurity();
  const localeTag = useMemo(
    () => resolveLocale(i18n.resolvedLanguage || i18n.language || getLocales()?.[0]?.languageTag),
    [i18n.language, i18n.resolvedLanguage],
  );
  const timeZone = useMemo(() => resolveTimeZone(), []);
  const [featured, setFeatured] = useState<string[]>(DEFAULT_FEATURED_EVENT_IDS);
  const [loading, setLoading] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [pandemicSnapshot, setPandemicSnapshot] = useState<EpidemicSnapshot | null>(null);
  const [epidemicSnapshot, setEpidemicSnapshot] = useState<EpidemicSnapshot | null>(null);
  const [snapshotSyncCompletedAt, setSnapshotSyncCompletedAt] = useState<{
    pandemic?: string;
    epidemic?: string;
  }>({});
  const [sourceMetaByEventId, setSourceMetaByEventId] = useState<
    Record<
      string,
      {
        sourceName?: string;
        officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE';
        confidence: number;
      }
    >
  >({});
  const invalidUpdatedAtTelemetryRef = React.useRef<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(FEATURED_EVENTS_KEY);
        if (raw) {
          const stored = JSON.parse(raw);
          if (Array.isArray(stored) && stored.length > 0) {
            const next = stored
              .filter((id: unknown): id is string => typeof id === 'string')
              .filter(id => OFFICIAL_EVENT_IDS.has(id))
              .slice(0, 7);
            if (next.length > 0) {
              setFeatured(next);
            }
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const lat = securityState.location?.latitude;
    const lon = securityState.location?.longitude;
    if (!canUseLocationForRiskMaps(securityState) || !isFiniteCoordinatePair(lat, lon)) {
      setPandemicSnapshot(null);
      setEpidemicSnapshot(null);
      setSnapshotSyncCompletedAt({});
      setSourceMetaByEventId({});
      return;
    }
    const safeLat = Number(lat);
    const safeLon = Number(lon);
    const riskScore =
      securityState.riskLevel === 'high'
        ? 0.8
        : securityState.riskLevel === 'medium'
          ? 0.55
          : 0.2;
    let cancelled = false;
    const load = async () => {
      try {
        setLoadingAlerts(true);
        const snapshot = await GetMonitoringScreenSnapshotQuery.execute({
          latitude: safeLat,
          longitude: safeLon,
          riskScore,
        });
        if (!cancelled) {
          const completedAt = normalizeToIsoDateTime(new Date()) || new Date().toISOString();
          setActiveIds(new Set(snapshot.activeIds));
          setUnavailableIds(new Set(snapshot.unavailableIds));
          setSummaries(snapshot.summaries);
          setSourceMetaByEventId(snapshot.sourceMetaByEventId);
          setPandemicSnapshot(snapshot.pandemicSnapshot);
          setEpidemicSnapshot(snapshot.epidemicSnapshot);
          setSnapshotSyncCompletedAt({
            pandemic: completedAt,
            epidemic: completedAt,
          });
        }
      } catch {
        if (!cancelled) {
          setActiveIds(new Set());
          setUnavailableIds(new Set());
          setSummaries({});
          setPandemicSnapshot(null);
          setEpidemicSnapshot(null);
          setSourceMetaByEventId({});
        }
      } finally {
        if (!cancelled) setLoadingAlerts(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    securityState.location?.latitude,
    securityState.location?.longitude,
    securityState.riskLevel,
  ]);

  const persistFeatured = async (next: string[]) => {
    try {
      await AsyncStorage.setItem(FEATURED_EVENTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleFeatured = (id: string) => {
    if (!OFFICIAL_EVENT_IDS.has(id)) return;
    if (featured.includes(id)) {
      const next = featured.filter(item => item !== id);
      setFeatured(next);
      void persistFeatured(next);
      return;
    }
    if (featured.length >= 7) {
      Alert.alert(
        t('monitoring_limit_title'),
        t('monitoring_limit_body'),
      );
      return;
    }
    const next = [...featured, id];
    setFeatured(next);
    void persistFeatured(next);
  };

  const sortedEvents = useMemo(() => {
    const order = new Map<string, number>([
      ['pandemic', 0],
      ['epidemic', 1],
    ]);
    return [...OFFICIAL_EVENTS].sort((a, b) => {
      const rankA = order.has(a.id) ? (order.get(a.id) as number) : 2;
      const rankB = order.has(b.id) ? (order.get(b.id) as number) : 2;
      if (rankA !== rankB) return rankA - rankB;
      const activeA = activeIds.has(a.id) ? 0 : 1;
      const activeB = activeIds.has(b.id) ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return (EVENT_ORDER.get(a.id) || 0) - (EVENT_ORDER.get(b.id) || 0);
    });
  }, [activeIds]);

  const featuredEvents = useMemo(
    () => sortedEvents.filter(event => featured.includes(event.id)),
    [featured, sortedEvents],
  );

  const resolveEventLabel = (event: MonitoringEvent) =>
    t(`monitoring_event_${event.id}`);

  const fmtNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) return t('epidemic_map_value_na');
    try {
      return value.toLocaleString(localeTag);
    } catch {
      return String(value);
    }
  };

  const formatSnapshotStatus = (snap?: EpidemicSnapshot | null) => {
    if (!snap || !snap.sources || snap.sources.length === 0) {
      return t('epidemic_map_no_feed');
    }
    const level =
      (typeof snap.municipal.cases === 'number' || typeof snap.municipal.deaths === 'number')
        ? snap.municipal
        : (typeof snap.state.cases === 'number' || typeof snap.state.deaths === 'number')
          ? snap.state
          : snap.country;
    const stats = `${t('epidemic_map_cases_short')}: ${fmtNumber(level.cases)} | ${t(
      'epidemic_map_deaths_short',
    )}: ${fmtNumber(level.deaths)}`;
    return snap.disease?.name ? `${snap.disease.name} | ${stats}` : stats;
  };

  const formatSnapshotMeta = (
    snap?: EpidemicSnapshot | null,
    mode?: 'pandemic' | 'epidemic',
  ) => {
    if (!snap || !snap.sources || snap.sources.length === 0) return '';
    const source = snap.sources[0]?.name;
    const normalizedUpdated =
      normalizeToIsoDateTime(snap.asOf || snap.fetchedAt) ||
      (mode === 'pandemic'
        ? snapshotSyncCompletedAt.pandemic
        : mode === 'epidemic'
          ? snapshotSyncCompletedAt.epidemic
          : '') ||
      '';
    const updated = formatUpdatedAtDisplay(normalizedUpdated, localeTag, timeZone);
    if (mode && normalizedUpdated && !updated) {
      if (invalidUpdatedAtTelemetryRef.current[mode] !== normalizedUpdated) {
        invalidUpdatedAtTelemetryRef.current[mode] = normalizedUpdated;
        TelemetryService.trackEvent('monitoring_screen_updated_at_invalid', {
          mode,
          rawUpdatedAt: normalizedUpdated,
          locale: localeTag,
          timeZone,
        });
      }
    } else if (mode) {
      delete invalidUpdatedAtTelemetryRef.current[mode];
    }
    const sourceLine = source ? t('epidemic_map_source_prefix', { source }) : '';
    const safeUpdated =
      updated && !isInvalidFormattedDateLike(updated) && !isNativeDateStringLike(updated)
        ? updated
        : '--';
    const updatedLine = `${t('epidemic_map_updated_prefix')} ${safeUpdated}`;
    return [sourceLine, updatedLine].filter(Boolean).join(' | ');
  };

  const openOfficialSources = () => {
    navigation.navigate('OfficialSources');
  };

  const openAlertAi = useCallback(() => {
    const priorityTypes = featuredEvents.map(event => event.id);
    const initialCategory = priorityTypes[0] || 'pandemic';
    navigation.navigate('MonitoringFeed', {
      initialCategory,
      priorityTypes,
      alertAI: true,
    });
  }, [featuredEvents, navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('monitoring_title')}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={openAlertAi}
            accessibilityRole="button"
            accessibilityLabel={t('alert_ai_entry')}
            accessibilityHint={t('alert_ai_entry_hint')}
            style={styles.headerAction}
          >
            <Icon name="robot-outline" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openOfficialSources}
            accessibilityRole="button"
            accessibilityLabel={t('official_sources_open_screen')}
            style={styles.headerAction}
          >
            <Icon name="book-open-page-variant-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('monitoring_subtitle')}
      </Text>

      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('monitoring_highlights', { count: featuredEvents.length })}
        </Text>
        {featuredEvents.length === 0 ? (
          <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
            {t('monitoring_highlights_empty')}
          </Text>
        ) : (
          <View style={styles.featuredGrid}>
            {featuredEvents.map(event => (
              <View key={event.id} style={styles.featuredItem}>
                <HazardSymbolIcon eventType={event.id} fallbackIcon={event.icon} size={20} color="#FF0000" />
                <Text style={[styles.featuredLabel, { color: colors.text }]}>
                  {resolveEventLabel(event)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 18 }]}>
        {t('monitoring_all_events')}
      </Text>
      {loading ? (
        <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
          {t('monitoring_loading_list')}
        </Text>
       ) : (
         <FlatList
           data={sortedEvents}
           keyExtractor={item => item.id}
           contentContainerStyle={{ paddingBottom: 40 }}
           renderItem={({ item }) => {
            const isSelected = featured.includes(item.id);
            const isActive = activeIds.has(item.id);
             const isPandemic = item.id === 'pandemic';
             const isEpidemic = item.id === 'epidemic';
             const snapshot = isPandemic ? pandemicSnapshot : isEpidemic ? epidemicSnapshot : null;
             const sourceHint =
               !isPandemic && !isEpidemic ? MonitoringSourcesBR[item.id] : undefined;
             const sourceMeta = sourceMetaByEventId[item.id];
             const sourceLabel = sourceHint?.requiresAccess
               ? t('monitoring_requires_credential', { source: sourceHint.label })
               : sourceMeta?.sourceName || sourceHint?.label;
             const statusMain =
               isPandemic || isEpidemic
                 ? formatSnapshotStatus(snapshot)
                 : MANUAL_ONLY_EVENT_IDS.has(item.id)
                   ? sourceLabel || t('monitoring_source_required')
                   : loadingAlerts
                     ? t('monitoring_checking_alerts')
                     : isActive
                       ? summaries[item.id] || t('monitoring_alert_active')
                        : unavailableIds.has(item.id)
                          ? t('monitoring_data_unavailable', {
                              defaultValue: 'Mostrando última informação verificada',
                            })
                        : sourceLabel || t('monitoring_no_alerts');
             const statusText = joinStatus(
               statusMain,
               isPandemic || isEpidemic
                 ? formatSnapshotMeta(snapshot, isPandemic ? 'pandemic' : 'epidemic')
                 : sourceLabel,
             );
             const sourceUrl = snapshot?.sources?.[0]?.url;
             const canOpenOfficialSources = Boolean(sourceHint) || Boolean(sourceUrl);
             return (
               <TouchableOpacity
                 style={[
                   styles.eventRow,
                   { backgroundColor: colors.card, borderColor: colors.border },
                 ]}
                 onPress={() => toggleFeatured(item.id)}
                 activeOpacity={0.8}
               >
                <View style={styles.eventIcon}>
                  <HazardSymbolIcon
                    eventType={item.id}
                    fallbackIcon={item.icon}
                    size={20}
                    color={isSelected ? '#FF0000' : colors.textSecondary}
                  />
                </View>
                <View style={styles.eventBody}>
                  <Text style={[styles.eventLabel, { color: colors.text }]}>
                    {resolveEventLabel(item)}
                  </Text>
                  <Text style={[styles.eventStatus, { color: colors.textSecondary }]}>
                    {statusText}
                  </Text>
                  {canOpenOfficialSources ? (
                    <TouchableOpacity
                      style={[
                        styles.sourceLink,
                        { borderColor: colors.border, backgroundColor: colors.background },
                      ]}
                      onPress={() => {
                        if (sourceUrl) {
                          navigation.navigate('WebView', {
                            url: sourceUrl,
                            title: t('official_sources_title'),
                          });
                          return;
                        }
                        openOfficialSources();
                      }}
                      activeOpacity={0.8}
                    >
                      <Icon name="open-in-new" size={14} color={colors.textSecondary} />
                      <Text style={[styles.sourceLinkText, { color: colors.textSecondary }]}>
                        {sourceUrl
                          ? t('alert_details_view_source')
                          : t('official_sources_open_screen')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {isPandemic || isEpidemic ? (
                    <TouchableOpacity
                      style={[
                        styles.sourceLink,
                        { borderColor: colors.border, backgroundColor: colors.background },
                      ]}
                      onPress={() =>
                        navigation.navigate('EpidemicMap', {
                          mode: isPandemic ? 'pandemic' : 'epidemic',
                        })
                      }
                      activeOpacity={0.8}
                    >
                      <Icon name="map" size={14} color={colors.textSecondary} />
                      <Text style={[styles.sourceLinkText, { color: colors.textSecondary }]}>
                        {t('epidemic_map_open_map')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Icon
                  name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={isSelected ? '#FF0000' : colors.textSecondary}
                />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
  },
  title: { fontSize: 22, fontWeight: '800' },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subtitle: { fontSize: 13, lineHeight: 18 },
  sectionCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  sectionHint: { fontSize: 12 },
  featuredGrid: { gap: 10 },
  featuredItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  featuredLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  eventIcon: { width: 32, alignItems: 'center' },
  eventBody: { flex: 1, marginRight: 8 },
  eventLabel: { fontSize: 14, fontWeight: '600' },
  eventStatus: { fontSize: 12, marginTop: 2 },
  sourceLink: {
    alignSelf: 'flex-start',
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  sourceLinkText: { fontSize: 12, fontWeight: '700' },
});

export default MonitoringScreen;
