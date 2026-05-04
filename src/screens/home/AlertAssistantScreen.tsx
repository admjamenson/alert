import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLocales } from 'react-native-localize';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { GetAlertAssistantReplyQuery } from '../../application/queries/GetAlertAssistantReplyQuery';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useSecurity } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import { AlertAssistantReplyReadModel } from '../../domain/trust/AlertAssistant';
import { RootStackParamList } from '../../navigation/types';
import { resolveLocale, resolveTimeZone } from '../../utils/dateTimeFormat';
import { detectAssistantLocale } from '../../utils/assistantLanguage';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  reply?: AlertAssistantReplyReadModel;
};

type Props = NativeStackScreenProps<RootStackParamList, 'AlertAssistant'>;

export const AlertAssistantScreen = ({ navigation }: Props) => {
  const { colors, isDark } = useTheme();
  const { securityState } = useSecurity();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage> | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const localeTag = useMemo(
    () =>
      resolveLocale(
        i18n.resolvedLanguage || i18n.language || getLocales()?.[0]?.languageTag || 'pt-BR',
      ),
    [i18n.language, i18n.resolvedLanguage],
  );
  const timeZone = useMemo(() => resolveTimeZone(), []);

  const latitude = securityState.location?.latitude;
  const longitude = securityState.location?.longitude;
  const hasPreciseLocation =
    canUseLocationForRiskMaps(securityState) &&
    isFiniteCoordinatePair(latitude, longitude);

  useEffect(() => {
    if (!messages.length) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages]);

  const submitQuestion = useCallback(
    async (question: string, preferredLocale?: string | null) => {
      const trimmed = question.trim();
      if (!trimmed || loading) return;

      const effectiveLocale = detectAssistantLocale(trimmed, localeTag, preferredLocale);
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
      };

      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setLoading(true);

      try {
        const reply = await GetAlertAssistantReplyQuery.execute({
          question: trimmed,
          locale: effectiveLocale,
          timeZone,
          latitude: hasPreciseLocation ? Number(latitude) : undefined,
          longitude: hasPreciseLocation ? Number(longitude) : undefined,
        });

        setMessages(prev => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: reply.body,
            reply,
          },
        ]);
      } catch {
        setMessages(prev => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: t('assistant_fallback_error'),
            reply: {
              intent: 'general',
              title: t('assistant_scope_title'),
              body: t('assistant_fallback_error'),
              bullets: [t('assistant_scope_bullet_area'), t('assistant_scope_bullet_sources')],
              sources: [],
              trustLabel: t('assistant_trust_unavailable'),
              updatedLabel: undefined,
              suggestedPrompts: [],
            },
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [
      hasPreciseLocation,
      latitude,
      loading,
      localeTag,
      longitude,
      t,
      timeZone,
    ],
  );

  const handlePrimaryAction = useCallback(() => {
    if (!input.trim() || loading) return;
    void submitQuestion(input);
  }, [input, loading, submitQuestion]);

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isAssistant = item.role === 'assistant';
    const reply = item.reply;

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
        {reply?.sources?.length ? (
          <View
            style={[
              styles.sourcePill,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Icon name="shield-check-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.sourcePillText, { color: colors.text }]}>
              {reply.sources[0].name}
            </Text>
          </View>
        ) : null}

        <View style={styles.assistantBody}>
          {reply?.title ? (
            <Text style={[styles.assistantTitle, { color: colors.text }]}>{reply.title}</Text>
          ) : null}

          <Text style={[styles.assistantText, { color: colors.text }]}>{item.text}</Text>

          {reply?.bullets?.length ? (
            <View style={styles.bulletsWrap}>
              {reply.bullets.filter(Boolean).map((bullet, index) => (
                <View key={`${item.id}-bullet-${index}`} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.bulletText, { color: colors.textSecondary }]}>
                    {bullet}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {reply?.sources?.length ? (
            <View style={styles.sourcesRow}>
              {reply.sources.map(source => {
                const chip = (
                  <View
                    style={[
                      styles.inlineSourceChip,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.inlineSourceChipText, { color: colors.text }]}>
                      {source.name}
                    </Text>
                  </View>
                );

                if (!source.url) {
                  return <View key={`${item.id}-${source.name}`}>{chip}</View>;
                }

                return (
                  <TouchableOpacity
                    key={`${item.id}-${source.name}`}
                    activeOpacity={0.85}
                    onPress={() => void Linking.openURL(source.url!)}
                  >
                    {chip}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {reply?.trustLabel || reply?.updatedLabel ? (
            <View style={styles.metaRow}>
              {reply?.trustLabel ? (
                <View style={styles.metaItem}>
                  <Icon name="shield-check" size={13} color={colors.textSecondary} />
                  <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                    {reply.trustLabel}
                  </Text>
                </View>
              ) : null}
              {reply?.updatedLabel ? (
                <View style={styles.metaItem}>
                  <Icon name="clock-outline" size={13} color={colors.textSecondary} />
                  <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                    {reply.updatedLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const showEmptyState = messages.length === 0;
  const actionLabel = t('assistant_send_action');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.goBack()}
            style={[styles.topIconButton, styles.topLeftButton]}
            accessibilityRole="button"
            accessibilityLabel={t('assistant_back_button_label')}
          >
            <Icon name="arrow-left" size={28} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerTitleWrap} />

          <View style={[styles.topIconButton, styles.topRightButton]}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.topBrandIcon}
              resizeMode="contain"
              accessible={false}
            />
          </View>
        </View>

        <View style={styles.contentArea}>
          {showEmptyState ? (
            <View style={styles.emptyStateWrap}>
              <View
                style={[
                  styles.emptySymbol,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(18,18,22,0.025)',
                  },
                ]}
              >
                <Image
                  source={require('../../assets/logo.png')}
                  style={[
                    styles.emptyBrandMark,
                    {
                      opacity: isDark ? 0.1 : 0.08,
                    },
                  ]}
                  resizeMode="contain"
                  accessible={false}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {t('assistant_empty_title')}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                {t('assistant_empty_body')}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={item => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        <View style={styles.bottomPanel}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <View
              style={[
                styles.composerCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  marginBottom: ThemeTokens.spacing.md + insets.bottom,
                },
              ]}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={t('assistant_input_placeholder')}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text }]}
                multiline
                allowFontScaling
                maxFontSizeMultiplier={ThemeTokens.typography.maxFontScale.body}
                accessibilityLabel={t('assistant_input_placeholder')}
                testID="alert-assistant-input"
              />

              <View style={styles.composerActionsRow}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={handlePrimaryAction}
                  disabled={loading || !input.trim()}
                  style={[
                    styles.primaryActionButton,
                    {
                      backgroundColor: '#060B17',
                      opacity: loading || !input.trim() ? 0.56 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={actionLabel}
                  testID="alert-assistant-send"
                >
                  <Icon name="arrow-up" size={20} color="#FFFFFF" />
                  <Text style={styles.primaryActionText}>{actionLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  topBar: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.sm,
    position: 'relative',
  },
  topIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLeftButton: {
    position: 'absolute',
    left: ThemeTokens.spacing.lg,
    top: ThemeTokens.spacing.sm,
  },
  topRightButton: {
    position: 'absolute',
    right: ThemeTokens.spacing.lg,
    top: ThemeTokens.spacing.sm,
  },
  topBrandIcon: {
    width: 26,
    height: 26,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  headerTitleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabelActive: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontFamily: FONT_FAMILY,
  },
  tabIndicator: {
    width: 86,
    height: 5,
    borderRadius: 999,
    marginTop: 8,
  },
  contentArea: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyStateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: ThemeTokens.spacing.xxl,
    paddingBottom: ThemeTokens.spacing.xxxl,
  },
  emptySymbol: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: ThemeTokens.spacing.xl,
  },
  emptyBrandMark: {
    width: 92,
    height: 92,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  emptyTitle: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    textAlign: 'center',
    fontFamily: FONT_FAMILY,
  },
  emptyBody: {
    marginTop: ThemeTokens.spacing.sm,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    textAlign: 'center',
    fontFamily: FONT_FAMILY,
  },
  listContent: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.lg,
  },
  userWrap: {
    alignItems: 'center',
    marginBottom: ThemeTokens.spacing.lg,
  },
  userBubble: {
    width: '100%',
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingVertical: ThemeTokens.spacing.lg,
  },
  userText: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontFamily: FONT_FAMILY,
  },
  assistantWrap: {
    marginBottom: ThemeTokens.spacing.xl,
  },
  sourcePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: ThemeTokens.spacing.md,
  },
  sourcePillText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  assistantBody: {
    gap: ThemeTokens.spacing.sm,
  },
  assistantTitle: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  assistantText: {
    fontSize: 17,
    lineHeight: 28,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  bulletsWrap: {
    marginTop: ThemeTokens.spacing.xs,
    gap: ThemeTokens.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  sourcesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: ThemeTokens.spacing.xs,
  },
  inlineSourceChip: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inlineSourceChipText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.md,
    marginTop: ThemeTokens.spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  bottomPanel: {
    paddingBottom: ThemeTokens.spacing.sm,
  },
  composerCard: {
    marginHorizontal: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingTop: ThemeTokens.spacing.md,
    paddingBottom: ThemeTokens.spacing.sm,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  input: {
    minHeight: 76,
    maxHeight: 132,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 8,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: ThemeTokens.typography.weights.regular,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
    textAlignVertical: 'top',
  },
  composerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  attachButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  modeChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  modeChipText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  smallMicButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primaryActionButton: {
    minWidth: 118,
    height: 52,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  statusHint: {
    marginTop: ThemeTokens.spacing.sm,
    paddingHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
});

export default AlertAssistantScreen;
