import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { getLocales } from 'react-native-localize';

import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { EpidemicService, EpidemicSnapshot, EpidemicWindow, EpidemicMode } from '../../services/EpidemicService';
import { TelemetryService } from '../../services/TelemetryService';
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

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

export const EpidemicMapScreen = ({ navigation, route }: any) => {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const { securityState } = useSecurity();

  const initialMode: EpidemicMode =
    route?.params?.mode === 'pandemic' || route?.params?.mode === 'epidemic'
      ? route.params.mode
      : 'epidemic';
  const [mode, setMode] = useState<EpidemicMode>(initialMode);

  const [window, setWindow] = useState<EpidemicWindow>('7d');
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<EpidemicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncCompletedAt, setSyncCompletedAt] = useState<string | null>(null);
  const invalidUpdatedAtTelemetryRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (route?.params?.mode === 'pandemic' || route?.params?.mode === 'epidemic') {
      setMode(route.params.mode);
    }
  }, [route?.params?.mode]);

  const localeTag = useMemo(
    () => resolveLocale(i18n.resolvedLanguage || i18n.language || getLocales()?.[0]?.languageTag),
    [i18n.language, i18n.resolvedLanguage],
  );
  const timeZone = useMemo(() => resolveTimeZone(), []);
  const lat = securityState.location?.latitude;
  const lon = securityState.location?.longitude;
  const hasLocation =
    canUseLocationForRiskMaps(securityState) && isFiniteCoordinatePair(lat, lon);

  const fmt = useCallback(
    (value: number | null) => {
      if (value === null || value === undefined) return t('epidemic_map_value_na');
      try {
        return value.toLocaleString(localeTag);
      } catch {
        return String(value);
      }
    },
    [localeTag, t],
  );

  const load = useCallback(
    async (force = false) => {
      if (!hasLocation || !isFiniteCoordinatePair(lat, lon)) {
        setSnapshot(null);
        setError(t('map_no_location'));
        setSyncCompletedAt(null);
        setLoading(false);
        return;
      }
      const safeLat = Number(lat);
      const safeLon = Number(lon);
      setLoading(true);
      setError(null);
      try {
        const res = await EpidemicService.getSnapshot(safeLat, safeLon, mode, window, { force });
        const completedAt = normalizeToIsoDateTime(new Date()) || new Date().toISOString();
        setSnapshot(res);
        setSyncCompletedAt(completedAt);
        if (res.status !== 'FRESH' && res.message) {
          setError(res.message);
        }
      } catch {
        setSnapshot(null);
        setError(t('common_try_again'));
      } finally {
        setLoading(false);
      }
    },
    [hasLocation, lat, lon, mode, t, window],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      void load(false);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [navigation, load]);

  const rows = useMemo(
    () => [
      {
        label: snapshot ? `${t('epidemic_map_city_label')}: ${snapshot.municipal.name}` : t('epidemic_map_city_label'),
        value: snapshot
          ? `${t('epidemic_map_cases_short')}: ${fmt(snapshot.municipal.cases)} | ${t(
              'epidemic_map_deaths_short',
            )}: ${fmt(snapshot.municipal.deaths)}`
          : t('epidemic_map_value_na'),
      },
      {
        label: snapshot ? `${t('epidemic_map_state_label')}: ${snapshot.state.name}` : t('epidemic_map_state_label'),
        value: snapshot
          ? `${t('epidemic_map_cases_short')}: ${fmt(snapshot.state.cases)} | ${t(
              'epidemic_map_deaths_short',
            )}: ${fmt(snapshot.state.deaths)}`
          : t('epidemic_map_value_na'),
      },
      {
        label: snapshot ? `${t('epidemic_map_country_label')}: ${snapshot.country.name}` : t('epidemic_map_country_label'),
        value: snapshot
          ? `${t('epidemic_map_cases_short')}: ${fmt(snapshot.country.cases)} | ${t(
              'epidemic_map_deaths_short',
            )}: ${fmt(snapshot.country.deaths)}`
          : t('epidemic_map_value_na'),
      },
    ],
    [fmt, snapshot, t],
  );

  const primarySource = snapshot?.sources?.[0];
  const sourcesLabel = useMemo(() => {
    const names = (snapshot?.sources || []).map(s => s.name).filter(Boolean);
    return names.slice(0, 3).join(', ');
  }, [snapshot?.sources]);

  const updatedLabel = useMemo(() => {
    if (!snapshot && !syncCompletedAt) return '--';
    const normalized =
      normalizeToIsoDateTime(snapshot?.asOf || snapshot?.fetchedAt) || syncCompletedAt || '';
    if (!normalized) return '--';
    const formatted = formatUpdatedAtDisplay(normalized, localeTag, timeZone);
    return formatted &&
      !isInvalidFormattedDateLike(formatted) &&
      !isNativeDateStringLike(formatted)
      ? formatted
      : '--';
  }, [localeTag, snapshot, syncCompletedAt, timeZone]);

  useEffect(() => {
    const rawUpdatedAt =
      normalizeToIsoDateTime(snapshot?.asOf || snapshot?.fetchedAt) || syncCompletedAt || '';
    if (!rawUpdatedAt || updatedLabel !== '--') {
      invalidUpdatedAtTelemetryRef.current = null;
      return;
    }
    if (invalidUpdatedAtTelemetryRef.current === rawUpdatedAt) return;
    invalidUpdatedAtTelemetryRef.current = rawUpdatedAt;

    TelemetryService.trackEvent('epidemic_map_updated_at_invalid', {
      mode,
      rawUpdatedAt,
      locale: localeTag,
      timeZone,
    });
  }, [localeTag, mode, snapshot, syncCompletedAt, timeZone, updatedLabel]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {mode === 'pandemic' ? t('epidemic_map_title_pandemic') : t('epidemic_map_title_epidemic')}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[
            styles.modeChip,
            {
              backgroundColor: mode === 'pandemic' ? colors.primary : colors.card,
              borderColor: mode === 'pandemic' ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setMode('pandemic')}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeChipText, { color: mode === 'pandemic' ? '#FFF' : colors.text }]}>
            {t('epidemic_map_filter_pandemic')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeChip,
            {
              backgroundColor: mode === 'epidemic' ? colors.primary : colors.card,
              borderColor: mode === 'epidemic' ? colors.primary : colors.border,
            },
          ]}
          onPress={() => setMode('epidemic')}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeChipText, { color: mode === 'epidemic' ? '#FFF' : colors.text }]}>
            {t('epidemic_map_filter_epidemic')}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTitleRow}>
          <Icon name="biohazard" size={18} color={colors.alert} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('epidemic_map_cases_title')}</Text>
        </View>
        {snapshot?.disease?.name ? (
          <Text style={[styles.diseaseText, { color: colors.textSecondary }]}>
            {t('epidemic_map_disease_label')}: {snapshot.disease.name}
          </Text>
        ) : null}

        <View style={styles.windowRow}>
          <TouchableOpacity
            style={[
              styles.windowChip,
              { borderColor: colors.border, backgroundColor: window === '7d' ? colors.background : 'transparent' },
            ]}
            onPress={() => setWindow('7d')}
            activeOpacity={0.85}
          >
            <Text style={[styles.windowChipText, { color: colors.text }]}>{t('epidemic_map_window_7d')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.windowChip,
              { borderColor: colors.border, backgroundColor: window === 'all' ? colors.background : 'transparent' },
            ]}
            onPress={() => setWindow('all')}
            activeOpacity={0.85}
          >
            <Text style={[styles.windowChipText, { color: colors.text }]}>{t('epidemic_map_window_total')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.refreshBtn, { borderColor: colors.border }]}
            onPress={() => load(true)}
            activeOpacity={0.85}
          >
            <Icon name="refresh" size={16} color={colors.textSecondary} />
            <Text style={[styles.refreshText, { color: colors.textSecondary }]}>{t('common_refresh')}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.cardHint, { color: colors.textSecondary }]}>{t('epidemic_map_loading')}</Text>
          </View>
        ) : error ? (
          <Text style={[styles.cardHint, { color: colors.textSecondary }]}>{error}</Text>
        ) : snapshot ? (
          <Text style={[styles.cardHint, { color: colors.textSecondary }]}>
            {t('epidemic_map_updated_prefix')} {updatedLabel}
          </Text>
        ) : (
          <Text style={[styles.cardHint, { color: colors.textSecondary }]}>{t('epidemic_map_no_feed')}</Text>
        )}

        <View style={styles.rows}>
          {rows.map(row => (
            <View key={row.label} style={[styles.row, { borderColor: colors.border }]}>
              <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.rowValue, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sourceWrap}>
          <Icon name="shield-check" size={14} color={colors.textSecondary} />
          <Text style={[styles.sourceText, { color: colors.textSecondary }]} numberOfLines={2}>
            {t('epidemic_map_source_prefix', { source: sourcesLabel || t('epidemic_map_value_na') })}
          </Text>
        </View>

        {primarySource?.url ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() =>
              navigation.navigate('WebView', {
                url: primarySource.url,
                title: t('epidemic_map_sources_title'),
              })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>{t('epidemic_map_open_sources')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: ThemeTokens.spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  headerBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', fontFamily: FONT_FAMILY },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: ThemeTokens.spacing.md,
  },
  modeChip: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeChipText: { fontSize: 12, fontWeight: '900', fontFamily: FONT_FAMILY },
  card: {
    marginTop: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '900', fontFamily: FONT_FAMILY },
  diseaseText: { fontSize: 12, fontWeight: '700', marginBottom: 8, fontFamily: FONT_FAMILY },
  cardHint: { fontSize: 12, lineHeight: 16, fontFamily: FONT_FAMILY },
  windowRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' },
  windowChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  windowChipText: { fontSize: 12, fontWeight: '900', fontFamily: FONT_FAMILY },
  refreshBtn: {
    marginLeft: 'auto',
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshText: { fontSize: 12, fontWeight: '900', fontFamily: FONT_FAMILY },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  rows: { marginTop: 14, gap: 10 },
  row: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: { fontSize: 12, fontWeight: '800', fontFamily: FONT_FAMILY },
  rowValue: { fontSize: 12, fontWeight: '900', fontFamily: FONT_FAMILY },
  sourceWrap: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' },
  sourceText: { fontSize: 12, fontWeight: '700', flex: 1, fontFamily: FONT_FAMILY },
  primaryBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: ThemeTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFF', fontWeight: '900', fontFamily: FONT_FAMILY },
});

export default EpidemicMapScreen;
