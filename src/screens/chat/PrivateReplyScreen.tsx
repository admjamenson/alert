import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { ChatMessageItem, ChatReplyRef, ChatThreadService } from '../../services/ChatThreadService';
import { TelemetryService } from '../../services/TelemetryService';
import { RootStackParamList } from '../../navigation/types';

type PrivateReplyRouteParams = RootStackParamList['PrivateReply'];

const buildPrivateConversationId = (a: string, b: string) =>
  [a, b].sort((x, y) => x.localeCompare(y)).join('__');

const PrivateReplyScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PrivateReply'>>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params: PrivateReplyRouteParams = route.params || {};
  const targetUserId = String(params.targetUserId || '').trim();
  const targetUserName = params.targetUserName || t('messages_unknown');
  const quote = params.quote as ChatReplyRef | undefined;

  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    TelemetryService.trackEvent('chat_private_reply_open');
    void (async () => {
      const current = await ChatThreadService.getCurrentChatUser();
      setMe(current);
    })();
  }, []);

  const conversationId = useMemo(() => {
    if (!me?.id || !targetUserId) return '';
    return buildPrivateConversationId(me.id, targetUserId);
  }, [me?.id, targetUserId]);

  useEffect(() => {
    if (!conversationId || !me?.id) return;
    void ChatThreadService.ensureConversation({
      conversationId,
      type: 'private',
      title: targetUserName,
      members: [me.id, targetUserId],
    });
  }, [conversationId, me?.id, targetUserId, targetUserName, t]);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = ChatThreadService.listenLatestMessages(
      conversationId,
      (incoming) => {
        setMessages(incoming);
      },
      () => {},
      40,
    );
    return () => unsubscribe();
  }, [conversationId]);

  const send = async () => {
    if (!conversationId || !me?.id) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    await ChatThreadService.sendMessage({
      conversationId,
      type: 'text',
      text: trimmed,
      replyTo: quote,
      conversation: {
        title: targetUserName,
        type: 'private',
        members: [me.id, targetUserId],
      },
    });
    TelemetryService.trackEvent('chat_private_reply_send');
    setText('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerMiddle}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {targetUserName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('chat_private_reply')}
          </Text>
        </View>
      </View>

      {quote ? (
        <View style={[styles.quoteCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.quoteTitle, { color: colors.primary }]}>{quote.senderName}</Text>
          <Text style={[styles.quoteText, { color: colors.textSecondary }]} numberOfLines={2}>
            {quote.preview}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        inverted
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const self = item.senderId === me?.id;
          return (
            <View style={[styles.msgRow, self ? styles.msgSelf : styles.msgOther]}>
              <View style={[styles.msgBubble, { backgroundColor: self ? colors.primary : colors.card, borderColor: self ? colors.primary : colors.border }]}>
                <Text style={[styles.msgText, { color: self ? '#FFF' : colors.text }]}>{item.text || t('chat_deleted')}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
          placeholder={t('chat_send_message')}
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.primary }]} onPress={() => void send()}>
          <Icon name="send" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerMiddle: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '800', fontFamily: ThemeTokens.typography.families.android },
  subtitle: { fontSize: 12, marginTop: 2, fontFamily: ThemeTokens.typography.families.android },
  quoteCard: { margin: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  quoteTitle: { fontSize: 12, fontWeight: '700' },
  quoteText: { fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 12, paddingVertical: 8 },
  msgRow: { marginBottom: 8, maxWidth: '90%' },
  msgSelf: { alignSelf: 'flex-end' },
  msgOther: { alignSelf: 'flex-start' },
  msgBubble: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  msgText: { fontSize: 16, lineHeight: 21 },
  composer: { borderTopWidth: 1, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

export default PrivateReplyScreen;
