export const GUARDIANS_CONVERSATION_ID = 'guardians-group';
export const GUARDIANS_CONVERSATION_TYPE = 'GUARDIANS_GROUP';
export const GUARDIANS_DEFAULT_TITLE = 'Guardioes';
export const GUARDIANS_DEFAULT_PREVIEW = 'Grupo de emergencia dos seus Guardioes';
export const OPEN_GUARDIANS_FIRST_DEFAULT = false;

export type ConversationSortShape = {
  id: string;
  updatedAtMs: number;
  lastMessage?: {
    createdAtMs?: number;
    text?: string;
  };
  pinned?: boolean;
};

const getActivityMs = (item: ConversationSortShape): number => {
  const lastMessageAt = Number(item.lastMessage?.createdAtMs || 0);
  const updatedAt = Number(item.updatedAtMs || 0);
  return Math.max(lastMessageAt, updatedAt);
};

export const isGuardiansConversation = (conversationId: string | null | undefined): boolean =>
  String(conversationId || '').trim().toLowerCase() === GUARDIANS_CONVERSATION_ID;

export const sortConversationsWithGuardiansFirst = <T extends ConversationSortShape>(
  items: T[],
): T[] =>
  [...items].sort((a, b) => {
    const aGuardians = isGuardiansConversation(a.id);
    const bGuardians = isGuardiansConversation(b.id);
    if (aGuardians && !bGuardians) return -1;
    if (!aGuardians && bGuardians) return 1;

    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }

    const byRecency = getActivityMs(b) - getActivityMs(a);
    if (byRecency !== 0) return byRecency;
    return String(a.id).localeCompare(String(b.id));
  });

export const ensureGuardiansConversationInList = <T extends ConversationSortShape>(
  items: T[],
  stub: T,
): T[] => {
  const hasGuardians = items.some(item => isGuardiansConversation(item.id));
  if (hasGuardians) {
    return sortConversationsWithGuardiansFirst(items);
  }
  return sortConversationsWithGuardiansFirst([stub, ...items]);
};
