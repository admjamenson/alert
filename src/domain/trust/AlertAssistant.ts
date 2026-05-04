export type AlertAssistantIntent =
  | 'general'
  | 'safety'
  | 'widgets'
  | 'route'
  | 'sos'
  | 'sources'
  | 'privacy'
  | 'monitoring'
  | 'event_detail';

export type AlertAssistantReplySource = {
  name: string;
  url?: string | null;
};

export type AlertAssistantReplyReadModel = {
  intent: AlertAssistantIntent;
  title: string;
  body: string;
  bullets: string[];
  sources: AlertAssistantReplySource[];
  trustLabel: string;
  updatedLabel?: string;
  suggestedPrompts: string[];
};
