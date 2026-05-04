import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLocales } from 'react-native-localize';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { MONITORING_EVENTS } from '../../constants/MonitoringEvents';
import { GetRealtimeInsightsSnapshotQuery } from '../../application/queries/GetRealtimeInsightsSnapshotQuery';
import type { EpidemicMode, EpidemicSnapshot } from '../../services/EpidemicService';
import { TelemetryService } from '../../services/TelemetryService';
import { RealtimeSeriesChart, RealtimeSeriesPoint } from '../../components/realtime/RealtimeSeriesChart';
import { RealtimeMapOverlayLayer } from '../../components/realtime/RealtimeMapOverlayLayer';
import {
  formatUpdatedAtDisplay,
  isInvalidFormattedDateLike,
  isNativeDateStringLike,
  normalizeToIsoDateTime,
  resolveLocale,
  resolveTimeZone,
} from '../../utils/dateTimeFormat';

type RealtimeViewMode = 'map' | 'chart';
type ChartMetric = 'cases' | 'deaths';
type ChartInterval = '24h' | '7d' | '30d' | '1y';
type GeoLevel = 'municipality' | 'state' | 'country';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const SERIES_CACHE = new Map<string, RealtimeSeriesPoint[]>();

const buildCategories = () => {
  const priority = ['pandemic', 'epidemic'];
  const front = MONITORING_EVENTS.filter(item => priority.includes(item.id));
  const rest = MONITORING_EVENTS.filter(item => !priority.includes(item.id));
  return [...front, ...rest];
};

const isEpidemicCategory = (id: string) => id === 'pandemic' || id === 'epidemic';
const toEpidemicMode = (id: string): EpidemicMode => (id === 'pandemic' ? 'pandemic' : 'epidemic');

const seriesKey = (
  mode: EpidemicMode,
  metric: ChartMetric,
  level: GeoLevel,
  lat?: number,
  lon?: number,
) => `${mode}:${metric}:${level}:${Math.round((lat || 0) * 100)}:${Math.round((lon || 0) * 100)}`;

const appendPoint = (list: RealtimeSeriesPoint[], point: RealtimeSeriesPoint) => {
  const ts = new Date(point.timestamp).toISOString();
  const next = [...list];
  const last = next[next.length - 1];
  if (last && String(last.timestamp).slice(0, 16) === ts.slice(0, 16)) {
    next[next.length - 1] = { timestamp: ts, value: point.value };
    return next;
  }
  next.push({ timestamp: ts, value: point.value });
  return next.slice(-500);
};

const filterByInterval = (points: RealtimeSeriesPoint[], interval: ChartInterval) => {
  const now = Date.now();
  const windowMs =
    interval === '24h'
      ? 24 * 60 * 60 * 1000
      : interval === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : interval === '30d'
          ? 30 * 24 * 60 * 60 * 1000
          : 365 * 24 * 60 * 60 * 1000;
  const min = now - windowMs;
  const filtered = points.filter(p => new Date(p.timestamp).getTime() >= min);
  return filtered.length ? filtered : points.slice(-24);
};

const summarizeSeries = (points: RealtimeSeriesPoint[]) => {
  if (!points.length) return null;
  const values = points.map(p => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const peak = points.find(p => p.value === max) || points[points.length - 1];
  return {
    max,
    min,
    last: points[points.length - 1].value,
    peak,
  };
};

const getLevelValue = (snapshot: EpidemicSnapshot | null, level: GeoLevel, metric: ChartMetric): number | null => {
  if (!snapshot) return null;
  const source =
    level === 'country' ? snapshot.country : level === 'state' ? snapshot.state : snapshot.municipal;
  const value = source?.[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const authorityLevelRank: Record<'municipal' | 'state' | 'federal' | 'WHO', number> = {
  municipal: 1,
  state: 2,
  federal: 3,
  WHO: 4,
};

const RealtimeInsightsScreen = ({ navigation, route }: any) => {
  const { colors } = useTheme();
  const { securityState } = useSecurity();
  const { t, i18n } = useTranslation();

  const locale = resolveLocale(i18n.resolvedLanguage || i18n.language || getLocales()?.[0]?.languageTag);
  const timeZone = resolveTimeZone(
    typeof route?.params?.timeZone === 'string' ? route.params.timeZone : undefined,
  );
  const categories = useMemo(() => buildCategories(), []);
  const [selectedCategory, setSelectedCategory] = useState<string>(
    typeof route?.params?.defaultCategory === 'string' ? route.params.defaultCategory : 'pandemic',
  );
  const [viewMode, setViewMode] = useState<RealtimeViewMode>('map');
  const [metric, setMetric] = useState<ChartMetric>('cases');
  const [interval, setChartInterval] = useState<ChartInterval>('24h');
  const [geoLevel, setGeoLevel] = useState<GeoLevel>('municipality');
  const [snapshot, setSnapshot] = useState<EpidemicSnapshot | null>(null);
  const [chartPoints, setChartPoints] = useState<RealtimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncCompletedAt, setSyncCompletedAt] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasSnapshotLoadedRef = useRef(false);
  const invalidUpdatedAtTelemetryRef = useRef<string | null>(null);

  const userLat =
    typeof securityState.location?.latitude === 'number' ? securityState.location.latitude : null;
  const userLon =
    typeof securityState.location?.longitude === 'number' ? securityState.location.longitude : null;
  const hasUserLocation = userLat !== null && userLon !== null;
  const userLocation = useMemo(
    () => (hasUserLocation ? { latitude: userLat as number, longitude: userLon as number } : null),
    [hasUserLocation, userLat, userLon],
  );

  const category = categories.find(item => item.id === selectedCategory) || categories[0];
  const isEpidemic = isEpidemicCategory(selectedCategory);

  useEffect(() => {
    if (!isEpidemic && viewMode !== 'map') setViewMode('map');
    if (selectedCategory === 'epidemic' && geoLevel === 'country') setGeoLevel('municipality');
  }, [geoLevel, isEpidemic, selectedCategory, viewMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSnapshot = React.useCallback(
    async (force = false, options?: { silent?: boolean }) => {
      const silent = Boolean(options?.silent);
      if (!isEpidemic || !hasUserLocation || userLat === null || userLon === null) {
        if (mountedRef.current) {
          setSnapshot(null);
          setError(hasUserLocation ? null : t('map_no_location'));
          setLoading(false);
          setRefreshing(false);
          setSyncCompletedAt(null);
        }
        return;
      }
      if (!silent) {
        if (!hasSnapshotLoadedRef.current) setLoading(true);
        else if (force) setRefreshing(true);
      }
      try {
        const mode = toEpidemicMode(selectedCategory);
        const snap = await GetRealtimeInsightsSnapshotQuery.execute({
          latitude: userLat,
          longitude: userLon,
          mode,
          window: 'all',
          force,
        });
        if (!snap) {
          if (mountedRef.current) {
            setSnapshot(null);
            setError(t('common_try_again'));
          }
          return;
        }
        if (!mountedRef.current) return;
        const completedAt = normalizeToIsoDateTime(new Date()) || new Date().toISOString();
        setSnapshot(snap);
        setError(snap.message || null);
        setSyncCompletedAt(completedAt);
        hasSnapshotLoadedRef.current = true;

        const value = getLevelValue(snap, geoLevel, metric);
        const key = seriesKey(mode, metric, geoLevel, userLat, userLon);
        const currentList = SERIES_CACHE.get(key) || [];
        if (typeof value === 'number') {
          const nextList = appendPoint(currentList, {
            timestamp: snap.asOf || snap.fetchedAt || new Date().toISOString(),
            value,
          });
          SERIES_CACHE.set(key, nextList);
          setChartPoints(filterByInterval(nextList, interval));
        } else {
          setChartPoints(filterByInterval(currentList, interval));
        }
      } catch {
        if (mountedRef.current) setError(t('common_try_again'));
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [geoLevel, hasUserLocation, interval, isEpidemic, metric, selectedCategory, t, userLat, userLon],
  );

  useEffect(() => {
    if (!isEpidemic || !hasUserLocation) {
      setSnapshot(null);
      setChartPoints([]);
      return;
    }
    void loadSnapshot(false, { silent: false });
    const id = setInterval(() => {
      void loadSnapshot(false, { silent: true });
    }, 45_000);
    return () => clearInterval(id);
  }, [hasUserLocation, isEpidemic, loadSnapshot]);

  useEffect(() => {
    if (!isEpidemic || !hasUserLocation || userLat === null || userLon === null) return;
    const key = seriesKey(
      toEpidemicMode(selectedCategory),
      metric,
      geoLevel,
      userLat,
      userLon,
    );
    setChartPoints(filterByInterval(SERIES_CACHE.get(key) || [], interval));
  }, [geoLevel, hasUserLocation, interval, isEpidemic, metric, selectedCategory, userLat, userLon]);

  const levelOptions = useMemo(() => {
    const values = [
      {
        key: 'municipality' as GeoLevel,
        label: t('realtime_geo_municipality_district', { defaultValue: 'Município/Distrito' }),
        value: snapshot?.municipal?.name || t('epidemic_map_value_na'),
      },
      {
        key: 'state' as GeoLevel,
        label: t('realtime_geo_state_region', { defaultValue: 'Estado/Região' }),
        value: snapshot?.state?.name || t('epidemic_map_value_na'),
      },
    ];
    if (selectedCategory === 'pandemic') {
      values.push({
        key: 'country',
        label: t('epidemic_map_country_label'),
        value: snapshot?.country?.name || t('epidemic_map_value_na'),
      });
    }
    return values;
  }, [selectedCategory, snapshot, t]);

  const filteredSummary = useMemo(() => summarizeSeries(chartPoints), [chartPoints]);
  const lastUpdated =
    normalizeToIsoDateTime(snapshot?.asOf || snapshot?.fetchedAt) || syncCompletedAt;
  const formattedLastUpdated = formatUpdatedAtDisplay(lastUpdated, locale, timeZone);
  const lastUpdatedDisplay =
    formattedLastUpdated &&
    !isInvalidFormattedDateLike(formattedLastUpdated) &&
    !isNativeDateStringLike(formattedLastUpdated)
      ? formattedLastUpdated
      : '--';

  useEffect(() => {
    const rawUpdatedAt = String(lastUpdated || '').trim();
    if (!rawUpdatedAt || lastUpdatedDisplay !== '--') {
      invalidUpdatedAtTelemetryRef.current = null;
      return;
    }
    if (invalidUpdatedAtTelemetryRef.current === rawUpdatedAt) return;
    invalidUpdatedAtTelemetryRef.current = rawUpdatedAt;

    TelemetryService.trackEvent('realtime_insights_updated_at_invalid', {
      rawUpdatedAt,
      locale,
      timeZone,
      category: selectedCategory,
    });
  }, [lastUpdated, lastUpdatedDisplay, locale, selectedCategory, timeZone]);
  const officialSources = useMemo(
    () =>
      [...(snapshot?.sources || [])].sort((a, b) => {
        const tierDiff = a.tier - b.tier;
        if (tierDiff !== 0) return tierDiff;
        return (authorityLevelRank[b.authorityLevel] || 0) - (authorityLevelRank[a.authorityLevel] || 0);
      }),
    [snapshot?.sources],
  );
  const hasOfficialSourceData = Boolean(snapshot?.enabled) && officialSources.length > 0;
  const showTopPanelLoading = isEpidemic && loading && !snapshot;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {t('realtime_insights_title', { defaultValue: 'Dados em tempo real' })}
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('epidemic_map_updated_prefix')} {lastUpdatedDisplay}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconBtn, { borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => void loadSnapshot(true, { silent: false })}
          activeOpacity={0.85}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="refresh" size={18} color={colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {categories.map(item => {
          const active = item.id === selectedCategory;
          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedCategory(item.id)}
              activeOpacity={0.85}
            >
              <Icon name={item.icon} size={14} color={active ? '#fff' : colors.textSecondary} />
              <Text
                style={[styles.categoryChipText, { color: active ? '#fff' : colors.text }]}
                numberOfLines={1}
              >
                {t(`monitoring_event_${item.id}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isEpidemic ? (
        <View style={styles.primaryStage}>
          {viewMode === 'chart' ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {showTopPanelLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                    {t('epidemic_map_loading')}
                  </Text>
                </View>
              ) : null}

              {!hasOfficialSourceData ? (
                <View style={[styles.summaryBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.summaryTitle, { color: colors.text }]}>
                    {t('realtime_official_data_required_title', { defaultValue: 'Dados oficiais necessários' })}
                  </Text>
                  <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
                    {t('realtime_official_data_required_body', {
                      defaultValue:
                        'O gráfico só é exibido quando há fonte oficial disponível para a sua região.',
                    })}
                  </Text>
                </View>
              ) : (
                <>
                  <RealtimeSeriesChart
                    points={chartPoints}
                    color={colors.primary}
                    accentColor={colors.alert}
                    gridColor={colors.border}
                    textColor={colors.text}
                    mutedTextColor={colors.textSecondary}
                    locale={locale}
                    timeZone={timeZone}
                    metricLabel={`${t(`monitoring_event_${selectedCategory}`)} • ${metric === 'cases' ? t('epidemic_map_cases_short') : t('epidemic_map_deaths_short')}`}
                    title={t('realtime_chart_title', { defaultValue: 'Série temporal' })}
                    accessibilityLabel={t('realtime_chart_a11y_label', {
                      defaultValue: 'Gráfico temporal de dados epidemiológicos',
                    })}
                    timestampLabel={t('realtime_chart_timestamp_label', { defaultValue: 'Timestamp' })}
                    emptyLabel={t('common_no_data', { defaultValue: 'Sem dados' })}
                  />

                  <View style={[styles.summaryBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.summaryTitle, { color: colors.text }]}>
                      {t('realtime_chart_summary_title', { defaultValue: 'Resumo do gráfico' })}
                    </Text>
                    <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
                      {filteredSummary
                        ? t('realtime_chart_summary_body', {
                            defaultValue:
                              'Máximo: {{max}} • Mínimo: {{min}} • Atual: {{last}} • Pico: {{peak}}',
                            max: Number(filteredSummary!.max).toLocaleString(locale),
                            min: Number(filteredSummary!.min).toLocaleString(locale),
                            last: Number(filteredSummary!.last).toLocaleString(locale),
                            peak:
                              formatUpdatedAtDisplay(
                                filteredSummary!.peak.timestamp,
                                locale,
                                timeZone,
                              ) || '--',
                          })
                        : t('realtime_chart_collecting_points', {
                            defaultValue: 'Coletando pontos oficiais para compor o histórico em tempo real.',
                          })}
                    </Text>
                  </View>
                </>
              )}
            </View>
          ) : (
            <RealtimeMapOverlayLayer
              categoryId={selectedCategory}
              categoryLabel={t(`monitoring_event_${selectedCategory}`)}
              locale={locale}
              timeZone={timeZone}
              userLocation={userLocation}
              contextOnly
              updatedAtOverride={lastUpdated}
              colors={{
                background: colors.background,
                card: colors.card,
                border: colors.border,
                text: colors.text,
                textSecondary: colors.textSecondary,
                primary: colors.primary,
                alert: colors.alert,
                safe: colors.safe,
                riskMedium: colors.riskMedium,
              }}
              t={t}
            />
          )}
        </View>
      ) : null}

      {isEpidemic ? (
        <View style={[styles.controlsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.segmentRow}>
            {(['map', 'chart'] as RealtimeViewMode[]).map(mode => {
              const active = mode === viewMode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.segmentBtn,
                    {
                      backgroundColor: active ? colors.primary : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setViewMode(mode)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.segmentBtnText, { color: active ? '#fff' : colors.text }]}>
                    {mode === 'map'
                      ? t('realtime_view_map', { defaultValue: 'Mapa' })
                      : t('realtime_view_chart', { defaultValue: 'Gráfico' })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {levelOptions.map(option => {
              const active = geoLevel === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active ? `${colors.primary}16` : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setGeoLevel(option.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.filterPillTitle, { color: active ? colors.primary : colors.text }]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.filterPillSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {option.value}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.chipRowWrap}>
            {(['cases', 'deaths'] as ChartMetric[]).map(item => {
              const active = metric === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.smallChip,
                    {
                      backgroundColor: active ? `${colors.primary}16` : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setMetric(item)}
                >
                  <Text style={[styles.smallChipText, { color: active ? colors.primary : colors.text }]}>
                    {item === 'cases' ? t('epidemic_map_cases_short') : t('epidemic_map_deaths_short')}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {(['24h', '7d', '30d', '1y'] as ChartInterval[]).map(item => {
              const active = interval === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.smallChip,
                    {
                      backgroundColor: active ? `${colors.primary}16` : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                    onPress={() => setChartInterval(item)}
                >
                  <Text style={[styles.smallChipText, { color: active ? colors.primary : colors.text }]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {!isEpidemic && loading ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                {t('epidemic_map_loading')}
              </Text>
            </View>
          </View>
        ) : null}

        {false ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <RealtimeSeriesChart
              points={chartPoints}
              color={colors.primary}
              accentColor={colors.alert}
              gridColor={colors.border}
              textColor={colors.text}
              mutedTextColor={colors.textSecondary}
              locale={locale}
              timeZone={timeZone}
              metricLabel={`${t(`monitoring_event_${selectedCategory}`)} • ${metric === 'cases' ? t('epidemic_map_cases_short') : t('epidemic_map_deaths_short')}`}
              title={t('realtime_chart_title', { defaultValue: 'Série temporal' })}
              accessibilityLabel={t('realtime_chart_a11y_label', {
                defaultValue: 'Gráfico temporal de dados epidemiológicos',
              })}
              timestampLabel={t('realtime_chart_timestamp_label', { defaultValue: 'Timestamp' })}
              emptyLabel={t('common_no_data', { defaultValue: 'Sem dados' })}
            />

            <View style={[styles.summaryBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.summaryTitle, { color: colors.text }]}>
                {t('realtime_chart_summary_title', { defaultValue: 'Resumo do gráfico' })}
              </Text>
              <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
                {filteredSummary
                  ? t('realtime_chart_summary_body', {
                      defaultValue:
                        'Máximo: {{max}} • Mínimo: {{min}} • Atual: {{last}} • Pico: {{peak}}',
                      max: Number(filteredSummary!.max).toLocaleString(locale),
                      min: Number(filteredSummary!.min).toLocaleString(locale),
                      last: Number(filteredSummary!.last).toLocaleString(locale),
                      peak:
                        formatUpdatedAtDisplay(
                          filteredSummary!.peak.timestamp,
                          locale,
                          timeZone,
                        ) || '--',
                    })
                  : t('realtime_chart_collecting_points', {
                      defaultValue: 'Coletando pontos para compor o histórico em tempo real.',
                    })}
              </Text>
            </View>
          </View>
        ) : null}{!isEpidemic ? (
          <RealtimeMapOverlayLayer
            categoryId={selectedCategory}
            categoryLabel={t(`monitoring_event_${selectedCategory}`)}
            locale={locale}
            timeZone={timeZone}
            userLocation={userLocation}
            colors={{
              background: colors.background,
              card: colors.card,
              border: colors.border,
              text: colors.text,
              textSecondary: colors.textSecondary,
              primary: colors.primary,
              alert: colors.alert,
              safe: colors.safe,
              riskMedium: colors.riskMedium,
            }}
            t={t}
          />
        ) : null}

        {isEpidemic ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('epidemic_map_cases_title')}
            </Text>
            {error ? (
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
            ) : null}

            {levelOptions.map(option => {
              const isCountry = option.key === 'country';
              const level = isCountry ? snapshot?.country : option.key === 'state' ? snapshot?.state : snapshot?.municipal;
              return (
                <View key={option.key} style={[styles.statRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={styles.statHead}>
                    <Text style={[styles.statTitle, { color: colors.text }]}>{option.label}</Text>
                    <Text style={[styles.statPlace, { color: colors.textSecondary }]} numberOfLines={1}>
                      {option.value}
                    </Text>
                  </View>
                  <Text style={[styles.statText, { color: colors.text }]}>
                    {t('epidemic_map_cases_short')}: {typeof level?.cases === 'number' ? level.cases.toLocaleString(locale) : t('epidemic_map_value_na')} •{' '}
                    {t('epidemic_map_deaths_short')}: {typeof level?.deaths === 'number' ? level.deaths.toLocaleString(locale) : t('epidemic_map_value_na')}
                  </Text>
                </View>
              );
            })}

            <View style={[styles.sourceBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.sourceTitle, { color: colors.text }]}>
                {t('epidemic_map_sources_title', { defaultValue: 'Fontes oficiais' })}
              </Text>
              {officialSources.length ? (
                officialSources.slice(0, 4).map(source => (
                  <View key={`${source.name}-${source.url}`} style={styles.sourceRow}>
                    <Text style={[styles.sourceName, { color: colors.text }]} numberOfLines={1}>
                      {source.name}
                    </Text>
                    <Text style={[styles.sourceMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {`${source.authorityLevel.toUpperCase()} • ${t('realtime_source_official_label', {
                        defaultValue: 'Oficial',
                      })}`}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.sourceText, { color: colors.textSecondary }]}>
                  {t('epidemic_map_no_feed', {
                    defaultValue: 'Sem fonte oficial disponível para esta região no momento.',
                  })}
                </Text>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '800', fontFamily: FONT_FAMILY },
  headerSub: { fontSize: 11, fontWeight: '600', fontFamily: FONT_FAMILY },
  categoryRow: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    maxWidth: 220,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  categoryChipText: { fontSize: 12, fontWeight: '800', fontFamily: FONT_FAMILY, flexShrink: 1 },
  primaryStage: {
    marginHorizontal: ThemeTokens.spacing.lg,
    marginBottom: ThemeTokens.spacing.sm,
  },
  controlsCard: {
    marginHorizontal: ThemeTokens.spacing.lg,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.md,
    gap: ThemeTokens.spacing.sm,
  },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnText: { fontSize: 12, fontWeight: '900', fontFamily: FONT_FAMILY },
  filterRow: { gap: 8 },
  filterPill: {
    minWidth: 120,
    maxWidth: 180,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterPillTitle: { fontSize: 11, fontWeight: '800', fontFamily: FONT_FAMILY },
  filterPillSub: { fontSize: 10, fontWeight: '600', fontFamily: FONT_FAMILY, marginTop: 2 },
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: {
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallChipText: { fontSize: 11, fontWeight: '800', fontFamily: FONT_FAMILY },
  body: { flex: 1, marginTop: ThemeTokens.spacing.sm },
  bodyContent: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.xl + 16,
    gap: ThemeTokens.spacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.md,
    gap: ThemeTokens.spacing.sm,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, fontFamily: FONT_FAMILY },
  summaryBox: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.lg,
    padding: 12,
    gap: 6,
  },
  summaryTitle: { fontSize: 13, fontWeight: '800', fontFamily: FONT_FAMILY },
  summaryText: { fontSize: 12, lineHeight: 16, fontFamily: FONT_FAMILY },
  sectionTitle: { fontSize: 14, fontWeight: '800', fontFamily: FONT_FAMILY },
  errorText: { fontSize: 12, fontFamily: FONT_FAMILY },
  statRow: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.lg,
    padding: 12,
    gap: 6,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statTitle: { fontSize: 12, fontWeight: '800', fontFamily: FONT_FAMILY },
  statPlace: { flex: 1, textAlign: 'right', fontSize: 11, fontFamily: FONT_FAMILY },
  statText: { fontSize: 12, fontWeight: '700', fontFamily: FONT_FAMILY },
  sourceBox: { borderWidth: 1, borderRadius: ThemeTokens.radius.lg, padding: 12, gap: 4 },
  sourceTitle: { fontSize: 12, fontWeight: '800', fontFamily: FONT_FAMILY },
  sourceRow: {
    paddingTop: 6,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  sourceName: { fontSize: 12, fontWeight: '700', fontFamily: FONT_FAMILY },
  sourceMeta: { fontSize: 11, fontWeight: '600', fontFamily: FONT_FAMILY, marginTop: 2 },
  sourceText: { fontSize: 12, lineHeight: 16, fontFamily: FONT_FAMILY },
});

export default RealtimeInsightsScreen;
