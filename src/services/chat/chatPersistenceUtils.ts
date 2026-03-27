export type ChatMessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export type PersistedMessageRecord = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document';
  text?: string;
  uri?: string;
  meta?: Record<string, any>;
  createdAtMs: number;
  updatedAtMs: number;
  status: ChatMessageStatus;
  clientNonce?: string;
  replyTo?: Record<string, any> | null;
  reactions?: Record<string, string[]>;
  pinnedAtMs?: number | null;
  deletedAtMs?: number | null;
};

export type OutboxItemRecord = {
  id: string;
  conversationId: string;
  messageId: string;
  clientNonce: string;
  createdAtMs: number;
  attempts: number;
  nextRetryAtMs: number;
  payload: {
    type: 'text' | 'image' | 'video' | 'audio' | 'document';
    text?: string;
    uri?: string;
    meta?: Record<string, any>;
    replyTo?: Record<string, any> | null;
    conversation?: {
      title?: string;
      type?: 'private' | 'group' | 'monitor';
      members: string[];
    };
  };
};

const STATUS_WEIGHT: Record<ChatMessageStatus, number> = {
  failed: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
};

const normalizeNonce = (value?: string): string => (value || '').trim();

const pickStatus = (
  current: ChatMessageStatus,
  incoming: ChatMessageStatus,
): ChatMessageStatus => {
  return STATUS_WEIGHT[incoming] >= STATUS_WEIGHT[current] ? incoming : current;
};

const pickMaybe = <T>(incoming: T | undefined, current: T | undefined): T | undefined =>
  incoming !== undefined ? incoming : current;

export const mergeMessageRecords = (
  current: PersistedMessageRecord | null,
  incoming: PersistedMessageRecord,
): PersistedMessageRecord => {
  if (!current) return incoming;
  const createdAtMs = Math.max(current.createdAtMs || 0, incoming.createdAtMs || 0);
  return {
    ...current,
    ...incoming,
    id: incoming.id || current.id,
    conversationId: incoming.conversationId || current.conversationId,
    senderId: incoming.senderId || current.senderId,
    senderName: incoming.senderName || current.senderName,
    type: incoming.type || current.type,
    text: pickMaybe(incoming.text, current.text),
    uri: pickMaybe(incoming.uri, current.uri),
    meta: pickMaybe(incoming.meta, current.meta),
    replyTo: pickMaybe(incoming.replyTo, current.replyTo),
    reactions: pickMaybe(incoming.reactions, current.reactions),
    pinnedAtMs: pickMaybe(incoming.pinnedAtMs, current.pinnedAtMs),
    deletedAtMs: pickMaybe(incoming.deletedAtMs, current.deletedAtMs),
    clientNonce: normalizeNonce(incoming.clientNonce) || normalizeNonce(current.clientNonce) || undefined,
    status: pickStatus(current.status, incoming.status),
    createdAtMs,
    updatedAtMs: Math.max(current.updatedAtMs || 0, incoming.updatedAtMs || 0, createdAtMs),
  };
};

export const upsertMessagesWithIdempotency = (
  current: PersistedMessageRecord[],
  incoming: PersistedMessageRecord[],
): PersistedMessageRecord[] => {
  const byId = new Map<string, PersistedMessageRecord>();
  const nonceToId = new Map<string, string>();

  current.forEach(item => {
    byId.set(item.id, item);
    const nonce = normalizeNonce(item.clientNonce);
    if (nonce) nonceToId.set(nonce, item.id);
  });

  incoming.forEach(item => {
    const nonce = normalizeNonce(item.clientNonce);
    const nonceId = nonce ? nonceToId.get(nonce) : undefined;

    if (nonceId && nonceId !== item.id) {
      const existingByNonce = byId.get(nonceId) || null;
      const merged = mergeMessageRecords(existingByNonce, item);
      byId.delete(nonceId);
      byId.set(merged.id, merged);
      nonceToId.set(nonce, merged.id);
      return;
    }

    const existing = byId.get(item.id) || null;
    const merged = mergeMessageRecords(existing, item);
    byId.set(merged.id, merged);
    if (nonce) nonceToId.set(nonce, merged.id);
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
    return b.updatedAtMs - a.updatedAtMs;
  });
};

export const buildOutboxRetryState = (params: {
  attempts: number;
  nowMs: number;
  baseBackoffMs?: number;
  maxAttempts?: number;
}): { attempts: number; nextRetryAtMs: number; terminal: boolean } => {
  const baseBackoffMs = params.baseBackoffMs ?? 400;
  const maxAttempts = params.maxAttempts ?? 6;
  const nextAttempts = Math.max(0, params.attempts) + 1;
  const terminal = nextAttempts >= maxAttempts;
  if (terminal) {
    return {
      attempts: nextAttempts,
      nextRetryAtMs: params.nowMs,
      terminal: true,
    };
  }

  const backoff = baseBackoffMs * Math.pow(2, nextAttempts - 1);
  return {
    attempts: nextAttempts,
    nextRetryAtMs: params.nowMs + backoff,
    terminal: false,
  };
};

export const isOutboxItemReady = (item: OutboxItemRecord, nowMs: number): boolean => {
  return (item.nextRetryAtMs || 0) <= nowMs;
};
