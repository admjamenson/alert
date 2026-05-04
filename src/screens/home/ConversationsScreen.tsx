import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {useTheme} from '../../context/ThemeContext';
import {ThemeTokens} from '../../constants/ThemeTokens';
import {
  ChatConversationItem,
  ChatThreadService,
} from '../../services/ChatThreadService';
import {TelemetryService} from '../../services/TelemetryService';
import {
  GUARDIANS_CONVERSATION_ID,
  isGuardiansConversation,
} from '../../services/chat/guardiansConversation';
import type {RootStackParamList} from '../../navigation/types';

type Conversation = {
  id: string;
  title: string;
  members: string[];
  lastText: string;
  timestamp: number;
  unread: boolean;
  pinned: boolean;
  guardians: boolean;
};
type ConversationsScreenProps = NativeStackScreenProps<RootStackParamList, 'Conversations'>;

const CHAT_LAST_SEEN_KEY = '@Alert:ChatThreadLastSeen';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

export const ConversationsScreen = ({navigation, route}: ConversationsScreenProps) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const prioritizeGuardians = Boolean(route?.params?.openGuardiansFirst);
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const autoOpenGuardiansRef = useRef(false);

  const buildGuardiansFallbackRow = useCallback(
    (): Conversation => ({
      id: GUARDIANS_CONVERSATION_ID,
      title: t('guardians_conversation_title'),
      members: [],
      lastText: t('guardians_conversation_stub_preview'),
      timestamp: 0,
      unread: false,
      pinned: true,
      guardians: true,
    }),
    [t],
  );

  const ensureGuardiansFirst = useCallback(
    (rows: Conversation[]): Conversation[] => {
      const guardiansIndex = rows.findIndex(
        item => item.guardians || isGuardiansConversation(item.id),
      );
      if (guardiansIndex === 0) return rows;
      if (guardiansIndex > 0) {
        const next = [...rows];
        const [guardians] = next.splice(guardiansIndex, 1);
        return [guardians, ...next];
      }
      return [buildGuardiansFallbackRow(), ...rows];
    },
    [buildGuardiansFallbackRow],
  );

  const handleBack = useCallback(() => {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Home');
  }, [navigation]);

  const announceRefreshState = useCallback(
    (messageKey: string) => {
      AccessibilityInfo.isScreenReaderEnabled()
        .then(enabled => {
          if (enabled)
            AccessibilityInfo.announceForAccessibility(t(messageKey));
        })
        .catch(() => {});
    },
    [t],
  );

  const readLastSeenMap = useCallback(async (): Promise<
    Record<string, number>
  > => {
    try {
      const lastSeenRaw = await AsyncStorage.getItem(CHAT_LAST_SEEN_KEY);
      return lastSeenRaw ? JSON.parse(lastSeenRaw) : {};
    } catch {
      return {};
    }
  }, []);

  const formatConversationTime = useCallback((timestamp: number) => {
    if (!timestamp) return '--';
    const value = new Date(timestamp);
    const now = new Date();
    const pad2 = (num: number) => String(num).padStart(2, '0');

    const isSameDay =
      value.getFullYear() === now.getFullYear() &&
      value.getMonth() === now.getMonth() &&
      value.getDate() === now.getDate();

    if (isSameDay) {
      return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
    }

    const isSameYear = value.getFullYear() === now.getFullYear();
    const day = pad2(value.getDate());
    const month = pad2(value.getMonth() + 1);
    if (isSameYear) return `${day}/${month}`;
    return `${day}/${month}/${value.getFullYear()}`;
  }, []);

  const buildPreview = useCallback(
    (conversation: ChatConversationItem) => {
      const last = conversation.lastMessage;
      if (!last) return '';
      if (last.type === 'text') return last.text || '';
      if (last.type === 'image') return t('chat_attachment_image');
      if (last.type === 'audio') return t('chat_attachment_audio');
      if (last.type === 'video') return t('chat_attachment_video');
      return t('chat_attachment_document');
    },
    [t],
  );

  const toConversationRow = useCallback(
    (
      item: ChatConversationItem,
      currentUserId: string,
      lastSeenMap: Record<string, number>,
    ): Conversation => {
      const guardians = isGuardiansConversation(item.id);
      const ts = item.lastMessage?.createdAtMs || item.updatedAtMs || 0;
      const seenAt = Number(lastSeenMap?.[item.id] || 0);
      const preview = buildPreview(item);
      return {
        id: item.id,
        title: guardians
          ? t('guardians_conversation_title')
          : item.title || t('messages_unknown'),
        members: item.members,
        lastText:
          preview ||
          (guardians ? t('guardians_conversation_stub_preview') : ''),
        timestamp: ts,
        unread:
          ts > seenAt && (item.lastMessage?.senderId || '') !== currentUserId,
        pinned: guardians || Boolean(item.pinned),
        guardians,
      };
    },
    [buildPreview, t],
  );

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then(enabled => {
        if (mounted) setScreenReaderEnabled(enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      enabled => {
        setScreenReaderEnabled(enabled);
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await ChatThreadService.ensureGuardiansConversation().catch(
        () => undefined,
      );
      const currentUser = await ChatThreadService.getCurrentChatUser();
      currentUserIdRef.current = currentUser.id;
      const lastSeenMap = await readLastSeenMap();

      const cached = ensureGuardiansFirst(
        ChatThreadService.getCachedConversations(currentUser.id).map(item =>
          toConversationRow(item, currentUser.id, lastSeenMap),
        ),
      );
      setItems(cached);
      setLoading(false);

      const unsubscribe = ChatThreadService.listenConversations(
        currentUser.id,
        async conversations => {
          const seenMap = await readLastSeenMap();
          const mapped = ensureGuardiansFirst(
            conversations.map(item =>
              toConversationRow(item, currentUser.id, seenMap),
            ),
          );
          setItems(mapped);
          setLoading(false);
          setLoadError(null);
          TelemetryService.trackEvent('chat_conversations_loaded', {
            count: mapped.length,
          });
        },
        () => {
          setLoading(false);
          setLoadError(t('messages_error_load'));
          setItems(prev => (prev.length > 0 ? prev : ensureGuardiansFirst([])));
          TelemetryService.trackEvent('chat_conversations_error');
        },
      );
      return unsubscribe;
    } catch {
      setLoading(false);
      setLoadError(t('messages_error_load'));
      setItems(ensureGuardiansFirst([]));
      TelemetryService.trackEvent('chat_conversations_error');
      return undefined;
    }
  }, [ensureGuardiansFirst, readLastSeenMap, t, toConversationRow]);

  useEffect(() => {
    TelemetryService.trackEvent('chat_conversations_open');
    void (async () => {
      unsubscribeRef.current = (await loadConversations()) || null;
    })();
    return () => {
      if (typeof unsubscribeRef.current === 'function') {
        unsubscribeRef.current();
      }
      unsubscribeRef.current = null;
    };
  }, [loadConversations]);

  const handleRefresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    announceRefreshState('messages_refreshing');

    try {
      const netState = await NetInfo.fetch();
      const userIdFromRef = currentUserIdRef.current;
      const currentUserId =
        userIdFromRef || (await ChatThreadService.getCurrentChatUser()).id;
      currentUserIdRef.current = currentUserId;

      let refreshed =
        await ChatThreadService.refreshConversations(currentUserId);
      if (!netState.isConnected) {
        refreshed = ChatThreadService.getCachedConversations(currentUserId);
      }

      const seenMap = await readLastSeenMap();
      const mapped = ensureGuardiansFirst(
        refreshed.map(item => toConversationRow(item, currentUserId, seenMap)),
      );
      setItems(mapped);
      setLoadError(null);
      TelemetryService.trackEvent('chat_conversations_refresh_success', {
        count: mapped.length,
        connected: Boolean(netState.isConnected),
      });
      announceRefreshState('messages_refreshed');
    } catch {
      setLoadError(t('messages_error_load'));
      TelemetryService.trackEvent('chat_conversations_refresh_error');
      announceRefreshState('messages_refresh_failed');
    } finally {
      setRefreshing(false);
      refreshInFlightRef.current = false;
    }
  }, [
    announceRefreshState,
    ensureGuardiansFirst,
    readLastSeenMap,
    t,
    toConversationRow,
  ]);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(
      item =>
        item.title.toLowerCase().includes(keyword) ||
        item.lastText.toLowerCase().includes(keyword),
    );
  }, [items, query]);

  const guardiansConversation = useMemo(() => {
    const pinned = filteredItems.find(item => item.guardians);
    return pinned || buildGuardiansFallbackRow();
  }, [buildGuardiansFallbackRow, filteredItems]);

  const openGuardiansThread = useCallback(() => {
    navigation.navigate('ChatThread', {
      conversationId: GUARDIANS_CONVERSATION_ID,
      title: guardiansConversation.title,
      memberIds: guardiansConversation.members,
      type: 'group',
    });
    TelemetryService.trackEvent('chat_guardians_pin_tap');
  }, [guardiansConversation, navigation]);

  const listWithoutGuardians = useMemo(
    () => filteredItems.filter(item => !item.guardians),
    [filteredItems],
  );

  useEffect(() => {
    if (!prioritizeGuardians || loading || autoOpenGuardiansRef.current) return;
    autoOpenGuardiansRef.current = true;
    const params = {
      conversationId: guardiansConversation.id,
      title: guardiansConversation.title,
      memberIds: guardiansConversation.members,
      type: 'group' as const,
    };
    TelemetryService.trackEvent('chat_guardians_auto_open');
    if (typeof navigation.replace === 'function') {
      navigation.replace('ChatThread', params);
      return;
    }
    navigation.navigate('ChatThread', params);
  }, [
    guardiansConversation.id,
    guardiansConversation.members,
    guardiansConversation.title,
    loading,
    navigation,
    prioritizeGuardians,
  ]);

  const skeletonRows = useMemo(
    () => Array.from({length: 5}, (_, idx) => `sk_${idx}`),
    [],
  );

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBtn}>
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.text}]}>
          {t('messages_title')}
        </Text>
        {screenReaderEnabled ? (
          <TouchableOpacity
            onPress={() => void handleRefresh()}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('messages_refresh_action')}>
            <Icon name="refresh" size={22} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchInputWrap,
            {borderColor: colors.border, backgroundColor: colors.card},
          ]}>
          <Icon name="magnify" size={18} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('chat_search_placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, {color: colors.text}]}
            accessibilityLabel={t('chat_search_placeholder')}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => setQuery('')}
              accessibilityLabel={t('chat_clear_search')}>
              <Icon
                name="close-circle"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
          <FlatList
            data={skeletonRows}
            keyExtractor={item => item}
            contentContainerStyle={styles.list}
            renderItem={() => (
              <View
                style={[
                  styles.row,
                  {backgroundColor: colors.card, borderColor: colors.border},
                ]}>
                <View
                  style={[styles.avatar, {backgroundColor: colors.surface}]}
                />
                <View style={{flex: 1}}>
                  <View
                    style={[
                      styles.skeletonLineLg,
                      {backgroundColor: colors.surface},
                    ]}
                  />
                  <View
                    style={[
                      styles.skeletonLineSm,
                      {backgroundColor: colors.surface},
                    ]}
                  />
                </View>
              </View>
            )}
          />
        </View>
      ) : (
        <FlatList
          data={listWithoutGuardians}
          keyExtractor={item => item.id}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={openGuardiansThread}
              style={[
                styles.row,
                styles.guardiansRow,
                styles.guardiansRowPriority,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.primary,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('guardians_conversation_title')}
              accessibilityHint={t('guardians_conversation_stub_preview')}>
              <View
                style={[
                  styles.avatar,
                  styles.guardiansAvatar,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.primary,
                  },
                ]}>
                <Icon name="shield-account" size={28} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <View
                  style={[
                    styles.guardiansBadge,
                    {
                      backgroundColor: colors.primary,
                    },
                  ]}>
                  <Icon name="pin" size={11} color="#FFF" />
                  <Text style={styles.guardiansBadgeText}>
                    {t('guardians_conversation_pinned')}
                  </Text>
                </View>
                <View style={styles.rowTitleWrap}>
                  <Text
                    style={[styles.rowTitle, {color: colors.text}]}
                    numberOfLines={2}
                    ellipsizeMode="tail">
                    {guardiansConversation.title}
                  </Text>
                </View>
                <Text
                  style={[styles.rowSubtitle, {color: colors.textSecondary}]}
                  numberOfLines={1}>
                  {guardiansConversation.lastText}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text
                  style={[styles.rowTime, {color: colors.textSecondary}]}
                  numberOfLines={1}>
                  {formatConversationTime(guardiansConversation.timestamp)}
                </Text>
                {guardiansConversation.unread && (
                  <View
                    style={[styles.unreadDot, {backgroundColor: colors.alert}]}
                  />
                )}
              </View>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon
                name="message-text-outline"
                size={26}
                color={colors.textSecondary}
              />
              <Text style={[styles.emptyText, {color: colors.textSecondary}]}>
                {loadError || t('messages_empty')}
              </Text>
            </View>
          }
          renderItem={({item}) => (
            <TouchableOpacity
              style={[
                styles.row,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              activeOpacity={0.85}
              onPress={() => {
                navigation.navigate('ChatThread', {
                  conversationId: item.id,
                  title: item.title,
                  memberIds: item.members,
                });
              }}>
              <View
                style={[
                  styles.avatar,
                  {
                    backgroundColor: colors.surface,
                    borderColor: 'transparent',
                  },
                ]}>
                <Icon
                  name="account-circle"
                  size={28}
                  color={colors.textSecondary}
                />
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowTitleWrap}>
                  <Text
                    style={[styles.rowTitle, {color: colors.text}]}
                    numberOfLines={1}
                    ellipsizeMode="tail">
                    {item.title}
                  </Text>
                  {item.pinned ? (
                    <Icon
                      name="pin"
                      size={12}
                      color={colors.primary}
                      style={styles.pinIcon}
                      accessibilityLabel={t('guardians_conversation_pinned')}
                    />
                  ) : null}
                </View>
                <Text
                  style={[styles.rowSubtitle, {color: colors.textSecondary}]}
                  numberOfLines={1}>
                  {item.lastText}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text
                  style={[styles.rowTime, {color: colors.textSecondary}]}
                  numberOfLines={1}>
                  {formatConversationTime(item.timestamp)}
                </Text>
                {item.unread && (
                  <View
                    style={[styles.unreadDot, {backgroundColor: colors.alert}]}
                  />
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.sm,
  },
  headerBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  searchWrap: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    marginBottom: ThemeTokens.spacing.sm,
  },
  searchInputWrap: {
    minHeight: 44,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
    paddingVertical: 0,
    marginLeft: 8,
  },
  clearBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: {flex: 1},
  list: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.md,
    padding: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    marginBottom: ThemeTokens.spacing.sm,
  },
  guardiansRow: {
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 8},
    elevation: 3,
  },
  guardiansRowPriority: {
    transform: [{scale: 1.01}],
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guardiansAvatar: {
    borderWidth: 1,
  },
  rowText: {flex: 1, minWidth: 0},
  guardiansBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  guardiansBadgeText: {
    color: '#FFFFFF',
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  rowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minWidth: 0,
    gap: 6,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  pinIcon: {
    marginTop: 1,
  },
  rowSubtitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    marginTop: 2,
    fontFamily: FONT_FAMILY,
  },
  rowMeta: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    minWidth: 72,
    maxWidth: 96,
  },
  skeletonLineLg: {
    height: 14,
    width: '62%',
    borderRadius: 7,
  },
  skeletonLineSm: {
    marginTop: 8,
    height: 12,
    width: '84%',
    borderRadius: 6,
  },
  rowTime: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
    textAlign: 'right',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: ThemeTokens.spacing.xl,
    gap: ThemeTokens.spacing.sm,
  },
  emptyText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
});

export default ConversationsScreen;
