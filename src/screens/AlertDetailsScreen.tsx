/**
 * ALERT DETAILS SCREEN
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../constants/ThemeTokens';
import { RootStackParamList } from '../navigation/types';

interface AlertDetails {
  title: string;
  description: string;
  timestamp: string;
  sourceName?: string;
  sourceUrl?: string;
}

const AlertDetailsScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'AlertDetails'>>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const alert = route.params?.alert;

  if (!alert) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>{t('alert_details_not_found')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>
          {alert.title}
        </Text>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {alert.description}
        </Text>

        <View style={styles.footer}>
          <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
            {t('alert_details_time', {
              time: new Date(alert.timestamp).toLocaleString(
                i18n.language?.startsWith('pt') ? 'pt-BR' : i18n.language,
              ),
            })}
          </Text>
        </View>

        {alert.sourceUrl && (
          <TouchableOpacity
            style={[styles.sourceButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              const url = alert.sourceUrl;
              if (!url) return;
              navigation.navigate('WebView', {
                url,
                title: alert.sourceName || t('alert_details_source_official'),
              });
            }}
          >
            <Text style={styles.sourceButtonText}>
              {t('alert_details_view_source')}
            </Text>
          </TouchableOpacity>
        )}

        {alert.sourceName && (
          <Text style={[styles.sourceLabel, { color: colors.textSecondary }]}>
            {t('alert_details_source_label', { name: alert.sourceName })}
          </Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: ThemeTokens.spacing.xl,
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    padding: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  title: {
    fontSize: ThemeTokens.typography.sizes.title,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: ThemeTokens.spacing.md,
    letterSpacing: -0.5,
    fontFamily: Platform.OS === 'ios' ? ThemeTokens.typography.families.ios : ThemeTokens.typography.families.android,
  },
  divider: {
    height: 1,
    width: '40%',
    alignSelf: 'center',
    marginBottom: ThemeTokens.spacing.lg,
    opacity: 0.5,
  },
  description: {
    fontSize: ThemeTokens.typography.sizes.body,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: ThemeTokens.spacing.lg,
    fontFamily: Platform.OS === 'ios' ? ThemeTokens.typography.families.ios : ThemeTokens.typography.families.android,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
    paddingTop: ThemeTokens.spacing.md,
    alignItems: 'center',
  },
  timestamp: {
    fontSize: ThemeTokens.typography.sizes.caption,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? ThemeTokens.typography.families.ios : ThemeTokens.typography.families.android,
  },
  sourceButton: {
    marginTop: ThemeTokens.spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: ThemeTokens.radius.lg,
    alignSelf: 'center',
  },
  sourceButtonText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: ThemeTokens.typography.sizes.body,
    fontFamily: Platform.OS === 'ios' ? ThemeTokens.typography.families.ios : ThemeTokens.typography.families.android,
  },
  sourceLabel: {
    marginTop: ThemeTokens.spacing.sm,
    fontSize: ThemeTokens.typography.sizes.caption,
    fontFamily: Platform.OS === 'ios' ? ThemeTokens.typography.families.ios : ThemeTokens.typography.families.android,
  },
});

export default AlertDetailsScreen;
