import React, { useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from '../../components/ui/AppText';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const AdPrivacyScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Settings');
  }, [navigation]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={[
            styles.headerButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common_back')}
          accessibilityHint={t('common_back_hint')}
        >
          <Icon name="chevron-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <AppText
          variant="title1"
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {t('ads_privacy_title')}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={t('ads_privacy_title')}
        >
          <AppText
            variant="headline"
            tone="default"
            style={[styles.cardTitle, { color: colors.text }]}
          >
            {t('ads_privacy_title')}
          </AppText>

          <AppText variant="body" tone="default" style={styles.paragraph}>
            {t('ads_privacy_body_1')}
          </AppText>
          <AppText variant="body" tone="default" style={styles.paragraph}>
            {t('ads_privacy_body_2')}
          </AppText>
          <AppText variant="body" tone="default" style={styles.paragraph}>
            {t('ads_privacy_body_3')}
          </AppText>
          <View style={styles.closingWrap}>
            <AppText variant="callout" tone="default" style={styles.closingText}>
              {t('ads_privacy_closing')}
            </AppText>
          </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingTop: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.md,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  headerSpacer: {
    width: 42,
    height: 42,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT_FAMILY,
  },
  scrollContent: {
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingBottom: ThemeTokens.spacing.xxl,
  },
  card: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    padding: ThemeTokens.spacing.xl,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  cardTitle: {
    marginBottom: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
  },
  paragraph: {
    marginBottom: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
  },
  closingWrap: {
    marginTop: ThemeTokens.spacing.sm,
    paddingTop: ThemeTokens.spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  closingText: {
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
  },
});

export default AdPrivacyScreen;
