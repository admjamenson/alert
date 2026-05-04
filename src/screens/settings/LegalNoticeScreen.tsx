import React from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from '../../components/ui/AppText';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../../constants/LegalText';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LegalNotice'>;

/**
 * LEGAL NOTICE SCREEN
 * Display's the application's Terms of Use and Privacy Policy.
 * Linked from Settings and Welcome screens.
 */

const LegalNoticeScreen = ({ navigation }: Props) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.backBtn, { borderColor: colors.border }]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('common_back')}
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <AppText variant="title2" weight="bold">
          {t('legal_terms_title')}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <AppText variant="headline" style={styles.sectionTitle}>
            {t('legal_terms_title')}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.legalBody}>
            {TERMS_OF_SERVICE}
          </AppText>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.section}>
          <AppText variant="headline" style={styles.sectionTitle}>
            {t('legal_privacy_title')}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.legalBody}>
            {PRIVACY_POLICY}
          </AppText>
        </View>

        <View style={styles.footer}>
          <AppText variant="caption2" tone="muted" style={styles.footerText}>
            {t('legal_footer_notice', { year: new Date().getFullYear() })}{'\n'}
            {t('legal_sos_disclaimer')}
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  backBtn: {
    padding: 8,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 60,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    marginBottom: 16,
    color: ThemeTokens.colors.light.primary,
  },
  legalBody: {
    lineHeight: 22,
    textAlign: 'left',
  },
  divider: {
    height: 1,
    width: '100%',
    marginVertical: 32,
    opacity: 0.3,
  },
  footer: {
    marginTop: 20,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default LegalNoticeScreen;

