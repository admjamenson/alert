import { APP_CONFIG } from '../../core/config';
import { UserIdentityService } from '../UserIdentityService';
import type { ChatMessageType, ChatReplyRef } from '../ChatThreadService';

export type ChatSyncConversationDTO = {
  id: string;
  type?: 'private' | 'group' | 'monitor';
  title?: string;
  members?: string[];
  metadata?: {
    isGuardians?: boolean;
    conversationType?: string;
  };
  updatedAtMs?: number;
  lastMessageAtMs?: number;
  lastMessage?: {
    senderId?: string;
    senderName?: string;
    type?: ChatMessageType;
    text?: string;
    createdAtMs?: number;
  };
};

export type ChatSyncMessageDTO = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: ChatMessageType;
  text?: string;
  uri?: string;
  meta?: Record<string, any>;
  createdAtMs: number;
  updatedAtMs?: number;
  clientNonce?: string;
  replyTo?: ChatReplyRef | null;
  reactions?: Record<string, string[]>;
  pinnedAtMs?: number | null;
  deletedAtMs?: number | null;
};

const getApiBaseUrl = () => {
  const envOverride =
    typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return String(envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const toQuery = (params: Record<string, string | number | undefined | null>) => {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `?${query}` : '';
};

const resolveIdentity = async () => {
  const [deviceId, userPhone] = await Promise.all([
    UserIdentityService.getDeviceId(),
    UserIdentityService.getUserPhone(),
  ]);
  return {
    userId: userPhone || deviceId,
    deviceId,
  };
};

const safeJson = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

export const ChatSyncService = {
  async pullConversations(params?: {
    cursor?: number | null;
    limit?: number;
  }): Promise<{
    items: ChatSyncConversationDTO[];
    nextCursor: number | null;
  }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return { items: [], nextCursor: null };

    const identity = await resolveIdentity();
    const query = toQuery({
      userId: identity.userId,
      deviceId: identity.deviceId,
      cursor: params?.cursor || undefined,
      limit: params?.limit || undefined,
    });
    const response = await fetch(`${baseUrl}/api/chat/conversations${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    }).catch(() => null);

    if (!response || !response.ok) {
      return { items: [], nextCursor: null };
    }

    const json = await safeJson<{
      items?: ChatSyncConversationDTO[];
      nextCursor?: number | null;
    }>(response);
    return {
      items: Array.isArray(json?.items) ? json.items : [],
      nextCursor: typeof json?.nextCursor === 'number' ? json.nextCursor : null,
    };
  },

  async pullMessages(params: {
    conversationId: string;
    cursor?: number | null;
    limit?: number;
  }): Promise<{
    items: ChatSyncMessageDTO[];
    nextCursor: number | null;
  }> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl || !params.conversationId) {
      return { items: [], nextCursor: null };
    }
    const identity = await resolveIdentity();
    const query = toQuery({
      conversationId: params.conversationId,
      userId: identity.userId,
      deviceId: identity.deviceId,
      cursor: params.cursor || undefined,
      limit: params.limit || undefined,
    });
    const response = await fetch(`${baseUrl}/api/chat/messages${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    }).catch(() => null);

    if (!response || !response.ok) {
      return { items: [], nextCursor: null };
    }

    const json = await safeJson<{
      items?: ChatSyncMessageDTO[];
      nextCursor?: number | null;
    }>(response);
    return {
      items: Array.isArray(json?.items) ? json.items : [],
      nextCursor: typeof json?.nextCursor === 'number' ? json.nextCursor : null,
    };
  },

  async ackMessage(params: {
    conversationId: string;
    messageId: string;
    status: 'delivered' | 'read';
  }): Promise<boolean> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl || !params.conversationId || !params.messageId) return false;
    const identity = await resolveIdentity();
    const response = await fetch(`${baseUrl}/api/chat/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...identity,
        conversationId: params.conversationId,
        messageId: params.messageId,
        status: params.status,
      }),
    }).catch(() => null);

    return Boolean(response?.ok);
  },
};
