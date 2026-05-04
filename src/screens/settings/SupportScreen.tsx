import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { CommonActions } from '@react-navigation/native';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import AppText from '../../components/ui/AppText';
import { GetSupportAssistantReplyQuery } from '../../application/queries/GetSupportAssistantReplyQuery';
import { SupportChatMessage } from '../../domain/support/SupportAssistant';

const SUPPORT_EMAIL = 'sac.alertai@gmail.com';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const buildSupportMailto = (subject: string, body: string) => {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  return `mailto:${SUPPORT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`;
};

const SupportScreen = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const { t, i18n } = useTranslation();
  const listRef = useRef<FlatList<SupportChatMessage> | null>(null);

  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const locale = i18n.resolvedLanguage || i18n.language || 'pt-BR';

  const suggestions = useMemo(
    () => [
      t('support_suggestion_notifications'),
      t('support_suggestion_subscription'),
      t('support_suggestion_update'),
      t('support_suggestion_settings'),
      t('support_suggestion_widgets'),
    ],
    [t],
  );

  const submitQuestion = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || loading) return;

      const userMessage: SupportChatMessage = {
        id: `support-user-${Date.now()}`,
        role: 'user',
        text: trimmed,
      };

      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setLoading(true);

      const reply = GetSupportAssistantReplyQuery.execute({
        question: trimmed,
        locale,
        supportEmail: SUPPORT_EMAIL,
      });

      setMessages(prev => [
        ...prev,
        {
          id: `support-assistant-${Date.now()}`,
          role: 'assistant',
          text: reply.text,
        },
      ]);
      setLoading(false);
    },
    [locale, loading],
  );

  const handleSend = useCallback(() => {
    submitQuestion(input);
  }, [input, submitQuestion]);

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation?.dispatch?.(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      }),
    );
  }, [navigation]);

  const handleEmailPress = useCallback(() => {
    const subject = t('support_email_subject');
    const body = t('support_email_body_template');
    const mailto = buildSupportMailto(subject, body);
    Linking.openURL(mailto).catch(() => {
      // ignore - system handles errors
    });
  }, [t]);

  const renderMessage = ({ item }: { item: SupportChatMessage }) => {
    const isAssistant = item.role === 'assistant';
    if (!isAssistant) {
      return (
        <View style={styles.userWrap}>
          <View
            style={[
              styles.userBubble,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(18,18,22,0.05)',
              },
            ]}
          >
            <Text style={[styles.userText, { color: colors.text }]}>{item.text}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.assistantWrap}>
        <View style={styles.assistantBody}>
          <Text style={[styles.assistantText, { color: colors.text }]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  const showEmptyState = messages.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBackButton}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={t('common_back')}
          accessibilityHint={t('common_back_hint')}
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <AppText
          variant="title1"
          tone="default"
          accessibilityRole="header"
          style={[styles.headerTitle, { color: colors.text }]}
        >
          {t('support_screen_title')}
        </AppText>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('support_chat_scope_title')}
        </Text>
        <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
          {t('support_chat_scope_body')}
        </Text>
      </View>

      <View style={styles.contentArea}>
        {showEmptyState ? (
          <ScrollView
            contentContainerStyle={styles.emptyStateWrap}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('support_chat_empty_title')}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              {t('support_chat_empty_body')}
            </Text>

            <View style={styles.suggestionWrap}>
              {suggestions.map((prompt, index) => (
                <TouchableOpacity
                  key={`support-suggestion-${index}`}
                  style={[styles.suggestionChip, { borderColor: colors.border }]}
                  activeOpacity={0.8}
                  onPress={() => submitQuestion(prompt)}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                >
                  <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={1}>
                    {prompt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('support_email_title')}
              </Text>
              <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
                {t('support_email_body', { email: SUPPORT_EMAIL })}
              </Text>
              <TouchableOpacity
                style={[styles.emailButton, { backgroundColor: colors.primary }]}
                onPress={handleEmailPress}
                accessibilityRole="button"
                accessibilityLabel={t('support_email_cta')}
                accessibilityHint={t('support_email_hint')}
              >
                <Text style={styles.emailButtonText}>{t('support_email_cta')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {t('support_email_title')}
                </Text>
                <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
                  {t('support_email_body', { email: SUPPORT_EMAIL })}
                </Text>
                <TouchableOpacity
                  style={[styles.emailButton, { backgroundColor: colors.primary }]}
                  onPress={handleEmailPress}
                  accessibilityRole="button"
                  accessibilityLabel={t('support_email_cta')}
                  accessibilityHint={t('support_email_hint')}
                >
                  <Text style={styles.emailButtonText}>{t('support_email_cta')}</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={[styles.composerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('support_chat_input_placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text }]}
            multiline
            allowFontScaling
            maxFontSizeMultiplier={ThemeTokens.typography.maxFontScale.body}
          />
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleSend}
            disabled={loading || !input.trim()}
            style={[
              styles.primaryActionButton,
              {
                backgroundColor: colors.primary,
                opacity: loading || !input.trim() ? 0.56 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('support_chat_send_action')}
          >
            <Icon name="arrow-up" size={18} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>{t('support_chat_send_action')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.md,
  },
  headerBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
  },
  sectionCard: {
    marginHorizontal: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.md,
    borderWidth: 1,
  },
  sectionTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    textTransform: 'uppercase',
  },
  sectionBody: {
    marginTop: ThemeTokens.spacing.xs,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  contentArea: {
    flex: 1,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.md,
  },
  emptyStateWrap: {
    alignItems: 'flex-start',
    gap: ThemeTokens.spacing.xs,
    paddingBottom: ThemeTokens.spacing.lg,
  },
  emptyTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  emptyBody: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  suggestionWrap: {
    marginTop: ThemeTokens.spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.xs,
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  suggestionText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  listContent: {
    paddingBottom: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.sm,
  },
  userWrap: {
    alignItems: 'flex-end',
    marginBottom: ThemeTokens.spacing.sm,
  },
  userBubble: {
    maxWidth: '92%',
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.sm,
  },
  userText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  assistantWrap: {
    marginBottom: ThemeTokens.spacing.sm,
  },
  assistantBody: {
    gap: ThemeTokens.spacing.sm,
  },
  assistantText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  emailButton: {
    alignSelf: 'flex-start',
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: ThemeTokens.spacing.sm,
  },
  emailButtonText: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  composerCard: {
    marginHorizontal: ThemeTokens.spacing.lg,
    marginBottom: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  input: {
    minHeight: 60,
    maxHeight: 120,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 8,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
    textAlignVertical: 'top',
  },
  primaryActionButton: {
    alignSelf: 'flex-end',
    minWidth: 96,
    height: 42,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
});

export default SupportScreen;
