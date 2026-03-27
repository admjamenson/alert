import React from 'react';
import {
  FlatList,
  Platform,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import { PlaceSuggestion } from '../../services/maps';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type SearchResultsListProps = {
  results: PlaceSuggestion[];
  sections?: Array<{
    key: string;
    title: string;
    data: PlaceSuggestion[];
  }>;
  locale: string;
  onSelect: (item: PlaceSuggestion) => void;
};

const formatDistance = (value: number | undefined, locale: string) => {
  if (!Number.isFinite(value) || Number(value) <= 0) return '';
  const meters = Number(value);
  if (meters >= 1000) {
    const km = Math.round((meters / 1000) * 10) / 10;
    return `${km.toLocaleString(locale)} km`;
  }
  return `${Math.round(meters).toLocaleString(locale)} m`;
};

const SearchResultRow: React.FC<{
  item: PlaceSuggestion;
  locale: string;
  onSelect: (item: PlaceSuggestion) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}> = ({ item, locale, onSelect, colors }) => {
  const distance = formatDistance(item.distanceMeters, locale);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onSelect(item)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. ${item.address}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: `${colors.primary}1A` }]}>
        <Icon name="map-marker" size={16} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.address}
        </Text>
      </View>
      <Text style={[styles.distance, { color: colors.textSecondary }]}>{distance}</Text>
    </TouchableOpacity>
  );
};

export const SearchResultsList: React.FC<SearchResultsListProps> = ({
  results,
  sections,
  locale,
  onSelect,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const visibleSections = Array.isArray(sections)
    ? sections.filter(section => Array.isArray(section.data) && section.data.length > 0)
    : [];

  if (results.length === 0) {
    return (
      <View style={[styles.emptyWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {t('settings_route_destination_search_empty')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {visibleSections.length > 0 ? (
        <SectionList
          sections={visibleSections}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={8}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.card }]}>
              <Text style={[styles.sectionHeaderText, { color: colors.textSecondary }]}>
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <SearchResultRow item={item} locale={locale} onSelect={onSelect} colors={colors} />
          )}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={8}
          getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
          renderItem={({ item }) => (
            <SearchResultRow item={item} locale={locale} onSelect={onSelect} colors={colors} />
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    maxHeight: 280,
    overflow: 'hidden',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  sectionHeader: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontFamily: FONT_FAMILY,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: FONT_FAMILY,
    fontWeight: '800',
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: FONT_FAMILY,
    fontWeight: '600',
  },
  distance: {
    fontSize: 11,
    fontFamily: FONT_FAMILY,
    fontWeight: '700',
  },
  emptyWrap: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: FONT_FAMILY,
    fontWeight: '700',
  },
});

export default SearchResultsList;

