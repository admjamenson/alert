export type SupportMessageRole = 'assistant' | 'user';

export type SupportChatMessage = {
  id: string;
  role: SupportMessageRole;
  text: string;
};

export type SupportFaqEntry = {
  id: string;
  keywords: string[];
  responseKey: string;
};

export type SupportAssistantReply = {
  text: string;
  intent: 'faq' | 'fallback' | 'blocked';
  shouldEscalate: boolean;
};
