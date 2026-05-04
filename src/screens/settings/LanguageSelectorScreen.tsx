import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { SupportedLocale, normalizeSearchTerm } from '../../constants/locales';
import { useTheme } from '../../context/ThemeContext';
import LocaleService, { LanguagePreference } from '../../services/LocaleService';

type ListRow =
  | { key: 'system'; type: 'system' }
  | { key: string; type: 'locale'; locale: SupportedLocale };

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const SEARCH_DEBOUNCE_MS = 180;

const LanguageSelectorScreen: React.FC = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedPreference, setSelectedPreference] = useState<LanguagePreference>('system');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(normalizeSearchTerm(query));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const preference = await LocaleService.getStoredLanguagePreference();
      if (!mounted) return;
      setSelectedPreference(preference);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const sortedLocales = useMemo(() => {
    const locale = i18n.language || 'en-US';
    return [...LocaleService.getAvailableLocales()].sort((a, b) =>
      a.nativeName.localeCompare(b.nativeName, locale, { sensitivity: 'base' }),
    );
  }, [i18n.language]);

  const filteredLocales = useMemo(() => {
    if (!debouncedQuery) return sortedLocales;
    return sortedLocales.filter(item => item.searchable.includes(debouncedQuery));
  }, [debouncedQuery, sortedLocales]);

  const rows = useMemo<ListRow[]>(() => {
    const localeRows = filteredLocales.map(locale => ({
      key: locale.code,
      type: 'locale' as const,
      locale,
    }));
    return [{ key: 'system', type: 'system' }, ...localeRows];
  }, [filteredLocales]);

  const handleSelect = useCallback(
    async (preference: LanguagePreference) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        await LocaleService.applyLanguage(preference);
        setSelectedPreference(preference);
        ReactNativeHapticFeedback.trigger('impactLight', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
        navigation.goBack();
      } finally {
        setSubmitting(false);
      }
    },
    [navigation, submitting],
  );

  const renderSearchHeader = useMemo(
    () => (
      <View style={[styles.searchHeaderWrap, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: isDark ? '#2A2A2E' : '#F2F2F7',
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="magnify" size={20} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('settings_language_search_placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('settings_language_search_placeholder')}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel={t('chat_clear_search')}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <Icon name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    ),
    [colors.border, colors.card, colors.text, colors.textSecondary, isDark, query, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListRow }) => {
      const isSystem = item.type === 'system';
      const isSelected = isSystem
        ? selectedPreference === 'system'
        : selectedPreference === item.locale.code;

      const title = isSystem ? t('settings_language_auto') : item.locale.nativeName;
      const subtitle = isSystem
        ? LocaleService.getLocaleMeta(LocaleService.getDeviceLocaleCode()).nativeName
        : item.locale.englishName !== item.locale.nativeName
          ? item.locale.englishName
          : item.locale.code;
      const shortLabel = isSystem ? 'AUTO' : item.locale.shortLabel;

      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => void handleSelect(isSystem ? 'system' : item.locale.code)}
          style={[
            styles.itemRow,
            {
              borderColor: isSelected ? colors.primary : colors.border,
              backgroundColor: isSelected ? `${colors.primary}14` : 'transparent',
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${t('settings_language')}: ${title}`}
          accessibilityState={{ selected: isSelected }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          disabled={submitting}
        >
          <View style={[styles.localeBadge, { backgroundColor: isSelected ? colors.primary : `${colors.textSecondary}24` }]}>
            {isSystem ? (
              <Icon name="web" size={14} color={isSelected ? '#FFFFFF' : colors.textSecondary} />
            ) : (
              <Text style={[styles.localeBadgeText, { color: isSelected ? '#FFFFFF' : colors.textSecondary }]}>
                {shortLabel}
              </Text>
            )}
          </View>

          <View style={styles.localeTextWrap}>
            <Text style={[styles.localeName, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.localeMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>

          {isSelected ? (
            <View style={styles.checkWrap}>
              <Icon name="check" size={20} color={colors.primary} />
              <Text style={[styles.selectedText, { color: colors.primary }]}>{t('settings_language_selected')}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    },
    [
      colors.border,
      colors.primary,
      colors.text,
      colors.textSecondary,
      handleSelect,
      selectedPreference,
      submitting,
      t,
    ],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Pressable
        accessibilityLabel={t('close')}
        accessibilityRole="button"
        style={[
          styles.overlay,
          { backgroundColor: isDark ? 'rgba(2,4,10,0.58)' : 'rgba(8,13,24,0.34)' },
        ]}
        onPress={() => navigation.goBack()}
      />
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? colors.card : '#FFFFFF',
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>{t('settings_language_picker_title')}</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          >
            <Icon name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={rows}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          ListHeaderComponent={renderSearchHeader}
          stickyHeaderIndices={[0]}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={24}
          windowSize={11}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: ThemeTokens.spacing.lg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: '78%',
    overflow: 'hidden',
    ...Platform.select({
      ios: ThemeTokens.shadows.strong.ios,
      android: ThemeTokens.shadows.strong.android,
    }),
  },
  headerRow: {
    minHeight: 54,
    paddingHorizontal: ThemeTokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.bold,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHeaderWrap: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  searchBar: {
    minHeight: 48,
    borderRadius: ThemeTokens.radius.md,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.medium,
    paddingVertical: 0,
  },
  clearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: ThemeTokens.spacing.md,
  },
  itemRow: {
    minHeight: 56,
    borderRadius: ThemeTokens.radius.md,
    borderWidth: 1,
    marginHorizontal: ThemeTokens.spacing.lg,
    marginBottom: ThemeTokens.spacing.sm,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  localeBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localeBadgeText: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.bold,
  },
  localeTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  localeName: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.semibold,
  },
  localeMeta: {
    marginTop: 2,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.medium,
  },
  checkWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  selectedText: {
    marginTop: 1,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.semibold,
  },
});

export default LanguageSelectorScreen;
