import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLocales } from 'react-native-localize';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { GetOfficialSourcesSnapshotQuery } from '../../application/queries/GetOfficialSourcesSnapshotQuery';
import {
  OfficialSource,
  ResolvedSourcesByLevel,
  ResolvedSourcesLevel,
} from '../../types/officialSources';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const levelTranslationKey = (level: ResolvedSourcesLevel['level']) => {
  if (level === 'MUNICIPAL') return 'official_sources_level_municipal';
  if (level === 'STATE') return 'official_sources_level_state';
  return 'official_sources_level_country';
};

const officialityKey = (officiality: OfficialSource['officiality']) =>
  officiality === 'OFFICIAL'
    ? 'official_sources_badge_official'
    : officiality === 'VERIFIED'
      ? 'official_sources_badge_verified'
      : 'monitoring_source_reference_badge';

const officialityColors = (officiality: OfficialSource['officiality']) => {
  if (officiality === 'OFFICIAL') {
    return {
      bg: 'rgba(22,163,74,0.16)',
      fg: '#16A34A',
    };
  }
  if (officiality === 'VERIFIED') {
    return {
      bg: 'rgba(17,17,17,0.08)',
      fg: '#111111',
    };
  }
  return {
    bg: 'rgba(160,160,166,0.24)',
    fg: '#A0A0A6',
  };
};

const typeKey = (type: OfficialSource['type']) => {
  if (type === 'API') return 'official_sources_type_api';
  if (type === 'RSS') return 'official_sources_type_rss';
  return 'official_sources_type_web';
};

export const OfficialSourcesScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { securityState } = useSecurity();
  const { t, i18n } = useTranslation();

  const localeTag = getLocales()?.[0]?.languageTag || i18n.language || 'en-US';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedSourcesByLevel | null>(null);
  const [collapsed, setCollapsed] = useState<Record<ResolvedSourcesLevel['level'], boolean>>({
    MUNICIPAL: false,
    STATE: false,
    COUNTRY: false,
  });

  const formatDateTime = useCallback(
    (value: string | null | undefined) => {
      if (!value) return t('official_sources_updated_unknown');
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return t('official_sources_updated_unknown');
      try {
        return new Intl.DateTimeFormat(localeTag, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(date);
      } catch {
        return date.toISOString();
      }
    },
    [localeTag, t],
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      setError(null);
      const snapshot = await GetOfficialSourcesSnapshotQuery.execute({
        latitude: securityState.location?.latitude,
        longitude: securityState.location?.longitude,
        locale: localeTag,
        forceRefresh,
      });
      if (!snapshot.resolved) {
        setResolved(null);
        setError(
          snapshot.errorCode
            ? t(snapshot.errorCode)
            : t('official_sources_load_error'),
        );
        return;
      }
      setResolved(snapshot.resolved);
    },
    [localeTag, securityState.location?.latitude, securityState.location?.longitude, t],
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    load(false)
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const handleOpenSource = useCallback(
    (source: OfficialSource) => {
      navigation.navigate('WebView', {
        url: source.url,
        title: source.name,
      });
    },
    [navigation],
  );

  const handleViewDetails = useCallback(
    (source: OfficialSource) => {
      const details = [
        `${t('official_sources_badge_label')}: ${t(officialityKey(source.officiality))}`,
        `${t('official_sources_type_label')}: ${t(typeKey(source.type))}`,
        `${t('official_sources_trust_label')}: ${Math.round(source.trustScore * 100)}%`,
        `${t('official_sources_update_frequency')}: ${source.updateFrequency || t('official_sources_not_informed')}`,
        `${t('official_sources_updated_label')}: ${formatDateTime(source.lastCheckedAt)}`,
        source.jurisdictionNotes
          ? `${t('official_sources_jurisdiction_notes')}: ${source.jurisdictionNotes}`
          : '',
        source.notes ? `${t('official_sources_notes')}: ${source.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      Alert.alert(source.name, details);
    },
    [formatDateTime, t],
  );

  const headerStatus = useMemo(() => {
    if (!resolved) return '';
    return `${t('official_sources_registry_version')}: v${resolved.registryVersion}`;
  }, [resolved, t]);

  const toggleSection = useCallback((level: ResolvedSourcesLevel['level']) => {
    setCollapsed(prev => ({ ...prev, [level]: !prev[level] }));
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('official_sources_back')}
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.title, { color: colors.text }]}
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          accessibilityRole="header"
        >
          {t('official_sources_title')}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('official_sources_subtitle')}
      </Text>

      {headerStatus ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{headerStatus}</Text>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('official_sources_loading')}
          </Text>
        ) : error ? (
          <Text style={[styles.stateText, { color: colors.alert }]}>{error}</Text>
        ) : null}

        {!loading &&
          !error &&
          resolved?.levels.map(level => {
            const isCollapsed = collapsed[level.level];
            return (
              <View
                key={level.level}
                style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection(level.level)}
                  activeOpacity={0.85}
                  accessibilityRole="header"
                  accessibilityLabel={`${t(levelTranslationKey(level.level))}: ${level.jurisdictionName}`}
                >
                  <View style={styles.sectionHeaderText}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      {t(levelTranslationKey(level.level))}
                    </Text>
                    <Text style={[styles.sectionJurisdiction, { color: colors.textSecondary }]} numberOfLines={1}>
                      {level.jurisdictionName}
                    </Text>
                  </View>
                  <Icon
                    name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>

                {level.unavailableAtLevel ? (
                  <Text style={[styles.fallbackHint, { color: colors.textSecondary }]}>
                    {t('official_sources_level_fallback_hint')}
                  </Text>
                ) : null}

                {!isCollapsed &&
                  level.sources.map(source => (
                    <View
                      key={source.id}
                      style={[styles.sourceCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={t('official_sources_item_accessibility', {
                        name: source.name,
                        jurisdiction: level.jurisdictionName,
                        updatedAt: formatDateTime(source.lastCheckedAt),
                      })}
                    >
                      {/** officiality badge colors distinguish official/verified/reference */}
                      {(() => {
                        const officialityColor = officialityColors(source.officiality);
                        return (
                          <>
                      <View style={styles.sourceHeader}>
                        <Text style={[styles.sourceName, { color: colors.text }]} numberOfLines={1}>
                          {source.name}
                        </Text>
                        <View
                          style={[
                            styles.badge,
                            {
                              backgroundColor: officialityColor.bg,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              { color: officialityColor.fg },
                            ]}
                          >
                            {t(officialityKey(source.officiality))}
                          </Text>
                        </View>
                      </View>
                          </>
                        );
                      })()}

                      <Text style={[styles.sourceMeta, { color: colors.textSecondary }]}>
                        {t(typeKey(source.type))} | {t('official_sources_updated_label')} {formatDateTime(source.lastCheckedAt)}
                      </Text>

                      <View style={styles.actions}>
                        <TouchableOpacity
                          style={[
                            styles.actionBtn,
                            { backgroundColor: colors.card, borderColor: colors.border },
                          ]}
                          onPress={() => handleOpenSource(source)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={t('official_sources_open_source')}
                          accessibilityHint={source.name}
                        >
                          <Icon name="open-in-new" size={14} color={colors.textSecondary} />
                          <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                            {t('official_sources_open_source')}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.actionBtn,
                            { backgroundColor: colors.card, borderColor: colors.border },
                          ]}
                          onPress={() => handleViewDetails(source)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={t('official_sources_view_details')}
                          accessibilityHint={source.name}
                        >
                          <Icon name="information-outline" size={14} color={colors.textSecondary} />
                          <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                            {t('official_sources_view_details')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: ThemeTokens.spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: ThemeTokens.spacing.sm,
    marginBottom: ThemeTokens.spacing.sm,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: FONT_FAMILY,
  },
  content: {
    paddingTop: ThemeTokens.spacing.md,
    paddingBottom: ThemeTokens.spacing.xl,
    gap: ThemeTokens.spacing.md,
  },
  stateText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_FAMILY,
  },
  section: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.md,
    gap: ThemeTokens.spacing.sm,
  },
  sectionHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ThemeTokens.spacing.sm,
  },
  sectionHeaderText: { flex: 1, minWidth: 0 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  sectionJurisdiction: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: FONT_FAMILY,
  },
  fallbackHint: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT_FAMILY,
  },
  sourceCard: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.lg,
    padding: ThemeTokens.spacing.sm,
    gap: ThemeTokens.spacing.sm,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  sourceName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  badge: {
    paddingHorizontal: 8,
    minHeight: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  sourceMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT_FAMILY,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.sm,
  },
  actionBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});

export default OfficialSourcesScreen;

