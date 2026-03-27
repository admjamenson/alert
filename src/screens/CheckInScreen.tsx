import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../context/ThemeContext';
import { CheckInService } from '../services/CheckInService';
import { ThemeTokens } from '../constants/ThemeTokens';

export const CheckInScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [status, setStatus] = useState<'sending' | 'sent' | 'no_guardians' | 'error'>('sending');

  useEffect(() => {
    const run = async () => {
      try {
        const res = await CheckInService.send();
        if (res.ok) {
          setStatus('sent');
          setTimeout(() => navigation.replace('Home'), 300);
          return;
        }
        if (res.reason === 'no_guardians') {
          setStatus('no_guardians');
          setTimeout(() => navigation.replace('Guardians'), 300);
          return;
        }
        setStatus('error');
        setTimeout(() => navigation.replace('Home'), 300);
      } catch {
        setStatus('error');
        setTimeout(() => navigation.replace('Home'), 300);
      }
    };
    void run();
  }, [navigation]);

  const title =
    status === 'sent'
      ? t('checkin_sent_title')
      : status === 'no_guardians'
        ? t('checkin_no_guardians_title')
        : status === 'error'
          ? t('checkin_failed_title')
          : t('checkin_sending_title');

  const body =
    status === 'sent'
      ? t('checkin_sent_body')
      : status === 'no_guardians'
        ? t('checkin_no_guardians_body')
        : status === 'error'
          ? t('checkin_failed_body')
          : t('checkin_sending_body');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: ThemeTokens.spacing.lg, justifyContent: 'center' },
  card: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    padding: ThemeTokens.spacing.xl,
    alignItems: 'center',
    gap: ThemeTokens.spacing.md,
  },
  title: { fontSize: 18, fontWeight: '900' },
  body: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

