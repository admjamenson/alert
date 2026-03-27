import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../constants/ThemeTokens';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const ThemeSettings = ({ navigation }: any) => {
  const { themeMode, setThemeMode, isDark, colors } = useTheme();
  const { t } = useTranslation();

  const options = [
    { id: 'light', label: t('settings_theme_light'), icon: 'white-balance-sunny' },
    { id: 'dark', label: t('settings_theme_dark'), icon: 'weather-night' },
    { id: 'system', label: t('settings_theme_system'), icon: 'cellphone-cog' },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Icon name="arrow-left" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('theme_settings_title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>
          {t('theme_settings_choose')}
        </Text>

        {options.map(option => {
          const isSelected = themeMode === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.optionCard,
                {
                  backgroundColor: colors.card,
                  borderColor: isSelected ? colors.primary : 'transparent',
                },
              ]}
              onPress={() =>
                setThemeMode(option.id as 'light' | 'dark' | 'system')
              }
            >
              <View style={styles.optionInfo}>
                <Icon
                  name={option.icon}
                  size={24}
                  color={isSelected ? colors.primary : colors.text}
                />
                <Text style={[styles.optionLabel, { color: colors.text }]}>
                  {option.label}
                </Text>
              </View>

              {isSelected && (
                <Icon name="check-circle" size={24} color={colors.primary} />
              )}
            </TouchableOpacity>
          );
        })}

        <View style={styles.infoBox}>
          <Icon name="information-outline" size={20} color={colors.muted} />
          <Text style={[styles.infoText, { color: colors.muted }]}>
            {t('theme_settings_follow_device')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 15 },
  backBtn: { padding: 5 },
  headerTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
  },
  content: { padding: 20 },
  sectionLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    marginBottom: 15,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 22,
    borderRadius: 25,
    marginBottom: 15,
    borderWidth: 2,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  optionInfo: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  optionLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 10,
  },
  infoText: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
});

export default ThemeSettings;
