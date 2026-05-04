import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import CountryCatalogService, {
  CountryCatalogItem,
} from '../../services/CountryCatalogService';
import AppText from '../ui/AppText';
import { getTypographyStyle } from '../../theme/typography';
import BasePopup from '../ui/BasePopup';

const SEARCH_DEBOUNCE_MS = 200;

export type GlobalCountrySelection = {
  cca2: string;
  name: string;
  callingCode: string;
  flag: string;
};

type GlobalCountryPickerProps = {
  visible: boolean;
  selectedCountryCode: string;
  onClose: () => void;
  onSelect: (payload: GlobalCountrySelection) => void;
};

const getItemLayout = (_: unknown, index: number) => ({
  length: 58,
  offset: 58 * index,
  index,
});

const GlobalCountryPicker: React.FC<GlobalCountryPickerProps> = ({
  visible,
  selectedCountryCode,
  onClose,
  onSelect,
}) => {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [countries, setCountries] = useState<CountryCatalogItem[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    setLoading(true);
    void CountryCatalogService.getCountries(i18n.language)
      .then(items => {
        if (!mounted) return;
        setCountries(items);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [i18n.language, visible]);

  const filteredCountries = useMemo(
    () => CountryCatalogService.filterCountries(countries, debouncedQuery),
    [countries, debouncedQuery],
  );

  const handleSelect = useCallback(
    (item: CountryCatalogItem) => {
      onSelect({
        cca2: item.cca2,
        name: item.name,
        callingCode: item.callingCode,
        flag: item.flag,
      });
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: { item: CountryCatalogItem }) => {
      const selected = item.cca2 === selectedCountryCode;
      return (
        <TouchableOpacity
          activeOpacity={0.82}
          style={[
            styles.countryItem,
            {
              backgroundColor: selected ? `${colors.primary}14` : 'transparent',
            },
          ]}
          onPress={() => handleSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={`${t('country_picker_title')}: ${item.name}, +${item.callingCode}`}
          accessibilityState={{ selected }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.countryMain}>
            <AppText style={styles.flag} allowFontScaling={false}>
              {item.flag || '?'}
            </AppText>
            <AppText
              variant="callout"
              style={[styles.countryName, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.name}
            </AppText>
          </View>
          <View style={styles.countryRight}>
            <AppText
              variant="label"
              style={[styles.callingCode, { color: colors.textSecondary }]}
            >
              +{item.callingCode}
            </AppText>
            {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
          </View>
        </TouchableOpacity>
      );
    },
    [
      colors.primary,
      colors.text,
      colors.textSecondary,
      handleSelect,
      selectedCountryCode,
      t,
    ],
  );

  return (
    <BasePopup
      accessibilityLabel={t('country_picker_title')}
      avoidKeyboard
      contentStyle={[
        styles.card,
        {
          backgroundColor: isDark ? colors.card : '#FFFFFF',
          borderColor: colors.border,
        },
      ]}
      maxWidth={560}
      onClose={onClose}
      placement="center"
      visible={visible}
    >
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchInputWrap,
            {
              backgroundColor: isDark ? '#2B2B30' : '#F5F5F7',
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="magnify" size={22} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('country_picker_search')}
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="default"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              accessibilityLabel={t('chat_clear_search')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={filteredCountries}
        keyExtractor={item => item.cca2}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        maxToRenderPerBatch={24}
        windowSize={11}
        ListEmptyComponent={
          <AppText variant="subhead" style={[styles.emptyText, { color: colors.textSecondary }]}>
            {loading ? t('country_picker_loading') : t('country_picker_no_results')}
          </AppText>
        }
      />
    </BasePopup>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    minHeight: 440,
    maxHeight: '86%',
    padding: 0,
  },
  searchWrap: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  searchInputWrap: {
    minHeight: 48,
    borderRadius: ThemeTokens.radius.md,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  searchInput: {
    ...getTypographyStyle('input'),
    flex: 1,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: ThemeTokens.spacing.md,
  },
  countryItem: {
    minHeight: 56,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countryMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flag: {
    fontSize: 28,
    lineHeight: 30,
  },
  countryName: {
    flex: 1,
  },
  countryRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: ThemeTokens.spacing.md,
    gap: 2,
  },
  callingCode: {},
  emptyText: {
    textAlign: 'center',
    paddingVertical: ThemeTokens.spacing.xl,
  },
});

export default GlobalCountryPicker;
