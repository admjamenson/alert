import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  count: number;
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

export const WidgetPickerHeader = ({ count }: Props) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <View style={[styles.handle, { backgroundColor: colors.border }]} />
      <View style={styles.row}>
        <View style={styles.left}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <Text style={[styles.appName, { color: colors.text }]}>
            {t('widgets_picker_app_name')}
          </Text>
        </View>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {t('widgets_picker_count', { count, defaultValue: String(count) })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 999,
    opacity: 0.9,
    marginBottom: 12,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  count: {
    fontSize: 18,
    fontWeight: '500',
    fontFamily: FONT_FAMILY,
  },
});
