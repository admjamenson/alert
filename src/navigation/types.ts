import { SecurityScope } from '../services/data/UnifiedIncidentStore';

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Signup: undefined;
  PhoneAuth: undefined;
  VerifyCode: undefined;
  ProfileSetup: undefined;
  Profile: undefined;
  SetupContacts: undefined;
  Home: undefined;
  FastHome: undefined;
  SafetyMap:
    | {
        initialScope?: SecurityScope;
        initialState?: 'expanded' | 'collapsed';
        targetLocation?: { latitude: number; longitude: number };
      }
    | undefined;
  ChatMonitor:
    | {
        lat?: number;
        lon?: number;
        user?: string;
        conversationId?: string;
        mode?: 'GUARDIANS_GROUP' | 'SOS_MONITOR';
        targetLocation?: { latitude: number; longitude: number };
        senderName?: string;
        message?: string;
      }
    | undefined;
  ChatThread:
    | {
        threadId?: string;
        conversationId?: string;
        title?: string;
        memberIds?: string[];
        type?: 'private' | 'group' | 'monitor';
      }
    | undefined;
  PrivateReply:
    | {
        threadId?: string;
        sourceConversationId?: string;
        targetUserId?: string;
        targetUserName?: string;
        quote?: {
          id: string;
          senderId: string;
          senderName: string;
          type: 'text' | 'image' | 'video' | 'audio' | 'document';
          preview: string;
        };
      }
    | undefined;
  Conversations: { openGuardiansFirst?: boolean } | undefined;
  EpidemicMap: undefined;
  Notifications: undefined;
  Monitoring: undefined;
  RealtimeInsights: undefined;
  MonitoringFeed:
    | {
        alertAI?: boolean;
        priorityTypes?: string[];
        type?: string;
        scope?: string;
        lat?: number;
        lon?: number;
        zoom?: number;
        initialCategory?: string;
        timeZone?: string;
      }
    | undefined;
  Guardians: undefined;
  RouteSettings: undefined;
  WidgetCatalog: undefined;
  CheckIn: undefined;
  OfficialSources: undefined;
  History: undefined;
  Checkout:
    | {
        billingSyncHint?:
          | 'initial'
          | 'focus'
          | 'checkout_success'
          | 'checkout_cancel'
          | 'portal_return';
        billingSyncNonce?: number;
      }
    | undefined;
  Settings: undefined;
  Support: undefined;
  AdPrivacy: undefined;
  LanguageSelector: undefined;
  ThemeSettings: undefined;
  PopupValidation: undefined;
  AlertDetails:
    | {
        id?: string;
        alert?: {
          title: string;
          description: string;
          timestamp: string;
          sourceName?: string;
          sourceUrl?: string | null;
        };
      }
    | undefined;
  WebView:
    | {
        url: string;
        title?: string;
        intent?: 'billing_checkout' | 'billing_portal';
      }
    | undefined;
  AlertAssistant: undefined;
  LegalNotice: undefined;
};
