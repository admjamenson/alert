import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';
import CryptoJS from 'crypto-js';
import DeviceInfo from 'react-native-device-info';
import {
  ChatMessageStatus,
  OutboxItemRecord,
  PersistedMessageRecord,
  upsertMessagesWithIdempotency,
} from './chatPersistenceUtils';
import { isGuardiansConversation } from './guardiansConversation';

export type PersistedConversationRecord = {
  id: string;
  type: 'private' | 'group' | 'monitor';
  title: string;
  participants: string[];
  lastMessageAt: number;
  unreadCount: number;
  pinned: boolean;
  archived: boolean;
  updatedAtMs: number;
  lastMessagePreview?: string;
  lastMessageType?: 'text' | 'image' | 'video' | 'audio' | 'document';
  lastSenderId?: string;
};

const STORAGE_ID = 'alert-chat-db-v1';
const CONVERSATIONS_INDEX_KEY = 'chat:v1:conversations:index';
const OUTBOX_KEY = 'chat:v1:outbox';
const LEGACY_MIGRATION_FLAG_KEY = 'chat:v1:migration:legacy-monitor';
const LEGACY_CHAT_STORAGE_KEY = '@Alert:ChatMessages';
const MAX_MESSAGES_PER_CONVERSATION = 1200;
const FALLBACK_PREFIX = '@Alert:ChatKV:';

const buildEncryptionKey = (): string => {
  const uniqueId = DeviceInfo.getUniqueIdSync?.() || 'alert-device';
  return CryptoJS.SHA256(`alert-chat::${uniqueId}`).toString().slice(0, 32);
};

type SyncKvBackend = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  getBoolean: (key: string) => boolean | undefined;
};

let backend: SyncKvBackend | null = null;
let usingFallback = false;
let fallbackLoaded = false;
let fallbackLoadPromise: Promise<void> | null = null;
const fallbackCache = new Map<string, string>();

const makeMmkvBackend = (): SyncKvBackend | null => {
  try {
    const mmkv = new MMKV({
      id: STORAGE_ID,
      encryptionKey: buildEncryptionKey(),
    });
    mmkv.getAllKeys();
    return {
      getString: key => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      delete: key => mmkv.delete(key),
      getBoolean: key => mmkv.getBoolean(key),
    };
  } catch {
    return null;
  }
};

const makeFallbackBackend = (): SyncKvBackend => ({
  getString: key => fallbackCache.get(key),
  set: (key, value) => {
    fallbackCache.set(key, value);
    void AsyncStorage.setItem(`${FALLBACK_PREFIX}${key}`, value);
  },
  delete: key => {
    fallbackCache.delete(key);
    void AsyncStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  },
  getBoolean: key => {
    const value = fallbackCache.get(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  },
});

const ensureBackend = (): SyncKvBackend => {
  if (backend) return backend;
  const mmkv = makeMmkvBackend();
  if (mmkv) {
    backend = mmkv;
    usingFallback = false;
    return backend;
  }
  usingFallback = true;
  backend = makeFallbackBackend();
  return backend;
};

const loadFallbackCache = async (): Promise<void> => {
  if (!usingFallback || fallbackLoaded) return;
  if (fallbackLoadPromise) return fallbackLoadPromise;

  fallbackLoadPromise = (async () => {
    const keys = await AsyncStorage.getAllKeys();
    const scoped = keys.filter(key => key.startsWith(FALLBACK_PREFIX));
    if (scoped.length === 0) {
      fallbackLoaded = true;
      return;
    }
    const values = await AsyncStorage.multiGet(scoped);
    values.forEach(([key, value]) => {
      if (value === null) return;
      fallbackCache.set(key.replace(FALLBACK_PREFIX, ''), value);
    });
    fallbackLoaded = true;
  })();

  return fallbackLoadPromise;
};

const conversationKey = (conversationId: string) =>
  `chat:v1:conversation:${conversationId}`;
const messagesKey = (conversationId: string) =>
  `chat:v1:messages:${conversationId}`;

const parseJson = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  ensureBackend().set(key, JSON.stringify(value));
};

const readConversationsIndex = (): string[] =>
  parseJson<string[]>(ensureBackend().getString(CONVERSATIONS_INDEX_KEY), []);

const writeConversationsIndex = (ids: string[]): void => {
  const next = Array.from(new Set(ids.filter(Boolean)));
  writeJson(CONVERSATIONS_INDEX_KEY, next);
};

const readMessages = (conversationId: string): PersistedMessageRecord[] =>
  parseJson<PersistedMessageRecord[]>(ensureBackend().getString(messagesKey(conversationId)), []);

const writeMessages = (
  conversationId: string,
  list: PersistedMessageRecord[],
): void => {
  const next = list.slice(0, MAX_MESSAGES_PER_CONVERSATION);
  writeJson(messagesKey(conversationId), next);
};

const normalizeConversation = (
  item: Partial<PersistedConversationRecord> & Pick<PersistedConversationRecord, 'id'>,
): PersistedConversationRecord => {
  const now = Date.now();
  return {
    id: item.id,
    type: item.type || 'group',
    title: item.title || item.id,
    participants: Array.isArray(item.participants) ? item.participants.filter(Boolean) : [],
    lastMessageAt: Number(item.lastMessageAt || 0),
    unreadCount: Number(item.unreadCount || 0),
    pinned: isGuardiansConversation(item.id) || Boolean(item.pinned),
    archived: Boolean(item.archived),
    updatedAtMs: Number(item.updatedAtMs || item.lastMessageAt || now),
    lastMessagePreview: item.lastMessagePreview || '',
    lastMessageType: item.lastMessageType || 'text',
    lastSenderId: item.lastSenderId || '',
  };
};

const markConversationUpdated = (conversation: PersistedConversationRecord) => {
  const index = readConversationsIndex();
  if (!index.includes(conversation.id)) {
    writeConversationsIndex([conversation.id, ...index]);
  }
};

const buildLegacyMonitorConversation = (
  records: Array<{
    id?: string;
    sender?: string;
    type?: string;
    text?: string;
    uri?: string;
    timestamp?: string;
    isSelf?: boolean;
  }>,
): { conversation: PersistedConversationRecord; messages: PersistedMessageRecord[] } => {
  const conversationId = 'monitor-legacy';
  const now = Date.now();
  const messages = records.map((item, index) => {
    const createdAtMs = item.timestamp ? new Date(item.timestamp).getTime() : now - index;
    const messageId = String(item.id || `legacy-${index}-${createdAtMs}`);
    const type: PersistedMessageRecord['type'] =
      item.type === 'image' ||
      item.type === 'video' ||
      item.type === 'audio' ||
      item.type === 'document'
        ? item.type
        : 'text';
    return {
      id: messageId,
      conversationId,
      senderId: item.isSelf ? 'self' : String(item.sender || 'contact'),
      senderName: String(item.sender || 'Alert'),
      type,
      text: item.text,
      uri: item.uri,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : now - index,
      updatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : now - index,
      status: 'delivered' as ChatMessageStatus,
    };
  });
  messages.sort((a, b) => b.createdAtMs - a.createdAtMs);
  const newest = messages[0];

  return {
    conversation: {
      id: conversationId,
      type: 'monitor',
      title: 'Monitor',
      participants: [],
      lastMessageAt: newest?.createdAtMs || now,
      unreadCount: 0,
      pinned: false,
      archived: false,
      updatedAtMs: newest?.createdAtMs || now,
      lastMessagePreview: newest?.text || '',
      lastMessageType: newest?.type || 'text',
      lastSenderId: newest?.senderId || '',
    },
    messages,
  };
};

let migrationPromise: Promise<void> | null = null;

const runLegacyMigration = async (): Promise<void> => {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const done = ensureBackend().getBoolean(LEGACY_MIGRATION_FLAG_KEY);
    if (done) return;

    try {
      const raw = await AsyncStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
      const parsed = parseJson<any[]>(raw || undefined, []);
      if (parsed.length > 0) {
        const mapped = buildLegacyMonitorConversation(parsed);
        ChatPersistenceService.upsertConversation(mapped.conversation);
        ChatPersistenceService.upsertMessages(
          mapped.conversation.id,
          mapped.messages,
        );
      }
    } catch {
      // Best-effort migration only.
    } finally {
      ensureBackend().set(LEGACY_MIGRATION_FLAG_KEY, 'true');
    }
  })();

  return migrationPromise;
};

export const ChatPersistenceService = {
  async initialize(): Promise<void> {
    ensureBackend();
    await loadFallbackCache();
    await runLegacyMigration();
  },

  clearAll(): void {
    const ids = readConversationsIndex();
    ids.forEach(id => {
      ensureBackend().delete(conversationKey(id));
      ensureBackend().delete(messagesKey(id));
    });
    ensureBackend().delete(CONVERSATIONS_INDEX_KEY);
    ensureBackend().delete(OUTBOX_KEY);
  },

  upsertConversation(
    conversation: Partial<PersistedConversationRecord> &
      Pick<PersistedConversationRecord, 'id'>,
  ): PersistedConversationRecord {
    const existing = this.getConversation(conversation.id);
    const merged = normalizeConversation({
      ...(existing || {}),
      ...conversation,
      id: conversation.id,
      updatedAtMs: Math.max(
        existing?.updatedAtMs || 0,
        Number(conversation.updatedAtMs || 0),
        Number(conversation.lastMessageAt || 0),
      ),
    });
    writeJson(conversationKey(merged.id), merged);
    markConversationUpdated(merged);
    return merged;
  },

  upsertConversations(
    conversations: Array<
      Partial<PersistedConversationRecord> & Pick<PersistedConversationRecord, 'id'>
    >,
  ): PersistedConversationRecord[] {
    return conversations.map(item => this.upsertConversation(item));
  },

  getConversation(conversationId: string): PersistedConversationRecord | null {
    const parsed = parseJson<PersistedConversationRecord | null>(
      ensureBackend().getString(conversationKey(conversationId)),
      null,
    );
    return parsed && parsed.id ? normalizeConversation(parsed) : null;
  },

  getConversations(userId?: string): PersistedConversationRecord[] {
    const ids = readConversationsIndex();
    const items = ids
      .map(id => this.getConversation(id))
      .filter(Boolean) as PersistedConversationRecord[];
    const normalizedUserId = String(userId || '').trim();
    const filtered = normalizedUserId
      ? items.filter(
          item =>
            isGuardiansConversation(item.id) ||
            item.participants.length === 0 ||
            item.participants.includes(normalizedUserId),
        )
      : items;
    return filtered.sort((a, b) => {
      const aGuardians = isGuardiansConversation(a.id);
      const bGuardians = isGuardiansConversation(b.id);
      if (aGuardians && !bGuardians) return -1;
      if (!aGuardians && bGuardians) return 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
      return b.lastMessageAt - a.lastMessageAt;
    });
  },

  upsertMessages(
    conversationId: string,
    incoming: PersistedMessageRecord[],
  ): PersistedMessageRecord[] {
    if (!conversationId || incoming.length === 0) {
      return this.getMessages(conversationId);
    }
    const current = readMessages(conversationId);
    const merged = upsertMessagesWithIdempotency(
      current,
      incoming
        .filter(item => item && item.id)
        .map(item => ({
          ...item,
          conversationId,
          updatedAtMs: Number(item.updatedAtMs || item.createdAtMs || Date.now()),
          createdAtMs: Number(item.createdAtMs || Date.now()),
        })),
    );
    writeMessages(conversationId, merged);

    const newest = merged[0];
    if (newest) {
      const existingConversation = this.getConversation(conversationId);
      this.upsertConversation({
        id: conversationId,
        type: existingConversation?.type || 'group',
        title: existingConversation?.title || conversationId,
        participants: existingConversation?.participants || [],
        lastMessageAt: newest.createdAtMs,
        updatedAtMs: newest.createdAtMs,
        lastMessagePreview: newest.text || newest.meta?.fileName || '',
        lastMessageType: newest.type,
        lastSenderId: newest.senderId,
      });
    }

    return merged;
  },

  getMessages(conversationId: string): PersistedMessageRecord[] {
    if (!conversationId) return [];
    return readMessages(conversationId);
  },

  getMessagesPage(params: {
    conversationId: string;
    beforeCreatedAtMs?: number | null;
    limit: number;
  }): { messages: PersistedMessageRecord[]; hasMore: boolean } {
    const limit = Math.max(1, params.limit);
    const list = readMessages(params.conversationId);
    const before = Number(params.beforeCreatedAtMs || 0);
    const filtered =
      before > 0
        ? list.filter(item => item.createdAtMs < before)
        : list;
    const page = filtered.slice(0, limit);
    return {
      messages: page,
      hasMore: filtered.length > page.length,
    };
  },

  updateMessageStatus(
    conversationId: string,
    messageId: string,
    status: ChatMessageStatus,
  ): void {
    if (!conversationId || !messageId) return;
    const list = readMessages(conversationId);
    const next = list.map(item =>
      item.id === messageId
        ? {
            ...item,
            status,
            updatedAtMs: Date.now(),
          }
        : item,
    );
    writeMessages(conversationId, next);
  },

  softDeleteMessage(conversationId: string, messageId: string): void {
    if (!conversationId || !messageId) return;
    const now = Date.now();
    const list = readMessages(conversationId);
    const next = list.map(item =>
      item.id === messageId
        ? {
            ...item,
            text: undefined,
            uri: undefined,
            meta: undefined,
            replyTo: null,
            deletedAtMs: now,
            updatedAtMs: now,
            status: 'delivered' as ChatMessageStatus,
          }
        : item,
    );
    writeMessages(conversationId, next);
  },

  removeConversation(conversationId: string): void {
    if (!conversationId) return;
    ensureBackend().delete(conversationKey(conversationId));
    ensureBackend().delete(messagesKey(conversationId));
    writeConversationsIndex(
      readConversationsIndex().filter(id => id !== conversationId),
    );
  },

  getOutbox(): OutboxItemRecord[] {
    return parseJson<OutboxItemRecord[]>(ensureBackend().getString(OUTBOX_KEY), []).sort(
      (a, b) => a.createdAtMs - b.createdAtMs,
    );
  },

  setOutbox(items: OutboxItemRecord[]): void {
    const deduped = new Map<string, OutboxItemRecord>();
    items.forEach(item => {
      const key = item.id || item.messageId || item.clientNonce;
      if (!key) return;
      deduped.set(key, item);
    });
    writeJson(OUTBOX_KEY, Array.from(deduped.values()));
  },

  enqueueOutbox(item: OutboxItemRecord): void {
    const list = this.getOutbox();
    if (list.some(existing => existing.id === item.id)) return;
    this.setOutbox([...list, item]);
  },

  updateOutboxItem(itemId: string, updater: (item: OutboxItemRecord) => OutboxItemRecord): void {
    const list = this.getOutbox();
    const next = list.map(item => (item.id === itemId ? updater(item) : item));
    this.setOutbox(next);
  },

  removeOutboxItem(itemId: string): void {
    const list = this.getOutbox();
    this.setOutbox(list.filter(item => item.id !== itemId));
  },
};
