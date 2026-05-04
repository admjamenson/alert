import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../constants/LegalText';
import { ProfileService } from '../../services/ProfileService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceLanguage, loadStoredLanguage, setStoredLanguage } from '../../i18n';
import { useTheme } from '../../context/ThemeContext';
import { AppModal } from '../../components/ui/AppModal';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from '../../components/ui/AppText';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const ONBOARDING_KEY = '@Alert:OnboardingComplete';

const WelcomeScreen = ({ navigation }: Props) => {
  const { t } = useTranslation();
  const { colors, themeMode } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [modalContent, setModalContent] = useState<'privacy' | 'terms'>(
    'privacy',
  );
  const [languageMode, setLanguageMode] = useState<'system' | 'pt' | 'en'>(
    'system',
  );
  const { width } = Dimensions.get('window');

  const deviceLang = getDeviceLanguage();
  const deviceLangLabel =
    deviceLang.toLowerCase().startsWith('pt')
      ? t('settings_language_pt')
      : t('settings_language_en');
  const systemLangLabel = t('settings_language_system', { lang: deviceLangLabel });
  const [termsAccepted, setTermsAccepted] = useState(false);

  const openModal = (type: 'privacy' | 'terms') => {
    setModalContent(type);
    setModalVisible(true);
  };

  const triggerLightHaptic = useCallback(() => {
    try {
      const moduleRef = require('react-native-haptic-feedback');
      const ReactNativeHapticFeedback = moduleRef.default || moduleRef;
      ReactNativeHapticFeedback.trigger(ThemeTokens.haptics.light);
    } catch {
      // Ignore haptic failures to keep onboarding smooth.
    }
  }, []);

  useEffect(() => {
    const checkProfile = async () => {
      const profile = await ProfileService.getProfile();
      const onboardingDone = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (profile?.name || onboardingDone === 'true') {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    };
    void checkProfile();
  }, [navigation]);

  useEffect(() => {
    const load = async () => {
      const stored = await loadStoredLanguage();
      const normalized = String(stored || '').toLowerCase();
      if (normalized.startsWith('pt')) {
        setLanguageMode('pt');
      } else if (normalized.startsWith('en')) {
        setLanguageMode('en');
      } else {
        setLanguageMode('system');
      }
    };
    void load();
  }, []);

  const LanguageSelector = () => (
    <View style={styles.languageBlock}>
      <AppText variant="caption1" tone="secondary" style={styles.languageLabel}>
        {t('welcome_language_label')}
      </AppText>
      <View style={styles.languageRow}>
        <TouchableOpacity
          style={[
            styles.languageChip,
            languageMode === 'system' && styles.languageChipActive,
          ]}
          onPress={() => {
            setLanguageMode('system');
            void setStoredLanguage('system');
          }}
        >
          <AppText
            variant="caption1"
            style={[
              styles.languageText,
              languageMode === 'system' && styles.languageTextActive,
            ]}
          >
            {systemLangLabel}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.languageChip,
            languageMode === 'pt' && styles.languageChipActive,
          ]}
          onPress={() => {
            setLanguageMode('pt');
            void setStoredLanguage('pt');
          }}
        >
          <AppText
            variant="caption1"
            style={[
              styles.languageText,
              languageMode === 'pt' && styles.languageTextActive,
            ]}
          >
            {t('settings_language_pt')}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.languageChip,
            languageMode === 'en' && styles.languageChipActive,
          ]}
          onPress={() => {
            setLanguageMode('en');
            void setStoredLanguage('en');
          }}
        >
          <AppText
            variant="caption1"
            style={[
              styles.languageText,
              languageMode === 'en' && styles.languageTextActive,
            ]}
          >
            {t('settings_language_en')}
          </AppText>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        <View style={[styles.page, { width }]}>
          <View style={styles.content}>
            <View style={styles.imageContainer}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.textSection}>
              <AppText
                variant="title1"
                tone="default"
                style={[styles.title, { color: colors.text }]}
              >
                {t('welcome_title')}
              </AppText>
              <LanguageSelector />

              <View style={styles.termsContainer}>
                <AppText
                  variant="footnote"
                  tone="secondary"
                  style={[styles.termsText, { color: colors.textSecondary }]}
                >
                  {t('welcome_terms_prefix')}{' '}
                  <AppText
                    variant="footnote"
                    tone="primary"
                    weight="semibold"
                    style={[styles.link, { color: colors.primary }]}
                    onPress={() => openModal('privacy')}
                  >
                    {t('welcome_privacy')}
                  </AppText>
                  . {t('welcome_terms_suffix')}{' '}
                  <AppText
                    variant="footnote"
                    tone="primary"
                    weight="semibold"
                    style={[styles.link, { color: colors.primary }]}
                    onPress={() => openModal('terms')}
                  >
                    {t('welcome_terms')}
                  </AppText>
                  .
                </AppText>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: colors.primary },
                ThemeTokens.shadows.soft.ios,
              ]}
              onPress={async () => {
                triggerLightHaptic();
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                navigation.navigate('Login');
              }}
              activeOpacity={0.8}
            >
              <AppText variant="button" tone="inverse" style={styles.buttonText}>
                {t('welcome_agree')}
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                triggerLightHaptic();
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              }}
              activeOpacity={0.7}
              style={styles.linkButton}
            >
              <AppText
                variant="body"
                tone="primary"
                weight="semibold"
                style={[styles.link, { color: colors.primary }]}
              >
                {t('welcome_enter_now')}
              </AppText>
            </TouchableOpacity>

            <AppText
              variant="caption1"
              tone="secondary"
              style={[styles.swipeHint, { color: colors.textSecondary }]}
            >
              {t('welcome_swipe_hint')}
            </AppText>
          </View>
        </View>

        <View style={[styles.page, { width }]}>
          <View style={styles.content}>
            <View style={styles.imageContainer}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.textSection}>
              <AppText
                variant="title1"
                tone="default"
                style={[styles.title, { color: colors.text }]}
              >
                {t('welcome_ready_title')}
              </AppText>
              <AppText
                variant="body"
                tone="secondary"
                style={[styles.subtitle, { color: colors.textSecondary }]}
              >
                {t('welcome_ready_subtitle')}
              </AppText>
            </View>

            <TouchableOpacity
              style={[styles.complianceRow]}
              activeOpacity={0.7}
              onPress={() => setTermsAccepted(!termsAccepted)}
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: termsAccepted ? colors.primary : colors.border },
                  termsAccepted && { backgroundColor: colors.primary },
                ]}
              >
                {termsAccepted && <Icon name="check" size={14} color="#FFFFFF" />}
              </View>
              <AppText variant="caption1" tone="secondary" style={styles.complianceText}>
                {t('legal_terms_acceptance_label')}
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: termsAccepted ? 1 : 0.5,
                },
                ThemeTokens.shadows.soft.ios,
              ]}
              onPress={async () => {
                if (!termsAccepted) return;
                triggerLightHaptic();
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              }}
              activeOpacity={0.8}
              disabled={!termsAccepted}
            >
              <AppText variant="button" tone="inverse" style={styles.buttonText}>
                {t('welcome_enter_now')}
              </AppText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                if (!termsAccepted) return;
                triggerLightHaptic();
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                navigation.navigate('Login');
              }}
              activeOpacity={0.7}
              style={[styles.linkButton, { opacity: termsAccepted ? 1 : 0.5 }]}
              disabled={!termsAccepted}
            >
              <AppText
                variant="body"
                tone="primary"
                weight="semibold"
                style={[styles.link, { color: colors.primary }]}
              >
                {t('welcome_have_account')}
              </AppText>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <AppModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={modalContent === 'privacy' ? t('welcome_privacy') : t('welcome_terms')}
      >
        <ScrollView
          style={styles.legalScroll}
          contentContainerStyle={styles.modalScroll}
          showsVerticalScrollIndicator={false}
        >
          <AppText
            variant="modalBody"
            tone="secondary"
            style={[styles.legalBodyText, { color: colors.textSecondary }]}
          >
            {modalContent === 'privacy' ? PRIVACY_POLICY : TERMS_OF_SERVICE}
          </AppText>
        </ScrollView>

        <TouchableOpacity
          style={[styles.modalButton, { backgroundColor: colors.primary }]}
          onPress={() => setModalVisible(false)}
          activeOpacity={0.85}
        >
          <AppText variant="modalAction" tone="inverse" style={styles.modalButtonText}>
            {t('close')}
          </AppText>
        </TouchableOpacity>
      </AppModal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  page: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.xl + ThemeTokens.spacing.sm,
    paddingVertical: ThemeTokens.spacing.xxxl,
  },
  imageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoImage: {
    width: 220,
    height: 220,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  textSection: { alignItems: 'center', width: '100%', marginBottom: 20 },
  title: { marginBottom: ThemeTokens.spacing.md, textAlign: 'center' },
  termsContainer: { paddingHorizontal: 10, marginTop: 8 },
  termsText: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  link: {},
  linkButton: { marginTop: ThemeTokens.spacing.md },
  button: {
    width: '100%',
    paddingVertical: ThemeTokens.spacing.md + ThemeTokens.spacing.xs,
    borderRadius: ThemeTokens.radius.pill,
    alignItems: 'center',
    ...ThemeTokens.shadows.soft.android,
  },
  buttonText: {},
  swipeHint: { marginTop: ThemeTokens.spacing.sm },
  legalScroll: { maxHeight: 520 },
  modalScroll: { paddingVertical: ThemeTokens.spacing.md },
  legalBodyText: {},
  modalButton: {
    height: 46,
    borderRadius: ThemeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: ThemeTokens.spacing.md,
  },
  modalButtonText: {},
  languageBlock: { alignItems: 'center' },
  languageLabel: {
    marginBottom: ThemeTokens.spacing.sm,
  },
  languageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.sm,
    justifyContent: 'center',
  },
  languageChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: ThemeTokens.spacing.xs + 2,
    paddingHorizontal: ThemeTokens.spacing.md,
  },
  languageChipActive: {
    backgroundColor: '#00000000',
  },
  languageText: {},
  languageTextActive: {},
  complianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: ThemeTokens.spacing.lg,
    paddingHorizontal: 10,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  complianceText: {
    flex: 1,
    lineHeight: 18,
  },
});

export default WelcomeScreen;
