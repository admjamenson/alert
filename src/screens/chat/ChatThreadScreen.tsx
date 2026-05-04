import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  Image,
  NativeModules,
  Pressable,
  Share,
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
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
// Audio recorder import disabled - causes build issues with Nitro modules
// import AudioRecorderPlayer, {
//   AudioEncoderAndroidType,
//   AudioSourceAndroidType,
//   AVEncoderAudioQualityIOSType,
//   AVEncodingOption,
//   AVModeIOSOption,
//   OutputFormatAndroidType,
// } from 'react-native-audio-recorder-player';
import { launchImageLibrary } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import BasePopup from '../../components/ui/BasePopup';
import { PermissionManager } from '../../utils/permissions';
import {
  ChatMessageItem,
  ChatMessageType,
  ChatReplyRef,
  ChatThreadService,
} from '../../services/ChatThreadService';
import { TelemetryService } from '../../services/TelemetryService';
import { RootStackParamList } from '../../navigation/types';

const LAST_SEEN_KEY = '@Alert:ChatThreadLastSeen';
const PAGE_SIZE = 30;
const CHAT_REACTION_EMOJIS = [
  '\u{1F44D}',
  '\u{2764}\u{FE0F}',
  '\u{1F602}',
  '\u{1F62E}',
  '\u{1F64F}',
  '\u{1F622}',
];
type AudioPlaybackEvent = {
  currentPosition?: number;
  duration?: number;
};

const audioRecorderPlayer = {
  addPlayBackListener: (_listener: (event: AudioPlaybackEvent) => void) => {},
  removePlayBackListener: () => {},
  setVolume: async (_volume: number) => {},
  startPlayer: async (_uri?: string) => {},
  startRecorder: async (..._args: unknown[]) => '',
  stopPlayer: async () => {},
  stopRecorder: async () => '',
};

const VOICE_AUDIO_SET = {};

type ChatThreadRouteParams = RootStackParamList['ChatThread'];

const toMillis = (value: number) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--';

const mergeMessages = (prev: ChatMessageItem[], next: ChatMessageItem[]) => {
  const map = new Map<string, ChatMessageItem>();
  prev.forEach(item => map.set(item.id, item));
  next.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
};

const messagePreview = (item: ChatMessageItem, t: (k: string) => string) => {
  if (item.deletedAtMs) return t('chat_deleted');
  if (item.type === 'text') return item.text || '';
  if (item.type === 'image') return t('chat_attachment_image');
  if (item.type === 'video') return t('chat_attachment_video');
  if (item.type === 'audio') return t('chat_attachment_audio');
  return item.meta?.fileName || t('chat_attachment_document');
};

const toReply = (
  item: ChatMessageItem,
  t: (k: string) => string,
): ChatReplyRef => ({
  id: item.id,
  senderId: item.senderId,
  senderName: item.senderName,
  type: item.type,
  preview: messagePreview(item, t),
});

const setClipboardText = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  const clipboard = (NativeModules as any)?.Clipboard;
  try {
    if (typeof clipboard?.setString === 'function') {
      clipboard.setString(text);
      return true;
    }
    if (typeof clipboard?.setStringContent === 'function') {
      clipboard.setStringContent(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

const ChatThreadScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ChatThread'>>();
  const params: ChatThreadRouteParams = route.params || {};
  const conversationId = params?.conversationId || params?.threadId;
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState(params?.title || t('messages_title'));
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<ChatMessageItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTarget, setMenuTarget] = useState<ChatMessageItem | null>(null);
  const [attachVisible, setAttachVisible] = useState(false);
  const [shareTextVisible, setShareTextVisible] = useState(false);
  const [shareText, setShareText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const oldestDocRef = useRef<number | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const members = useMemo(() => {
    const routeMembers = Array.isArray(params?.memberIds)
      ? params.memberIds.filter(Boolean)
      : [];
    if (!me?.id) return routeMembers;
    return Array.from(new Set([...routeMembers, me.id]));
  }, [params?.memberIds, me?.id]);

  const selectedMessages = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const set = new Set(selectedIds);
    return messages.filter(item => set.has(item.id));
  }, [messages, selectedIds]);

  const pin = useMemo(
    () => messages.find(item => !!item.pinnedAtMs),
    [messages],
  );

  const markSeen = useCallback(async () => {
    if (!conversationId) return;
    try {
      const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[conversationId] = Date.now();
      await AsyncStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }, [conversationId]);

  useEffect(() => {
    TelemetryService.trackEvent('chat_thread_open', {
      conversationId: conversationId || '',
    });
    void (async () => {
      const current = await ChatThreadService.getCurrentChatUser();
      setMe(current);
    })();
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recording) audioRecorderPlayer.stopRecorder().catch(() => {});
      audioRecorderPlayer.stopPlayer().catch(() => {});
      audioRecorderPlayer.removePlayBackListener();
    };
  }, [recording]);

  useEffect(() => {
    if (!conversationId || !me?.id) return;
    void ChatThreadService.ensureConversation({
      conversationId,
      title: params?.title || t('messages_title'),
      type: params?.type || 'group',
      members: members.length > 0 ? members : [me.id],
    });
  }, [conversationId, me?.id, members, params?.title, params?.type, t]);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = ChatThreadService.listenLatestMessages(
      conversationId,
      (incoming, oldestCursorMs) => {
        setMessages(prev => mergeMessages(prev, incoming));
        oldestDocRef.current = oldestCursorMs;
        setHasMore(incoming.length >= PAGE_SIZE);
      },
      () => {},
      PAGE_SIZE,
    );
    return () => unsubscribe();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !me?.id) return;
    const unsubscribe = ChatThreadService.listenConversations(
      me.id,
      conversations => {
        const current = conversations.find(item => item.id === conversationId);
        if (current?.title) setTitle(current.title);
      },
      () => {},
    );
    return () => unsubscribe();
  }, [conversationId, me?.id]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void markSeen();
    });
    return unsub;
  }, [markSeen, navigation]);

  const send = useCallback(
    async (payload: {
      type: ChatMessageType;
      text?: string;
      uri?: string;
      meta?: Record<string, any>;
    }) => {
      if (!conversationId || !me?.id || sending) return;
      const body = (payload.text || '').trim();
      if (payload.type === 'text' && !body) return;
      setSending(true);
      try {
        TelemetryService.trackEvent('chat_message_send_attempt', {
          type: payload.type,
        });
        await ChatThreadService.sendMessage({
          conversationId,
          type: payload.type,
          text: payload.type === 'text' ? body : payload.text,
          uri: payload.uri,
          meta: payload.meta,
          replyTo: reply ? toReply(reply, t) : undefined,
          conversation: {
            title,
            type: params?.type || 'group',
            members: members.length > 0 ? members : [me.id],
          },
        });
        setText('');
        setReply(null);
        await markSeen();
        TelemetryService.trackEvent('chat_message_send_success', {
          type: payload.type,
        });
      } catch {
        TelemetryService.trackEvent('chat_message_send_error', {
          type: payload.type,
        });
        Alert.alert(t('messages_title'), t('chat_send_failed'));
      } finally {
        setSending(false);
      }
    },
    [
      conversationId,
      me?.id,
      sending,
      reply,
      t,
      title,
      params?.type,
      members,
      markSeen,
    ],
  );

  const shareSelection = async (extra?: string) => {
    const list =
      selectedMessages.length > 0
        ? selectedMessages
        : menuTarget
        ? [menuTarget]
        : [];
    if (list.length === 0) return;
    const body = list
      .slice()
      .reverse()
      .map(item => `${item.senderName}: ${messagePreview(item, t)}`)
      .join('\n');
    const message = extra?.trim() ? `${extra.trim()}\n\n${body}` : body;
    await Share.share({ message }).catch(() => {});
  };

  const copySelection = () => {
    const list =
      selectedMessages.length > 0
        ? selectedMessages
        : menuTarget
        ? [menuTarget]
        : [];
    if (list.length === 0) return;
    const payload = list
      .slice()
      .reverse()
      .map(item => `${item.senderName}: ${messagePreview(item, t)}`)
      .join('\n');
    const copied = setClipboardText(payload);
    Alert.alert(
      t('chat_action_copy'),
      copied ? t('chat_copy_success') : t('chat_copy_unavailable'),
    );
    TelemetryService.trackEvent(
      copied ? 'chat_copy_success' : 'chat_copy_unavailable',
    );
    setMenuVisible(false);
  };

  const removeSelection = async () => {
    if (!conversationId) return;
    const list =
      selectedMessages.length > 0
        ? selectedMessages
        : menuTarget
        ? [menuTarget]
        : [];
    await Promise.all(
      list.map(item =>
        ChatThreadService.softDeleteMessage(conversationId, item.id).catch(
          () => {},
        ),
      ),
    );
    setSelectedIds([]);
    setMenuVisible(false);
  };

  const confirmRemoveSelection = () => {
    Alert.alert(t('chat_action_delete'), t('chat_confirm_delete'), [
      { text: t('chat_action_cancel'), style: 'cancel' },
      {
        text: t('chat_action_delete'),
        style: 'destructive',
        onPress: () => {
          TelemetryService.trackEvent('chat_soft_delete_confirmed');
          void removeSelection();
        },
      },
    ]);
  };

  const togglePinSelection = async () => {
    if (!conversationId) return;
    const list =
      selectedMessages.length > 0
        ? selectedMessages
        : menuTarget
        ? [menuTarget]
        : [];
    if (list.length === 0) return;
    const nextPin = list.some(item => !item.pinnedAtMs);
    await Promise.all(
      list.map(item =>
        ChatThreadService.togglePinned(conversationId, item.id, nextPin).catch(
          () => {},
        ),
      ),
    );
    setMenuVisible(false);
  };

  const toggleReaction = async (emoji: string) => {
    if (!conversationId || !me?.id) return;
    const target = menuTarget || selectedMessages[0];
    if (!target) return;
    const users = target.reactions?.[emoji] || [];
    await ChatThreadService.toggleReaction(
      conversationId,
      target.id,
      emoji,
      me.id,
      !users.includes(me.id),
    ).catch(() => {});
    TelemetryService.trackEvent('chat_reaction_toggle', { emoji });
  };

  const loadMore = useCallback(async () => {
    if (!conversationId || !oldestDocRef.current || !hasMore || loadingMore)
      return;
    setLoadingMore(true);
    try {
      const page = await ChatThreadService.loadOlderMessages(
        conversationId,
        oldestDocRef.current,
        PAGE_SIZE,
      );
      setMessages(prev => mergeMessages(prev, page.messages));
      oldestDocRef.current = page.nextCursor;
      setHasMore(page.hasMore);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore]);

  const pickAttachment = async (mode: 'photo' | 'video' | 'document') => {
    const status = await PermissionManager.requestStoragePermission();
    if (status !== 'granted') return;
    const options =
      mode === 'photo'
        ? { mediaType: 'photo' as const, selectionLimit: 1 }
        : mode === 'video'
        ? { mediaType: 'video' as const, selectionLimit: 1 }
        : { mediaType: 'mixed' as const, selectionLimit: 1 };
    const result = await launchImageLibrary(options);
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    const mime = (asset.type || '').toLowerCase();
    const type: ChatMessageType =
      mode === 'photo' || mime.startsWith('image/')
        ? 'image'
        : mode === 'video' || mime.startsWith('video/')
        ? 'video'
        : 'document';
    await send({
      type,
      uri: asset.uri,
      meta: {
        fileName: asset.fileName || undefined,
        mimeType: asset.type || undefined,
        size: typeof asset.fileSize === 'number' ? asset.fileSize : undefined,
      },
    });
  };

  const toggleRecording = async () => {
    if (!recording) {
      const status = await PermissionManager.requestMicrophonePermission();
      if (status !== 'granted') return;
      setRecording(true);
      setRecordSec(0);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(
        () => setRecordSec(prev => prev + 1),
        1000,
      );
      await audioRecorderPlayer
        .startRecorder(undefined, VOICE_AUDIO_SET, true)
        .catch(() => setRecording(false));
      return;
    }
    setRecording(false);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    const uri = await audioRecorderPlayer.stopRecorder().catch(() => '');
    if (uri)
      await send({ type: 'audio', uri, meta: { durationSec: recordSec } });
    setRecordSec(0);
  };

  const toggleAudio = async (item: ChatMessageItem) => {
    if (!item.uri || item.deletedAtMs) return;
    if (playingId === item.id) {
      await audioRecorderPlayer.stopPlayer().catch(() => {});
      audioRecorderPlayer.removePlayBackListener();
      setPlayingId(null);
      return;
    }
    await audioRecorderPlayer.stopPlayer().catch(() => {});
    audioRecorderPlayer.removePlayBackListener();
    const uri = item.uri.startsWith('file://')
      ? item.uri.replace(/^file:\/\//, '')
      : item.uri;
    await audioRecorderPlayer.startPlayer(uri).catch(() => {});
    await audioRecorderPlayer.setVolume(1.0).catch(() => {});
    setPlayingId(item.id);
    audioRecorderPlayer.addPlayBackListener(
      (e: { duration?: number; currentPosition?: number }) => {
        if (
          (e.duration || 0) > 0 &&
          (e.currentPosition || 0) >= (e.duration || 0)
        ) {
          void audioRecorderPlayer.stopPlayer().catch(() => {});
          audioRecorderPlayer.removePlayBackListener();
          setPlayingId(null);
        }
        return;
      },
    );
  };

  const renderItem = ({ item }: { item: ChatMessageItem }) => {
    const self = item.senderId === me?.id;
    const selected = selectedIds.includes(item.id);
    const deliveryLabel =
      item.status === 'failed'
        ? 'Falha'
        : item.status === 'pending'
        ? 'Enviando'
        : item.status === 'sent'
        ? 'Enviado'
        : 'Entregue';
    return (
      <Pressable
        style={[
          styles.row,
          self ? styles.rowSelf : styles.rowOther,
          selected && { backgroundColor: colors.primary + '16' },
        ]}
        onLongPress={() => {
          ReactNativeHapticFeedback.trigger('impactLight', {
            enableVibrateFallback: true,
          });
          TelemetryService.trackEvent('chat_message_long_press');
          setSelectedIds([item.id]);
          setMenuTarget(item);
          setMenuVisible(true);
        }}
        onPress={() => {
          if (self && item.status === 'failed' && conversationId) {
            void ChatThreadService.retryMessage(conversationId, item.id);
            return;
          }
          if (selectedIds.length > 0) {
            setSelectedIds(prev =>
              prev.includes(item.id)
                ? prev.filter(id => id !== item.id)
                : [...prev, item.id],
            );
            return;
          }
          if (item.type === 'audio') {
            void toggleAudio(item);
            return;
          }
          if (item.uri) {
            void Share.share({ url: item.uri, message: item.uri }).catch(
              () => {},
            );
          }
        }}
      >
        {!self ? (
          <Text style={[styles.sender, { color: colors.textSecondary }]}>
            {item.senderName || t('messages_unknown')}
          </Text>
        ) : null}
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: self ? colors.primary : colors.card,
              borderColor: self ? colors.primary : colors.border,
            },
          ]}
        >
          {item.replyTo ? (
            <Text
              style={[
                styles.replyLine,
                { color: self ? '#FFFFFFCC' : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {item.replyTo.senderName}: {item.replyTo.preview}
            </Text>
          ) : null}
          {item.deletedAtMs ? (
            <Text
              style={[
                styles.deleted,
                { color: self ? '#FFFFFFCC' : colors.textSecondary },
              ]}
            >
              {t('chat_deleted')}
            </Text>
          ) : null}
          {!item.deletedAtMs && item.type === 'text' ? (
            <Text
              style={[styles.message, { color: self ? '#FFF' : colors.text }]}
            >
              {item.text}
            </Text>
          ) : null}
          {!item.deletedAtMs && item.type === 'image' && item.uri ? (
            <Image source={{ uri: item.uri }} style={styles.image} />
          ) : null}
          {!item.deletedAtMs &&
          item.type !== 'text' &&
          item.type !== 'image' ? (
            <Text
              style={[styles.message, { color: self ? '#FFF' : colors.text }]}
            >
              {item.type === 'audio' && playingId === item.id
                ? `${t('chat_audio_play')} (pause)`
                : messagePreview(item, t)}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {self && !item.deletedAtMs ? (
              <Text
                style={[
                  styles.time,
                  { color: self ? '#FFFFFFCC' : colors.textSecondary },
                ]}
              >
                {deliveryLabel}
              </Text>
            ) : null}
            {item.pinnedAtMs ? (
              <Icon
                name="pin"
                size={11}
                color={self ? '#FFFFFFCC' : colors.textSecondary}
              />
            ) : null}
            <Text
              style={[
                styles.time,
                { color: self ? '#FFFFFFCC' : colors.textSecondary },
              ]}
            >
              {toMillis(item.createdAtMs)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  if (!conversationId) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {t('messages_empty')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={
            selectedIds.length
              ? () => setSelectedIds([])
              : () => navigation.goBack()
          }
        >
          <Icon
            name={selectedIds.length ? 'close' : 'arrow-left'}
            size={22}
            color={colors.text}
          />
        </TouchableOpacity>
        <View style={styles.headerMiddle}>
          <Text
            style={[styles.headerTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {selectedIds.length ? `${selectedIds.length}` : title}
          </Text>
          {!selectedIds.length ? (
            <Text
              style={[styles.headerSubtitle, { color: colors.textSecondary }]}
            >
              {t('messages_title')}
            </Text>
          ) : null}
        </View>
        {selectedIds.length ? (
          <View style={styles.headerActionGroup}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => void shareSelection()}
            >
              <Icon name="share-variant" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={confirmRemoveSelection}
            >
              <Icon name="delete-outline" size={20} color={colors.alert} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setAttachVisible(true)}
          >
            <Icon name="paperclip" size={20} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {pin ? (
        <View
          style={[
            styles.pinBanner,
            {
              backgroundColor: colors.primary + '12',
              borderColor: colors.primary + '44',
            },
          ]}
        >
          <Icon name="pin" size={13} color={colors.primary} />
          <Text
            style={[styles.pinText, { color: colors.text }]}
            numberOfLines={1}
          >
            {messagePreview(pin, t)}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        inverted
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.2}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={8}
        removeClippedSubviews
      />

      {reply ? (
        <View
          style={[
            styles.replyBar,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyTitle, { color: colors.primary }]}>
              {reply.senderName}
            </Text>
            <Text
              style={[styles.replyPreview, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {messagePreview(reply, t)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setReply(null)}
          >
            <Icon name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          { borderTopColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setAttachVisible(true)}
        >
          <Icon
            name="plus-circle-outline"
            size={24}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={setText}
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}
          placeholder={t('chat_send_message')}
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            {
              backgroundColor:
                text.trim().length > 0
                  ? colors.primary
                  : recording
                  ? colors.alert
                  : colors.primary,
              opacity: sending ? 0.72 : 1,
            },
          ]}
          disabled={sending}
          onPress={() =>
            text.trim().length > 0
              ? void send({ type: 'text', text })
              : void toggleRecording()
          }
        >
          <Icon
            name={
              text.trim().length > 0
                ? 'send'
                : recording
                ? 'stop'
                : 'microphone'
            }
            size={18}
            color="#FFF"
          />
        </TouchableOpacity>
      </View>

      {recording ? (
        <Text style={[styles.recording, { color: colors.alert }]}>
          {t('chat_recording')} {recordSec}s
        </Text>
      ) : null}
      {sending ? (
        <Text style={[styles.loading, { color: colors.textSecondary }]}>
          {t('chat_uploading_media')}
        </Text>
      ) : null}
      {loadingMore ? (
        <Text style={[styles.loading, { color: colors.textSecondary }]}>
          {t('map_loading')}
        </Text>
      ) : null}

      <BasePopup
        accessibilityLabel={t('chat_action_title')}
        contentStyle={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        onClose={() => setMenuVisible(false)}
        placement="bottom"
        showHandle
        visible={menuVisible}
      >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {t('chat_action_title')}
            </Text>
            <View style={styles.emojiRow}>
              {CHAT_REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.emojiBtn, { borderColor: colors.border }]}
                  onPress={() => void toggleReaction(emoji)}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={copySelection}
            >
              <Icon name="content-copy" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_action_copy')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={confirmRemoveSelection}
            >
              <Icon name="delete-outline" size={18} color={colors.alert} />
              <Text style={[styles.sheetText, { color: colors.alert }]}>
                {t('chat_action_delete')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => void shareSelection()}
            >
              <Icon
                name="share-variant-outline"
                size={18}
                color={colors.text}
              />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_share_forward')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => void togglePinSelection()}
            >
              <Icon name="pin-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_pin_toggle')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                const target = menuTarget || selectedMessages[0];
                if (target) setReply(target);
                setMenuVisible(false);
              }}
            >
              <Icon name="reply-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_reply')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setMenuVisible(false);
                if (menuTarget) setSelectedIds([menuTarget.id]);
              }}
            >
              <Icon
                name="checkbox-multiple-marked-outline"
                size={18}
                color={colors.text}
              />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_multi_select')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setMenuVisible(false);
                setShareTextVisible(true);
              }}
            >
              <Icon name="message-plus-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_add_text_share')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                const target = menuTarget || selectedMessages[0];
                if (!target || !conversationId) return;
                navigation.navigate('PrivateReply', {
                  sourceConversationId: conversationId,
                  targetUserId: target.senderId,
                  targetUserName: target.senderName || t('messages_unknown'),
                  quote: toReply(target, t),
                });
                setMenuVisible(false);
                setSelectedIds([]);
              }}
            >
              <Icon name="lock-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_private_reply')}
              </Text>
            </TouchableOpacity>
      </BasePopup>

      <BasePopup
        accessibilityLabel={t('chat_attach')}
        contentStyle={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        onClose={() => setAttachVisible(false)}
        placement="bottom"
        showHandle
        visible={attachVisible}
      >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {t('chat_attach')}
            </Text>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setAttachVisible(false);
                void pickAttachment('photo');
              }}
            >
              <Icon name="image-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_attach_photo')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setAttachVisible(false);
                void pickAttachment('video');
              }}
            >
              <Icon name="video-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_attach_video')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setAttachVisible(false);
                void pickAttachment('document');
              }}
            >
              <Icon
                name="file-document-outline"
                size={18}
                color={colors.text}
              />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_attach_document')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetAction}
              onPress={() => {
                setAttachVisible(false);
                void toggleRecording();
              }}
            >
              <Icon name="microphone-outline" size={18} color={colors.text} />
              <Text style={[styles.sheetText, { color: colors.text }]}>
                {t('chat_attach_audio')}
              </Text>
            </TouchableOpacity>
      </BasePopup>

      <BasePopup
        accessibilityLabel={t('chat_add_text_share')}
        avoidKeyboard
        contentStyle={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        maxWidth={520}
        onClose={() => setShareTextVisible(false)}
        placement="center"
        visible={shareTextVisible}
      >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {t('chat_add_text_share')}
            </Text>
            <TextInput
              value={shareText}
              onChangeText={setShareText}
              style={[
                styles.shareInput,
                { color: colors.text, borderColor: colors.border },
              ]}
              placeholder={t('chat_add_text_placeholder')}
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.cardBtn, { borderColor: colors.border }]}
                onPress={() => setShareTextVisible(false)}
              >
                <Text
                  style={[styles.cardBtnText, { color: colors.textSecondary }]}
                >
                  {t('chat_action_cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cardBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  void shareSelection(shareText);
                  setShareText('');
                  setShareTextVisible(false);
                }}
              >
                <Text style={styles.cardBtnSolid}>{t('chat_share')}</Text>
              </TouchableOpacity>
            </View>
      </BasePopup>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 58,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiddle: { flex: 1, minWidth: 0 },
  headerActionGroup: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: ThemeTokens.typography.families.android,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: ThemeTokens.typography.families.android,
  },
  pinBanner: {
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinText: { flex: 1, fontSize: 13 },
  list: { paddingHorizontal: 12, paddingVertical: 8 },
  row: { marginBottom: 8, borderRadius: 12, padding: 4, maxWidth: '96%' },
  rowSelf: { alignSelf: 'flex-end' },
  rowOther: { alignSelf: 'flex-start' },
  sender: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  bubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 110,
  },
  replyLine: { fontSize: 12, marginBottom: 2 },
  deleted: { fontSize: 14, fontStyle: 'italic' },
  message: { fontSize: 16, lineHeight: 21 },
  image: { width: 210, height: 148, borderRadius: 10 },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  },
  time: { fontSize: 11 },
  replyBar: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyTitle: { fontSize: 12, fontWeight: '700' },
  replyPreview: { fontSize: 12, marginTop: 2 },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recording: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 13,
    fontWeight: '700',
  },
  loading: { paddingBottom: 8, textAlign: 'center', fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16 },
  sheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.xl,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8 },
  sheetAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetText: { fontSize: 15, fontWeight: '600' },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  emojiBtn: {
    minWidth: 44,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 21 },
  card: {
    borderWidth: 1,
    borderRadius: 28,
    padding: ThemeTokens.spacing.xl,
  },
  shareInput: {
    minHeight: 90,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  cardActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  cardBtn: {
    flex: 1,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBtnText: { fontSize: 14, fontWeight: '700' },
  cardBtnSolid: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});

export default ChatThreadScreen;
