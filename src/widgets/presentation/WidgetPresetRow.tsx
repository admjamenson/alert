import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import { WidgetCatalogItem } from '../application/queries/GetWidgetCatalogQuery';
import { WidgetPreviewModel } from '../application/queries/GetWidgetPreviewModelQuery';
import { WidgetPresetPreviewSurface } from './WidgetPresetPreviewSurface';

type Props = {
  item: WidgetCatalogItem;
  model: WidgetPreviewModel;
  selected: boolean;
  reduceMotion: boolean;
  onPress: () => void;
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

export const WidgetPresetRow = ({ item, model, selected, reduceMotion, onPress }: Props) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(selected ? 1 : 0.985)).current;

  useEffect(() => {
    Animated.timing(scaleAnim, {
      toValue: selected ? 1 : 0.985,
      duration: reduceMotion ? 0 : 140,
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, scaleAnim, selected]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[
          styles.touch,
          {
            borderColor: selected ? colors.primary : 'transparent',
            backgroundColor: colors.surface,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.formatLabel}`}
        accessibilityHint={t('widget_select_hint')}
        accessibilityState={{ selected }}
      >
        <WidgetPresetPreviewSurface
          variant={item.previewVariant}
          format={item.format}
          model={model}
          selected={selected}
        />
        <View style={styles.meta}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.size, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.formatLabel}
          </Text>
        </View>
        <View style={styles.right}>
          <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
            <Icon name={item.icon} size={18} color={colors.textSecondary} />
          </View>
          {selected ? (
            <View style={[styles.selectedBadge, { backgroundColor: `${colors.primary}20` }]}>
              <Icon name="check-circle" size={14} color={colors.primary} />
              <Text style={[styles.selectedText, { color: colors.primary }]}>
                {t('widget_selected_state')}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  touch: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  meta: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: FONT_FAMILY,
    fontWeight: '700',
    textAlign: 'center',
  },
  size: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: FONT_FAMILY,
    fontWeight: '500',
    textAlign: 'center',
  },
  right: {
    position: 'absolute',
    top: 12,
    right: 12,
    alignItems: 'flex-end',
    gap: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectedText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});
