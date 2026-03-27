import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  I18nManager,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../constants/ThemeTokens';
import LocaleService, { LanguagePreference } from '../services/LocaleService';
import { EntitlementService } from '../services/EntitlementService';
import { ConsentManager } from '../ads/ConsentManager';
import AdSlot from '../ads/AdSlot';
import AlertLogo from '../assets/logo.png';
import AppText from '../components/ui/AppText';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

interface ThemeOptionProps {
  readonly mode: 'light' | 'dark' | 'system';
  readonly icon: string;
  readonly label: string;
  readonly currentMode: string;
  readonly colors: any;
  readonly onSelect: (mode: 'light' | 'dark' | 'system') => void;
}

const ThemeOption: React.FC<ThemeOptionProps> = ({
  mode,
  icon,
  label,
  currentMode,
  colors,
  onSelect,
}) => {
  const isActive = currentMode === mode;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[
        styles.optionButton,
        isActive && {
          backgroundColor: colors.primary + '15',
          borderColor: colors.primary,
        },
      ]}
      onPress={() => onSelect(mode)}
    >
      <Icon
        name={icon}
        size={24}
        color={isActive ? colors.primary : colors.textSecondary}
      />
      <Text
        style={[
          styles.optionText,
          { color: colors.text },
          isActive && { color: colors.primary, fontWeight: '700' },
        ]}
      >
        {label}
      </Text>
      {isActive && (
        <Icon name="check-circle" size={20} color={colors.primary} />
      )}
    </TouchableOpacity>
  );
};

interface HeaderBackButtonProps {
  readonly onPress: () => void;
  readonly iconColor: string;
  readonly accessibilityLabel: string;
  readonly accessibilityHint: string;
}

const HeaderBackButton: React.FC<HeaderBackButtonProps> = ({
  onPress,
  iconColor,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const isRTL = I18nManager.isRTL;
  const iconName =
    Platform.select({
      ios: isRTL ? 'chevron-right' : 'chevron-left',
      default: isRTL ? 'arrow-right' : 'arrow-left',
    }) ?? (isRTL ? 'arrow-right' : 'arrow-left');
  const iconSize =
    Platform.OS === 'ios'
      ? ThemeTokens.typography.sizes.title + ThemeTokens.spacing.sm
      : ThemeTokens.typography.sizes.title;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.headerBackButton}
      activeOpacity={0.68}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
      testID="settings-back-button"
    >
      <Icon
        name={iconName}
        size={iconSize}
        color={iconColor}
        testID="settings-back-icon"
      />
    </TouchableOpacity>
  );
};

const SettingScreen: React.FC = ({ navigation }: any) => {
  const { themeMode, setThemeMode, colors } = useTheme();
  const { t } = useTranslation();
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('system');
  const [selectedLanguageLabel, setSelectedLanguageLabel] = useState('');
  const [isPremium, setIsPremium] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncLanguageLabel = useCallback(async () => {
    const stored = await LocaleService.getStoredLanguagePreference();
    if (!mountedRef.current) return;
    setLanguagePreference(stored);

    if (stored === 'system') {
      if (!mountedRef.current) return;
      setSelectedLanguageLabel(t('settings_language_auto'));
      return;
    }

    const localeMeta = LocaleService.getLocaleMeta(stored);
    if (!mountedRef.current) return;
    setSelectedLanguageLabel(localeMeta.nativeName);
  }, [t]);

  useEffect(() => {
    void syncLanguageLabel();
  }, [syncLanguageLabel]);

  const syncEntitlements = useCallback(async () => {
    try {
      const entitlements = await EntitlementService.getEntitlements();
      if (!mountedRef.current) return;
      setIsPremium(entitlements.isPremium);
    } catch {
      if (!mountedRef.current) return;
      setIsPremium(false);
    }
  }, []);

  useEffect(() => {
    void syncEntitlements();
  }, [syncEntitlements]);

  useEffect(() => {
    const unsubscribe = navigation.addListener?.('focus', () => {
      void syncLanguageLabel();
      void syncEntitlements();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation, syncEntitlements, syncLanguageLabel]);

  const handleOpenCrystalsKybesInfo = useCallback(() => {
    Alert.alert(
      t('settings_crystals_kybes_info_title'),
      t('settings_crystals_kybes_info_body'),
      [{ text: t('settings_crystals_kybes_info_cta') }],
    );
  }, [t]);

  const handleOpenAdsPrivacyOptions = useCallback(async () => {
    const opened = await ConsentManager.openPrivacyOptions();
    if (opened) return;
    Alert.alert(
      t('settings_ads_privacy_title'),
      t('settings_ads_privacy_unavailable'),
      [{ text: t('close') }],
    );
  }, [t]);

  const handleBackPress = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    const parentNavigation = navigation?.getParent?.();
    if (parentNavigation?.canGoBack?.()) {
      parentNavigation.goBack();
      return;
    }

    try {
      navigation?.dispatch?.(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        }),
      );
    } catch {
      try {
        navigation?.dispatch?.(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'FastHome' }],
          }),
        );
      } catch {
        // Safe no-op when settings is opened without a previous route in the stack.
      }
    }
  }, [navigation]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <HeaderBackButton
          onPress={handleBackPress}
          iconColor={colors.text}
          accessibilityLabel={t('common_back')}
          accessibilityHint={t('common_back_hint')}
        />
        <View style={styles.headerTitleWrap}>
          <AppText
            variant="title1"
            tone="default"
            accessibilityRole="header"
            style={[styles.headerTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {t('settings_title')}
          </AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.section, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
            {t('settings_account_security')}
          </Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Profile')}
          >
            <Icon name="account-circle" size={22} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]}>
              {t('settings_profile')}
            </Text>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Guardians')}
          >
            <Icon name="account-heart" size={22} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]}>
              {t('settings_guardians')}
            </Text>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('RouteSettings')}
          >
            <Icon name="map-marker-path" size={22} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]}>
              {t('settings_route_default')}
            </Text>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Checkout')}
          >
            <Image source={AlertLogo} style={styles.premiumLogo} resizeMode="contain" />
            <View style={styles.premiumRowTextWrap}>
              <Text style={[styles.linkText, { color: colors.text }]}>
                {t('settings_alert_premium')}
              </Text>
              <Text style={[styles.premiumHint, { color: colors.textSecondary }]}>
                {isPremium
                  ? t('settings_alert_premium_hint_active')
                  : t('settings_alert_premium_hint_free')}
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('History')}
          >
            <Icon name="history" size={22} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]}>
              {t('settings_history')}
            </Text>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
            {t('settings_appearance')}
          </Text>

          <ThemeOption
            mode="system"
            icon="cellphone-cog"
            label={t('settings_theme_system')}
            currentMode={themeMode}
            colors={colors}
            onSelect={setThemeMode}
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <ThemeOption
            mode="light"
            icon="white-balance-sunny"
            label={t('settings_theme_light')}
            currentMode={themeMode}
            colors={colors}
            onSelect={setThemeMode}
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />

          <ThemeOption
            mode="dark"
            icon="weather-night"
            label={t('settings_theme_dark')}
            currentMode={themeMode}
            colors={colors}
            onSelect={setThemeMode}
          />
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: colors.surface, marginTop: 24 },
          ]}
        >
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
            {t('settings_system')}
          </Text>

          <TouchableOpacity
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('settings_crystals_kybes')}
            accessibilityHint={t('settings_crystals_kybes_info_hint')}
            onPress={handleOpenCrystalsKybesInfo}
          >
            <View style={[styles.systemStatusCard, { backgroundColor: colors.primary + '12' }]}>
              <View style={styles.systemStatusMain}>
                <Icon name="shield-check" size={18} color={colors.primary} />
                <View style={styles.systemStatusTextWrap}>
                  <Text style={[styles.systemStatusTitle, { color: colors.text }]}>
                    {t('settings_crystals_kybes')}
                  </Text>
                  <Text style={[styles.systemStatusSubtitle, { color: colors.textSecondary }]}>
                    {t('settings_system_running')}
                  </Text>
                </View>
              </View>
              <View style={[styles.systemStatusPill, { backgroundColor: colors.primary + '24' }]}>
                <Text style={[styles.systemStatusPillText, { color: colors.primary }]}>
                  {t('settings_alert_active')}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <Text style={[styles.infoLabel, { color: colors.text, marginLeft: 16, marginTop: 14 }]}>
            {t('settings_language')}
          </Text>
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.languagePickerButton, { borderColor: colors.border }]}
            onPress={() => navigation.navigate('LanguageSelector')}
          >
            <View style={styles.languagePickerLeft}>
              <Icon name={languagePreference === 'system' ? 'web' : 'translate'} size={18} color={colors.textSecondary} />
              <Text style={[styles.languagePickerText, { color: colors.text }]}>
                {selectedLanguageLabel || t('settings_language_auto')}
              </Text>
            </View>
            <Icon name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <View
            style={[
              styles.separator,
              { backgroundColor: colors.border, marginLeft: 16 },
            ]}
          />

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => {
              void handleOpenAdsPrivacyOptions();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings_ads_privacy_title')}
            accessibilityHint={t('settings_ads_privacy_hint')}
          >
            <Icon name="shield-lock-outline" size={22} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]}>
              {t('settings_ads_privacy_title')}
            </Text>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <AdSlot placementId="settings_inline_banner" screenId="Settings" />
      </ScrollView>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.xs,
    paddingHorizontal: ThemeTokens.spacing.lg + ThemeTokens.spacing.xs,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.md,
  },
  headerBackButton: {
    width: ThemeTokens.SecurityMap.buttonMinSize - ThemeTokens.spacing.xs,
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    borderRadius: ThemeTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerTitle: {
    flexShrink: 1,
  },
  section: {
    borderRadius: 20,
    overflow: 'hidden',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(150,150,150,0.1)',
    marginBottom: 18,
  },
  sectionHeader: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    marginLeft: 16,
    marginBottom: 8,
    marginTop: 8,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    marginLeft: 12,
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 8,
    borderRadius: 12,
    gap: 12,
  },
  linkText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    flex: 1,
  },
  premiumLogo: {
    width: 22,
    height: 22,
  },
  premiumRowTextWrap: {
    flex: 1,
    gap: 2,
  },
  premiumHint: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
  },
  separator: {
    height: 1,
    marginLeft: 52,
    opacity: 0.3,
  },
  infoLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  systemStatusCard: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  systemStatusMain: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
    alignItems: 'center',
  },
  systemStatusTextWrap: { flex: 1 },
  systemStatusTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  systemStatusSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    marginTop: 2,
  },
  systemStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  systemStatusPillText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  languagePickerButton: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  languagePickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  languagePickerText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default SettingScreen;
