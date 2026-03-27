import { getAuth } from '@react-native-firebase/auth';
import {
  FirebaseFirestoreTypes,
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@react-native-firebase/firestore';
import NetInfo from '@react-native-community/netinfo';
import { ProfileService } from './ProfileService';
import { UserIdentityService } from './UserIdentityService';
import { ensureAnonymousAuth } from './FirebaseAuthResilienceService';
import {
  ChatPersistenceService,
  PersistedConversationRecord,
} from './chat/ChatPersistenceService';
import { ChatSyncService } from './chat/ChatSyncService';
import {
  ChatMessageStatus,
  buildOutboxRetryState,
  isOutboxItemReady,
  OutboxItemRecord,
  PersistedMessageRecord,
} from './chat/chatPersistenceUtils';
import {
  ensureGuardiansConversationInList,
  GUARDIANS_CONVERSATION_ID,
  GUARDIANS_DEFAULT_PREVIEW,
  GUARDIANS_DEFAULT_TITLE,
  isGuardiansConversation,
  sortConversationsWithGuardiansFirst,
} from './chat/guardiansConversation';

const CONVERSATIONS_COLLECTION = 'conversations';
const DEFAULT_PAGE_SIZE = 30;
const OUTBOX_POLL_INTERVAL_MS = 5000;
const OUTBOX_MAX_ATTEMPTS = 6;
const authClient = getAuth();
const db = getFirestore();

const conversationRef = (conversationId: string) =>
  doc(collection(db, CONVERSATIONS_COLLECTION), conversationId);

const messagesCollectionRef = (conversationId: string) =>
  collection(conversationRef(conversationId), 'messages');

export type ChatMessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

export type ChatReplyRef = {
  id: string;
  senderId: string;
  senderName: string;
  type: ChatMessageType;
  preview: string;
};

export type ChatMessageMeta = {
  fileName?: string;
  mimeType?: string;
  size?: number;
  durationSec?: number;
  uploadStatus?: 'uploaded' | 'local_only';
  storagePath?: string;
};

export type ChatMessageItem = {
  id: string;
  senderId: string;
  senderName: string;
  type: ChatMessageType;
  text?: string;
  uri?: string;
  meta?: ChatMessageMeta;
  createdAtMs: number;
  replyTo?: ChatReplyRef | null;
  reactions: Record<string, string[]>;
  pinnedAtMs?: number | null;
  deletedAtMs?: number | null;
  status: ChatMessageStatus;
  clientNonce?: string;
};

export type ChatConversationItem = {
  id: string;
  members: string[];
  type: 'private' | 'group' | 'monitor';
  title: string;
  updatedAtMs: number;
  pinned?: boolean;
  lastMessage?: {
    senderId?: string;
    senderName?: string;
    type?: ChatMessageType;
    text?: string;
    createdAtMs?: number;
  };
};

const normalizeConversationType = (raw: any): ChatConversationItem['type'] => {
  if (raw === 'private') return 'private';
  if (raw === 'monitor') return 'monitor';
  return 'group';
};

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
};

const normalizeMessageType = (raw: any): ChatMessageType => {
  if (raw === 'image' || raw === 'video' || raw === 'audio' || raw === 'document') return raw;
  return 'text';
};

const normalizeText = (value?: string) => {
  const raw = (value || '').trim();
  return raw.length > 0 ? raw : '';
};

const createClientNonce = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const messageIdFromNonce = (clientNonce: string) =>
  `m_${clientNonce.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;

const mapMessageDoc = (
  doc: FirebaseFirestoreTypes.QueryDocumentSnapshot<FirebaseFirestoreTypes.DocumentData>,
): ChatMessageItem => {
  const data = doc.data() || {};
  const reactionsRaw = data.reactions && typeof data.reactions === 'object' ? data.reactions : {};
  const reactions: Record<string, string[]> = {};
  Object.keys(reactionsRaw).forEach(key => {
    const users = Array.isArray(reactionsRaw[key]) ? reactionsRaw[key] : [];
    reactions[key] = users.filter(item => typeof item === 'string');
  });
  return {
    id: doc.id,
    senderId: typeof data.senderId === 'string' ? data.senderId : '',
    senderName: typeof data.senderName === 'string' ? data.senderName : '',
    type: normalizeMessageType(data.type),
    text: typeof data.text === 'string' ? data.text : undefined,
    uri: typeof data.uri === 'string' ? data.uri : undefined,
    meta: data.meta && typeof data.meta === 'object' ? data.meta : undefined,
    createdAtMs: toMillis(data.createdAt),
    replyTo: data.replyTo && typeof data.replyTo === 'object' ? data.replyTo : undefined,
    reactions,
    pinnedAtMs: data.pinnedAt ? toMillis(data.pinnedAt) : null,
    deletedAtMs: data.deletedAt ? toMillis(data.deletedAt) : null,
    status: doc.metadata?.hasPendingWrites ? 'pending' : 'delivered',
    clientNonce: typeof data.clientNonce === 'string' ? data.clientNonce : undefined,
  };
};

const mapConversationDoc = (
  doc: FirebaseFirestoreTypes.QueryDocumentSnapshot<FirebaseFirestoreTypes.DocumentData>,
): ChatConversationItem => {
  const data = doc.data() || {};
  const last = data.lastMessage && typeof data.lastMessage === 'object' ? data.lastMessage : null;
  const guardians = isGuardiansConversation(doc.id) || Boolean(data?.metadata?.isGuardians);
  return {
    id: doc.id,
    members: Array.isArray(data.members) ? data.members.filter(Boolean) : [],
    type: normalizeConversationType(data.type),
    title:
      typeof data.title === 'string' && data.title.trim().length > 0
        ? data.title
        : guardians
          ? GUARDIANS_DEFAULT_TITLE
          : doc.id,
    updatedAtMs: toMillis(data.updatedAt),
    pinned: guardians || Boolean(data.pinned),
    lastMessage: last
      ? {
          senderId: typeof last.senderId === 'string' ? last.senderId : undefined,
          senderName: typeof last.senderName === 'string' ? last.senderName : undefined,
          type: normalizeMessageType(last.type),
          text: typeof last.text === 'string' ? last.text : undefined,
          createdAtMs: toMillis(last.createdAt),
        }
      : undefined,
  };
};

const toPersistedConversation = (item: ChatConversationItem): PersistedConversationRecord => ({
  id: item.id,
  type: item.type,
  title: item.title || (isGuardiansConversation(item.id) ? GUARDIANS_DEFAULT_TITLE : item.id),
  participants: item.members,
  lastMessageAt: Number(item.lastMessage?.createdAtMs || item.updatedAtMs || 0),
  unreadCount: 0,
  pinned: isGuardiansConversation(item.id) || Boolean(item.pinned),
  archived: false,
  updatedAtMs: Number(item.updatedAtMs || item.lastMessage?.createdAtMs || 0),
  lastMessagePreview:
    item.lastMessage?.text ||
    (isGuardiansConversation(item.id) ? GUARDIANS_DEFAULT_PREVIEW : ''),
  lastMessageType: item.lastMessage?.type || 'text',
  lastSenderId: item.lastMessage?.senderId || '',
});

const toConversationFromPersisted = (item: PersistedConversationRecord): ChatConversationItem => ({
  id: item.id,
  members: item.participants || [],
  type: item.type,
  title: item.title || (isGuardiansConversation(item.id) ? GUARDIANS_DEFAULT_TITLE : item.id),
  updatedAtMs: item.updatedAtMs || item.lastMessageAt || 0,
  pinned: isGuardiansConversation(item.id) || Boolean(item.pinned),
  lastMessage: item.lastMessageAt
    ? {
        senderId: item.lastSenderId,
        type: item.lastMessageType,
        text: item.lastMessagePreview,
        createdAtMs: item.lastMessageAt,
      }
      : undefined,
});

const mapSyncConversationToItem = (item: {
  id: string;
  members?: string[];
  type?: 'private' | 'group' | 'monitor';
  title?: string;
  metadata?: { isGuardians?: boolean };
  updatedAtMs?: number;
  lastMessageAtMs?: number;
  lastMessage?: {
    senderId?: string;
    senderName?: string;
    type?: ChatMessageType;
    text?: string;
    createdAtMs?: number;
  };
}): ChatConversationItem => {
  const isGuardiansItem =
    isGuardiansConversation(item.id) || Boolean(item.metadata?.isGuardians);
  return {
    id: item.id,
    members: Array.isArray(item.members) ? item.members : [],
    type: normalizeConversationType(item.type),
    title: item.title || (isGuardiansItem ? GUARDIANS_DEFAULT_TITLE : item.id),
    updatedAtMs: Number(item.updatedAtMs || item.lastMessageAtMs || 0),
    pinned: isGuardiansItem,
    lastMessage: item.lastMessage
      ? {
          senderId: item.lastMessage.senderId,
          senderName: item.lastMessage.senderName,
          type: normalizeMessageType(item.lastMessage.type),
          text: item.lastMessage.text,
          createdAtMs: Number(item.lastMessage.createdAtMs || 0),
        }
      : undefined,
  };
};

const buildGuardiansConversation = (
  userId: string,
  base?: Partial<ChatConversationItem>,
): ChatConversationItem => ({
  id: GUARDIANS_CONVERSATION_ID,
  members:
    Array.isArray(base?.members) && base.members.length > 0
      ? base.members
      : [userId].filter(Boolean),
  type: 'group',
  title:
    typeof base?.title === 'string' && base.title.trim().length > 0
      ? base.title
      : GUARDIANS_DEFAULT_TITLE,
  updatedAtMs: Number(base?.updatedAtMs || base?.lastMessage?.createdAtMs || 0),
  pinned: true,
  lastMessage: base?.lastMessage || {
    type: 'text',
    text: GUARDIANS_DEFAULT_PREVIEW,
    createdAtMs: 0,
  },
});

const pinGuardiansAndSort = (
  userId: string,
  items: ChatConversationItem[],
): ChatConversationItem[] => {
  const existingGuardians = items.find(item => isGuardiansConversation(item.id));
  const guardians = buildGuardiansConversation(userId, existingGuardians);
  ChatPersistenceService.upsertConversation(toPersistedConversation(guardians));
  return ensureGuardiansConversationInList(
    sortConversationsWithGuardiansFirst(
      items.filter(item => !isGuardiansConversation(item.id)),
    ),
    guardians,
  );
};

const toPersistedMessage = (conversationId: string, item: ChatMessageItem): PersistedMessageRecord => ({
  id: item.id,
  conversationId,
  senderId: item.senderId,
  senderName: item.senderName,
  type: item.type,
  text: item.text,
  uri: item.uri,
  meta: item.meta,
  createdAtMs: item.createdAtMs,
  updatedAtMs: item.createdAtMs,
  status: item.status,
  clientNonce: item.clientNonce,
  replyTo: item.replyTo || null,
  reactions: item.reactions,
  pinnedAtMs: item.pinnedAtMs,
  deletedAtMs: item.deletedAtMs,
});

const toChatMessage = (item: PersistedMessageRecord): ChatMessageItem => ({
  id: item.id,
  senderId: item.senderId,
  senderName: item.senderName,
  type: item.type,
  text: item.text,
  uri: item.uri,
  meta: item.meta as ChatMessageMeta | undefined,
  createdAtMs: item.createdAtMs,
  replyTo: (item.replyTo as ChatReplyRef | null) || undefined,
  reactions: item.reactions || {},
  pinnedAtMs: item.pinnedAtMs,
  deletedAtMs: item.deletedAtMs,
  status: item.status,
  clientNonce: item.clientNonce,
});

let outboxWorkerStarted = false;
let outboxTimer: ReturnType<typeof setInterval> | null = null;
let outboxNetUnsubscribe: (() => void) | null = null;
let outboxProcessing = false;

export const ChatThreadService = {
  async getCurrentChatUser(): Promise<{ id: string; name: string }> {
    await ensureAnonymousAuth();
    const current = authClient.currentUser;
    const profile = await ProfileService.getProfile();
    const senderName = normalizeText(profile.name) || 'Alert User';
    if (current?.uid) return { id: current.uid, name: senderName };
    const deviceId = await UserIdentityService.getDeviceId();
    return { id: `device_${deviceId}`, name: senderName };
  },

  getCachedConversations(userId: string): ChatConversationItem[] {
    const cached = ChatPersistenceService.getConversations(userId).map(toConversationFromPersisted);
    return pinGuardiansAndSort(userId, cached);
  },

  async refreshConversations(userId: string): Promise<ChatConversationItem[]> {
    await ChatPersistenceService.initialize();
    const cached = this.getCachedConversations(userId);
    const pulled = await ChatSyncService.pullConversations({ limit: 80 });
    if (!Array.isArray(pulled.items) || pulled.items.length === 0) {
      return cached;
    }
    const mapped = pulled.items.map(mapSyncConversationToItem);
    ChatPersistenceService.upsertConversations(mapped.map(toPersistedConversation));
    const merged = Array.from(new Map([...cached, ...mapped].map(item => [item.id, item])).values());
    return pinGuardiansAndSort(userId, merged);
  },

  getCachedMessages(conversationId: string, pageSize = DEFAULT_PAGE_SIZE): ChatMessageItem[] {
    return ChatPersistenceService.getMessagesPage({
      conversationId,
      limit: pageSize,
      beforeCreatedAtMs: null,
    }).messages.map(toChatMessage);
  },

  async ensureGuardiansConversation(userId?: string): Promise<ChatConversationItem> {
    await ChatPersistenceService.initialize();
    const resolvedUserId = userId || (await this.getCurrentChatUser()).id;
    const cached = ChatPersistenceService.getConversations(resolvedUserId).map(toConversationFromPersisted);
    const existing = cached.find(item => isGuardiansConversation(item.id));
    const guardiansConversation = buildGuardiansConversation(resolvedUserId, existing);
    ChatPersistenceService.upsertConversation(toPersistedConversation(guardiansConversation));

    try {
      const payload: Record<string, unknown> = {
        type: 'group',
        title: guardiansConversation.title,
        updatedAt: serverTimestamp(),
        metadata: {
          isGuardians: true,
          conversationType: 'GUARDIANS_GROUP',
        },
      };
      if (guardiansConversation.members.length > 0) {
        payload.members = arrayUnion(...guardiansConversation.members);
      }
      await setDoc(conversationRef(GUARDIANS_CONVERSATION_ID), payload, { merge: true });
    } catch {
      // Offline-safe: local conversation is enough for immediate access.
    }

    return guardiansConversation;
  },

  listenConversations(
    userId: string,
    onData: (items: ChatConversationItem[]) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    this.startOutboxWorker();
    let active = true;

    void (async () => {
      await ChatPersistenceService.initialize();
      if (!active) return;
      const cached = this.getCachedConversations(userId);
      if (cached.length > 0) onData(cached);

      const pulled = await ChatSyncService.pullConversations({ limit: 80 });
      if (!active || !Array.isArray(pulled.items) || pulled.items.length === 0) return;
      const mapped = pulled.items.map(mapSyncConversationToItem);
      ChatPersistenceService.upsertConversations(mapped.map(toPersistedConversation));
      const merged = Array.from(new Map([...cached, ...mapped].map(item => [item.id, item])).values());
      onData(pinGuardiansAndSort(userId, merged));
    })();

    const conversationsQuery = query(
      collection(db, CONVERSATIONS_COLLECTION),
      where('members', 'array-contains', userId),
    );
    const unsubscribe = onSnapshot(
      conversationsQuery,
      snapshot => {
        if (!active) return;
        const items = pinGuardiansAndSort(userId, snapshot.docs.map(mapConversationDoc));
        ChatPersistenceService.upsertConversations(items.map(toPersistedConversation));
        onData(items);
      },
      error => onError?.(error),
    );

    return () => {
      active = false;
      unsubscribe();
    };
  },

  listenLatestMessages(
    conversationId: string,
    onData: (messages: ChatMessageItem[], oldestCursorMs: number | null) => void,
    onError?: (error: unknown) => void,
    pageSize = DEFAULT_PAGE_SIZE,
  ): () => void {
    this.startOutboxWorker();
    let active = true;

    void (async () => {
      await ChatPersistenceService.initialize();
      if (!active) return;
      const cached = this.getCachedMessages(conversationId, pageSize);
      if (cached.length > 0) {
        onData(cached, cached[cached.length - 1].createdAtMs);
      }

      const pulled = await ChatSyncService.pullMessages({ conversationId, limit: pageSize });
      if (!active || !Array.isArray(pulled.items) || pulled.items.length === 0) return;
      const mapped = pulled.items.map(item => ({
        id: item.id,
        senderId: item.senderId,
        senderName: item.senderName,
        type: normalizeMessageType(item.type),
        text: item.text,
        uri: item.uri,
        meta: item.meta as ChatMessageMeta | undefined,
        createdAtMs: Number(item.createdAtMs || 0),
        replyTo: (item.replyTo as ChatReplyRef | null) || undefined,
        reactions: item.reactions || {},
        pinnedAtMs: item.pinnedAtMs ?? null,
        deletedAtMs: item.deletedAtMs ?? null,
        status: 'delivered' as ChatMessageStatus,
        clientNonce: item.clientNonce,
      })) as ChatMessageItem[];
      ChatPersistenceService.upsertMessages(
        conversationId,
        mapped.map(item => toPersistedMessage(conversationId, item)),
      );
      const merged = this.getCachedMessages(conversationId, pageSize);
      onData(merged, merged.length > 0 ? merged[merged.length - 1].createdAtMs : null);
    })();

    const latestMessagesQuery = query(
      messagesCollectionRef(conversationId),
      orderBy('createdAt', 'desc'),
      limit(pageSize),
    );
    const unsubscribe = onSnapshot(
      latestMessagesQuery,
      snapshot => {
        if (!active) return;
        const mapped = snapshot.docs.map(mapMessageDoc);
        ChatPersistenceService.upsertMessages(
          conversationId,
          mapped.map(item => toPersistedMessage(conversationId, item)),
        );
        const merged = this.getCachedMessages(conversationId, pageSize);
        onData(merged, merged.length > 0 ? merged[merged.length - 1].createdAtMs : null);
      },
      error => onError?.(error),
    );

    return () => {
      active = false;
      unsubscribe();
    };
  },

  async loadOlderMessages(
    conversationId: string,
    cursorMs: number | null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<{ messages: ChatMessageItem[]; nextCursor: number | null; hasMore: boolean }> {
    await ChatPersistenceService.initialize();
    const local = ChatPersistenceService.getMessagesPage({
      conversationId,
      beforeCreatedAtMs: cursorMs,
      limit: pageSize,
    });
    if (local.messages.length >= pageSize) {
      const nextCursor =
        local.messages.length > 0 ? local.messages[local.messages.length - 1].createdAtMs : cursorMs;
      return {
        messages: local.messages.map(toChatMessage),
        nextCursor: nextCursor || null,
        hasMore: local.hasMore,
      };
    }

    try {
      let messagesQuery: FirebaseFirestoreTypes.Query<FirebaseFirestoreTypes.DocumentData> = query(
        messagesCollectionRef(conversationId),
        orderBy('createdAt', 'desc'),
        limit(pageSize),
      );
      if (cursorMs && cursorMs > 0) {
        messagesQuery = query(
          messagesCollectionRef(conversationId),
          where('createdAt', '<', Timestamp.fromMillis(cursorMs)),
          orderBy('createdAt', 'desc'),
          limit(pageSize),
        );
      }
      const snapshot = await getDocs(messagesQuery);
      const mapped = snapshot.docs.map(mapMessageDoc);
      ChatPersistenceService.upsertMessages(
        conversationId,
        mapped.map(item => toPersistedMessage(conversationId, item)),
      );
    } catch {
      // ignore
    }

    const merged = ChatPersistenceService.getMessagesPage({
      conversationId,
      beforeCreatedAtMs: cursorMs,
      limit: pageSize,
    });
    const nextCursor =
      merged.messages.length > 0 ? merged.messages[merged.messages.length - 1].createdAtMs : cursorMs;
    return {
      messages: merged.messages.map(toChatMessage),
      nextCursor: nextCursor || null,
      hasMore: merged.hasMore || merged.messages.length >= pageSize,
    };
  },

  async ensureConversation(params: {
    conversationId: string;
    title?: string;
    type?: 'private' | 'group' | 'monitor';
    members: string[];
  }): Promise<void> {
    const isGuardians = isGuardiansConversation(params.conversationId);
    const title = normalizeText(params.title) || (isGuardians ? GUARDIANS_DEFAULT_TITLE : 'Alert');
    const members = Array.from(new Set((params.members || []).map(item => normalizeText(item)).filter(Boolean)));
    const payload: Record<string, unknown> = {
      type: isGuardians ? 'group' : params.type || 'group',
      title,
      updatedAt: serverTimestamp(),
    };
    if (isGuardians) {
      payload.metadata = {
        isGuardians: true,
        conversationType: 'GUARDIANS_GROUP',
      };
    }
    if (members.length > 0) payload.members = arrayUnion(...members);
    try {
      await setDoc(conversationRef(params.conversationId), payload, { merge: true });
    } catch {
      // offline-safe fallback keeps local conversation state.
    }
    ChatPersistenceService.upsertConversation({
      id: params.conversationId,
      type: isGuardians ? 'group' : params.type || 'group',
      title,
      participants: members,
      pinned: isGuardians,
      updatedAtMs: Date.now(),
    });
  },

  async sendMessage(params: {
    conversationId: string;
    type: ChatMessageType;
    text?: string;
    uri?: string;
    meta?: ChatMessageMeta;
    replyTo?: ChatReplyRef | null;
    conversation?: {
      title?: string;
      type?: 'private' | 'group' | 'monitor';
      members: string[];
    };
  }): Promise<string> {
    this.startOutboxWorker();
    await ChatPersistenceService.initialize();
    const me = await this.getCurrentChatUser();
    if (params.conversation) {
      await this.ensureConversation({
        conversationId: params.conversationId,
        title: params.conversation.title,
        type: params.conversation.type,
        members: params.conversation.members,
      });
    }

    const clientNonce = createClientNonce();
    const messageId = messageIdFromNonce(clientNonce);
    const createdAtMs = Date.now();
    const text = normalizeText(params.text) || params.text;

    const local: ChatMessageItem = {
      id: messageId,
      senderId: me.id,
      senderName: me.name,
      type: params.type,
      text,
      uri: params.uri,
      meta: params.meta,
      createdAtMs,
      replyTo: params.replyTo,
      reactions: {},
      pinnedAtMs: null,
      deletedAtMs: null,
      status: 'pending',
      clientNonce,
    };
    ChatPersistenceService.upsertMessages(params.conversationId, [toPersistedMessage(params.conversationId, local)]);

    const outboxId = `${params.conversationId}:${messageId}`;
    const outboxItem: OutboxItemRecord = {
      id: outboxId,
      conversationId: params.conversationId,
      messageId,
      clientNonce,
      createdAtMs,
      attempts: 0,
      nextRetryAtMs: createdAtMs,
      payload: {
        type: params.type,
        text,
        uri: params.uri,
        meta: params.meta,
        replyTo: params.replyTo,
        conversation: params.conversation,
      },
    };
    ChatPersistenceService.enqueueOutbox(outboxItem);
    void this.processOutbox();
    return messageId;
  },

  async retryMessage(conversationId: string, messageId: string): Promise<void> {
    await ChatPersistenceService.initialize();
    const queue = ChatPersistenceService.getOutbox();
    const existing = queue.find(item => item.conversationId === conversationId && item.messageId === messageId);
    if (existing) {
      ChatPersistenceService.updateOutboxItem(existing.id, item => ({
        ...item,
        attempts: 0,
        nextRetryAtMs: Date.now(),
      }));
      ChatPersistenceService.updateMessageStatus(conversationId, messageId, 'pending');
      void this.processOutbox();
      return;
    }
    const failed = ChatPersistenceService.getMessages(conversationId).find(item => item.id === messageId);
    if (!failed || failed.status !== 'failed') return;
    ChatPersistenceService.enqueueOutbox({
      id: `${conversationId}:${messageId}`,
      conversationId,
      messageId,
      clientNonce: failed.clientNonce || createClientNonce(),
      createdAtMs: failed.createdAtMs || Date.now(),
      attempts: 0,
      nextRetryAtMs: Date.now(),
      payload: {
        type: failed.type,
        text: failed.text,
        uri: failed.uri,
        meta: failed.meta,
        replyTo: (failed.replyTo as ChatReplyRef | null) || undefined,
      },
    });
    ChatPersistenceService.updateMessageStatus(conversationId, messageId, 'pending');
    void this.processOutbox();
  },

  async softDeleteMessage(conversationId: string, messageId: string): Promise<void> {
    ChatPersistenceService.softDeleteMessage(conversationId, messageId);
    await setDoc(
      doc(messagesCollectionRef(conversationId), messageId),
      {
        deletedAt: serverTimestamp(),
        text: deleteField(),
        uri: deleteField(),
        meta: deleteField(),
        replyTo: deleteField(),
        status: 'delivered',
      },
      { merge: true },
    );
  },

  async togglePinned(conversationId: string, messageId: string, pin: boolean): Promise<void> {
    const local = ChatPersistenceService.getMessages(conversationId).map(item =>
      item.id === messageId
        ? { ...item, pinnedAtMs: pin ? Date.now() : null, updatedAtMs: Date.now() }
        : item,
    );
    ChatPersistenceService.upsertMessages(conversationId, local);
    await setDoc(
      doc(messagesCollectionRef(conversationId), messageId),
      { pinnedAt: pin ? serverTimestamp() : deleteField() },
      { merge: true },
    );
  },

  async toggleReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
    userId: string,
    selected: boolean,
  ): Promise<void> {
    await setDoc(
      doc(messagesCollectionRef(conversationId), messageId),
      {
        [`reactions.${emoji}`]: selected ? arrayUnion(userId) : arrayRemove(userId),
      },
      { merge: true },
    );
  },

  async processOutbox(): Promise<void> {
    if (outboxProcessing) return;
    outboxProcessing = true;
    try {
      await ChatPersistenceService.initialize();
      const network = await NetInfo.fetch();
      if (!network.isConnected) return;

      const me = await this.getCurrentChatUser();
      const queue = ChatPersistenceService.getOutbox().filter(item => isOutboxItemReady(item, Date.now()));

      for (const item of queue) {
        let ok = false;
        try {
          const text = normalizeText(item.payload.text);
          const payload: Record<string, any> = {
            senderId: me.id,
            senderName: me.name,
            type: item.payload.type,
            createdAt: serverTimestamp(),
            clientNonce: item.clientNonce,
            status: 'sent',
          };
          if (text) payload.text = text;
          if (item.payload.uri) payload.uri = item.payload.uri;
          if (item.payload.meta) payload.meta = item.payload.meta;
          if (item.payload.replyTo) payload.replyTo = item.payload.replyTo;

          await setDoc(
            doc(messagesCollectionRef(item.conversationId), item.messageId),
            payload,
            { merge: true },
          );

          await setDoc(
            conversationRef(item.conversationId),
            {
              updatedAt: serverTimestamp(),
              lastMessage: {
                senderId: me.id,
                senderName: me.name,
                type: item.payload.type,
                text:
                  item.payload.type === 'text'
                    ? text || '...'
                    : item.payload.type === 'image'
                      ? '[image]'
                      : item.payload.type === 'video'
                        ? '[video]'
                        : item.payload.type === 'audio'
                          ? '[audio]'
                          : '[document]',
                createdAt: serverTimestamp(),
              },
            },
            { merge: true },
          );
          ChatPersistenceService.updateMessageStatus(item.conversationId, item.messageId, 'sent');
          ok = true;
        } catch {
          ok = false;
        }

        if (ok) {
          ChatPersistenceService.removeOutboxItem(item.id);
          continue;
        }
        const retry = buildOutboxRetryState({
          attempts: item.attempts,
          nowMs: Date.now(),
          maxAttempts: OUTBOX_MAX_ATTEMPTS,
        });
        if (retry.terminal) {
          ChatPersistenceService.removeOutboxItem(item.id);
          ChatPersistenceService.updateMessageStatus(item.conversationId, item.messageId, 'failed');
        } else {
          ChatPersistenceService.updateOutboxItem(item.id, current => ({
            ...current,
            attempts: retry.attempts,
            nextRetryAtMs: retry.nextRetryAtMs,
          }));
        }
      }
    } finally {
      outboxProcessing = false;
    }
  },

  startOutboxWorker(): void {
    if (outboxWorkerStarted) return;
    outboxWorkerStarted = true;
    outboxTimer = setInterval(() => {
      void this.processOutbox();
    }, OUTBOX_POLL_INTERVAL_MS);
    outboxNetUnsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected) void this.processOutbox();
    });
    void this.processOutbox();
  },

  dispose(): void {
    if (outboxTimer) {
      clearInterval(outboxTimer);
      outboxTimer = null;
    }
    if (outboxNetUnsubscribe) {
      outboxNetUnsubscribe();
      outboxNetUnsubscribe = null;
    }
    outboxWorkerStarted = false;
  },
};
