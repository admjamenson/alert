import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  FlatList,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  Linking,
  PanResponder,
  useColorScheme,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PermissionManager } from '../../utils/permissions';
import { RouteDetails, RouteService } from '../../services/RouteService';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
// Audio recorder import disabled - causes build issues with Nitro modules
// import AudioRecorderPlayer, {
//   AudioEncoderAndroidType,
//   AudioSourceAndroidType,
//   AVEncoderAudioQualityIOSType,
//   AVEncodingOption,
//   AVModeIOSOption,
//   OutputFormatAndroidType,
// } from 'react-native-audio-recorder-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';
import { ProfileService } from '../../services/ProfileService';
import { ProximityAudioService } from '../../services/ProximityAudioService';
import i18n from '../../i18n';
import { ThemeTokens } from '../../constants/ThemeTokens';
import BasePopup from '../../components/ui/BasePopup';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  OSM_STYLE_NORMAL,
  OSM_STYLE_PANIC,
  isRasterStyle,
} from '../../constants/MapStyles';
import {
  ChatMessageMeta,
  ChatMessageItem,
  ChatMessageType,
  ChatThreadService,
} from '../../services/ChatThreadService';
import { GuardiansGroupChatScreen } from './GuardiansGroupChatScreen';
import {
  GUARDIANS_CONVERSATION_ID,
  isGuardiansConversation,
} from '../../services/chat/guardiansConversation';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';
import { NotificationService } from '../../services/NotificationService';
import type { RootStackParamList } from '../../navigation/types';

interface ChatParams {
  conversationId?: string;
  mode?: 'GUARDIANS_GROUP' | 'SOS_MONITOR';
  targetLocation?: { latitude: number; longitude: number };
  senderName?: string;
  message?: string;
  lat?: number | string;
  lon?: number | string;
  user?: string;
}

type ChatMessage = {
  id: string;
  sender: string;
  senderId?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document';
  text?: string;
  uri?: string;
  meta?: ChatMessageMeta;
  duration?: number;
  peakDb?: number;
  status?: 'pending' | 'sent' | 'delivered' | 'failed';
  createdAtMs?: number;
  deletedAtMs?: number | null;
  timestamp: string;
  isSelf: boolean;
};

type ChatMonitorScreenProps = NativeStackScreenProps<RootStackParamList, 'ChatMonitor'>;
type ChatMonitorNavigation = ChatMonitorScreenProps['navigation'];

type AudioPlaybackEvent = {
  duration?: number;
  currentPosition?: number;
};

type AudioRecordEvent = {
  currentMetering?: number;
};

type AudioRecorderPlayerLike = {
  startPlayer: (uri?: string) => Promise<void>;
  stopPlayer: () => Promise<void>;
  setVolume: (value: number) => Promise<void> | void;
  addPlayBackListener: (listener: (event: AudioPlaybackEvent) => void) => void;
  removePlayBackListener: () => void;
  startRecorder: (
    uri?: string,
    audioSet?: Record<string, unknown>,
    meteringEnabled?: boolean,
  ) => Promise<string>;
  stopRecorder: () => Promise<string>;
  addRecordBackListener: (listener: (event: AudioRecordEvent) => void) => void;
  removeRecordBackListener: () => void;
};

type AudioRecorderPlayerModuleLike = {
  default?: new () => AudioRecorderPlayerLike;
  AudioEncoderAndroidType?: Record<string, unknown>;
  AudioSourceAndroidType?: Record<string, unknown>;
  AVEncoderAudioQualityIOSType?: Record<string, unknown>;
  AVEncodingOption?: Record<string, unknown>;
  AVModeIOSOption?: Record<string, unknown>;
  OutputFormatAndroidType?: Record<string, unknown>;
};

const createNoopAudioRecorderPlayer = (): AudioRecorderPlayerLike => ({
  startPlayer: async () => {},
  stopPlayer: async () => {},
  setVolume: async () => {},
  addPlayBackListener: () => {},
  removePlayBackListener: () => {},
  startRecorder: async () => '',
  stopRecorder: async () => '',
  addRecordBackListener: () => {},
  removeRecordBackListener: () => {},
});

const audioRecorderPlayerModule: AudioRecorderPlayerModuleLike | null = (() => {
  try {
    return require('react-native-audio-recorder-player');
  } catch {
    return null;
  }
})();

const audioRecorderPlayer: AudioRecorderPlayerLike = audioRecorderPlayerModule?.default
  ? new audioRecorderPlayerModule.default()
  : createNoopAudioRecorderPlayer();
const audioMessagingAvailable = Boolean(audioRecorderPlayerModule?.default);

const CHAT_STORAGE_KEY = '@Alert:ChatMessages';
const CHAT_LAST_SEEN_KEY = '@Alert:ChatLastSeen';
const ACTIVE_CALL_KEY = '@Alert:ActiveCall';
const GUARDIANS_PAGE_SIZE = 30;
const LAST_LOCATION_KEY = '@Alert:LastLocation';
const LAST_LOCATION_NAME_KEY = '@Alert:LastLocationName';

const VOICE_AUDIO_SET = {
  ...(audioRecorderPlayerModule?.AudioSourceAndroidType?.VOICE_RECOGNITION !==
  undefined
    ? {
        AudioSourceAndroid:
          audioRecorderPlayerModule.AudioSourceAndroidType
            .VOICE_RECOGNITION,
      }
    : {}),
  ...(audioRecorderPlayerModule?.OutputFormatAndroidType?.MPEG_4 !== undefined
    ? {
        OutputFormatAndroid:
          audioRecorderPlayerModule.OutputFormatAndroidType.MPEG_4,
      }
    : {}),
  ...(audioRecorderPlayerModule?.AudioEncoderAndroidType?.AAC !== undefined
    ? {
        AudioEncoderAndroid:
          audioRecorderPlayerModule.AudioEncoderAndroidType.AAC,
      }
    : {}),
  ...(audioRecorderPlayerModule?.AVModeIOSOption?.spokenaudio !== undefined
    ? {
        AVModeIOS: audioRecorderPlayerModule.AVModeIOSOption.spokenaudio,
      }
    : {}),
  ...(audioRecorderPlayerModule?.AVEncodingOption?.aac !== undefined
    ? {
        AVFormatIDKeyIOS: audioRecorderPlayerModule.AVEncodingOption.aac,
      }
    : {}),
  ...(audioRecorderPlayerModule?.AVEncoderAudioQualityIOSType?.high !== undefined
    ? {
        AVEncoderAudioQualityKeyIOS:
          audioRecorderPlayerModule.AVEncoderAudioQualityIOSType.high,
      }
    : {}),
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 44100,
  AVEncoderBitRateKeyIOS: 128000,
  AudioSamplingRateAndroid: 44100,
  AudioEncodingBitRateAndroid: 128000,
  AudioChannelsAndroid: 1,
};

const resolvePlaybackVolume = (peakDb?: number) => {
  if (typeof peakDb !== 'number') return 1.0;
  // Keep playback as loud as possible and only attenuate near clipping.
  if (peakDb >= -3) return 0.96;
  return 1.0;
};

const chatThemeTokens = {
  colors: ThemeTokens?.colors ?? {
    light: {
      primary: '#E61C24',
      background: '#FFFFFF',
      surface: '#FFFFFF',
      card: '#FFFFFF',
      text: '#111111',
      muted: '#5A5A5A',
      textSecondary: '#5A5A5A',
      border: '#E9E9E9',
      danger: '#E61C24',
      riskLow: '#34C759',
      riskMedium: '#FFCC00',
      riskHigh: '#E61C24',
      safe: '#34C759',
      alert: '#E61C24',
      neutral: '#111111',
      ripple: 'rgba(230, 28, 36, 0.12)',
    },
    dark: {
      primary: '#E61C24',
      background: '#111111',
      surface: '#171717',
      card: '#171717',
      text: '#FFFFFF',
      muted: '#B2B2B2',
      textSecondary: '#B2B2B2',
      border: '#242424',
      danger: '#E61C24',
      riskLow: '#34C759',
      riskMedium: '#FFCC00',
      riskHigh: '#E61C24',
      safe: '#34C759',
      alert: '#E61C24',
      neutral: '#FFFFFF',
      ripple: 'rgba(230, 28, 36, 0.18)',
    },
  },
  typography: ThemeTokens?.typography ?? {
    families: {
      ios: 'System',
      android: 'sans-serif',
    },
  },
  haptics: ThemeTokens?.haptics ?? {
    light: 'impactLight',
    medium: 'impactMedium',
    success: 'notificationSuccess',
    error: 'notificationError',
  },
  radius: ThemeTokens?.radius ?? {
    pill: 999,
  },
  spacing: ThemeTokens?.spacing ?? {
    sm: 8,
    xl: 32,
  },
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? chatThemeTokens.typography.families.ios
    : chatThemeTokens.typography.families.android;
const ROUTE_ESTIMATED_COLOR = chatThemeTokens.colors.light.riskMedium;

type Guardian = {
  id: string;
  name: string;
  phone?: string;
  remoteId?: string;
  avatarUri?: string;
  lastLocation?: [number, number];
  lastUpdatedAt?: string;
};

type GuardianMapMarker = {
  key: string;
  annotationId: string;
  name: string;
  coordinate: [number, number];
  source: 'profile' | 'shared';
  updatedAtMs: number;
};

type ChatMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type ShapeSourceShape = React.ComponentProps<typeof MapLibreGL.ShapeSource>['shape'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readRecord = (
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined => {
  const value = source[key];
  return isRecord(value) ? value : undefined;
};

const normalizeGuardianLocation = (value: unknown): [number, number] | undefined => {
  if (!isRecord(value)) return undefined;
  const location = readRecord(value, 'location');
  const lat = Number(
    value.latitude ??
      value.lat ??
      location?.latitude ??
      location?.lat,
  );
  const lon = Number(
    value.longitude ??
      value.lon ??
      value.lng ??
      location?.longitude ??
      location?.lon ??
      location?.lng,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return [lon, lat];
};

const normalizeGuardianRecord = (value: unknown): Guardian | null => {
  if (!isRecord(value)) return null;
  const id = String(
    value.id ?? value.recordID ?? value.remoteId ?? value.phone ?? '',
  ).trim();
  if (!id) return null;

  const remoteId =
    typeof value.remoteId === 'string' && value.remoteId.trim().length > 0
      ? value.remoteId.trim()
      : undefined;
  const name =
    String(
      value.name ??
        value.displayName ??
        value.fromName ??
        value.title ??
        '',
    ).trim() ||
    i18n.t('guardian_label', {
      defaultValue: 'Guardian',
    });

  return {
    id,
    name,
    phone:
      typeof value.phone === 'string'
        ? value.phone
        : typeof value.phoneNumber === 'string'
          ? value.phoneNumber
          : undefined,
    remoteId,
    avatarUri:
      typeof value.avatarUri === 'string' && value.avatarUri.trim().length > 0
        ? value.avatarUri.trim()
        : undefined,
    lastLocation: normalizeGuardianLocation(value),
    lastUpdatedAt:
      typeof value.lastUpdatedAt === 'string'
        ? value.lastUpdatedAt
        : typeof value.updatedAt === 'string'
          ? value.updatedAt
          : undefined,
  };
};

const loadGuardiansRoster = async (): Promise<Guardian[]> => {
  try {
    const raw = await AsyncStorage.getItem('@guardians_list');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeGuardianRecord)
      .filter((item): item is Guardian => item !== null);
  } catch {
    return [];
  }
};

const resolveGuardiansConversationMembers = (
  currentUserId: string,
  guardians: Guardian[],
) =>
  Array.from(
    new Set([
      currentUserId,
      ...guardians
        .map(item =>
          typeof item.remoteId === 'string' ? item.remoteId.trim() : '',
        )
        .filter(Boolean),
    ]),
  );

const extractSharedLocation = (
  meta?: ChatMessageMeta,
): { latitude: number; longitude: number; source?: 'sos' | 'guardians_chat' } | null => {
  const latitude = Number(meta?.location?.latitude);
  const longitude = Number(meta?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    source: meta?.location?.source,
  };
};

const readCoordinatePair = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lon, lat];
};

const getCenterFromPayload = (payload: unknown): [number, number] | null => {
  if (!isRecord(payload)) return null;
  const geometry = readRecord(payload, 'geometry');
  const properties = readRecord(payload, 'properties');
  const coords = geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    return readCoordinatePair(coords);
  }
  const center = properties?.center;
  if (Array.isArray(center) && center.length >= 2) {
    return readCoordinatePair(center);
  }
  const centerCoordinate = payload.centerCoordinate;
  if (Array.isArray(centerCoordinate) && centerCoordinate.length >= 2) {
    return readCoordinatePair(centerCoordinate);
  }
  return null;
};

const distanceMeters = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const toMessageTimestamp = (
  createdAtMs?: number,
  fallback?: string,
): string => {
  if (typeof createdAtMs === 'number' && createdAtMs > 0) {
    return new Date(createdAtMs).toISOString();
  }
  if (fallback) return fallback;
  return new Date().toISOString();
};

const mergeChatMessages = (
  prev: ChatMessage[],
  next: ChatMessage[],
): ChatMessage[] => {
  const map = new Map<string, ChatMessage>();
  prev.forEach(item => map.set(item.id, item));
  next.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => {
    const aTs = Number(a.createdAtMs || new Date(a.timestamp).getTime() || 0);
    const bTs = Number(b.createdAtMs || new Date(b.timestamp).getTime() || 0);
    return bTs - aTs;
  });
};

const LegacyChatMonitorScreen = ({
  navigation,
  params,
}: {
  navigation: ChatMonitorNavigation;
  params: ChatParams;
}) => {
  const systemColorScheme = useColorScheme();
  const isDark = systemColorScheme === 'dark';
  const colors = isDark ? chatThemeTokens.colors.dark : chatThemeTokens.colors.light;
  const t = i18n.t.bind(i18n);
  const deepLinkTarget =
    params.lat !== undefined && params.lon !== undefined
      ? {
          latitude: Number(params.lat),
          longitude: Number(params.lon),
        }
      : undefined;
  const guardiansConversationId = params.conversationId || GUARDIANS_CONVERSATION_ID;
  const isGuardiansMode =
    params.mode === 'GUARDIANS_GROUP' ||
    String(params.conversationId || '').trim().toLowerCase() ===
      GUARDIANS_CONVERSATION_ID;
  const resolvedSenderName =
    params.senderName ||
    (params.user ? decodeURIComponent(params.user) : undefined);
  const [currentRegion, setCurrentRegion] = useState<ChatMapRegion | null>(null);
  const [routeLine, setRouteLine] = useState<Array<[number, number]>>([]);
  const [routeMeta, setRouteMeta] = useState<RouteDetails | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingLocked, setRecordingLocked] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [locationToast, setLocationToast] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [playbackDurationMs, setPlaybackDurationMs] = useState(0);
  const [activeCall, setActiveCall] = useState<{
    type: 'voice' | 'video';
    link: string;
    startedAt: string;
  } | null>(null);
  const [participants, setParticipants] = useState<Guardian[]>([]);
  const [conversationTarget, setConversationTarget] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [securityLocation, setSecurityLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [securityLocationName, setSecurityLocationName] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [chatUser, setChatUser] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [hasLoadedChat, setHasLoadedChat] = useState(false);
  const [showRecenter, setShowRecenter] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [cameraCenter, setCameraCenter] = useState<[number, number] | null>(
    null,
  );
  const [guardiansHasMore, setGuardiansHasMore] = useState(true);
  const [guardiansLoadingMore, setGuardiansLoadingMore] = useState(false);
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);
  const recordingRef = useRef(false);
  const recordingLockedRef = useRef(false);
  const recordingCancelRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingPeakDbRef = useRef<number | null>(null);
  const locationToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const guardiansOldestCursorRef = useRef<number | null>(null);
  const requestPreciseFixNow = React.useCallback(async () => {
    try {
      const [storedLocation, storedLocationName] = await Promise.all([
        AsyncStorage.getItem(LAST_LOCATION_KEY),
        AsyncStorage.getItem(LAST_LOCATION_NAME_KEY),
      ]);
      const parsedLocation = storedLocation ? JSON.parse(storedLocation) : null;
      const latitude = Number(parsedLocation?.latitude);
      const longitude = Number(parsedLocation?.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        setSecurityLocation({ latitude, longitude });
      }
      if (
        typeof storedLocationName === 'string' &&
        storedLocationName.trim().length > 0
      ) {
        setSecurityLocationName(storedLocationName.trim());
      }
    } catch {
      // ignore local location recovery failures
    }
    return 'unknown';
  }, []);
  const securityState = useMemo(
    () => ({
      location: securityLocation,
      locationName: securityLocationName,
    }),
    [securityLocation, securityLocationName],
  );
  const localeTag = getLocales()?.[0]?.languageTag || 'pt-BR';
  const sharedRequesterLocation = useMemo(() => {
    for (const item of messages) {
      if (item.isSelf) continue;
      const shared = extractSharedLocation(item.meta);
      if (shared?.source === 'sos') {
        return { latitude: shared.latitude, longitude: shared.longitude };
      }
    }
    for (const item of messages) {
      if (item.isSelf) continue;
      const shared = extractSharedLocation(item.meta);
      if (shared) {
        return { latitude: shared.latitude, longitude: shared.longitude };
      }
    }
    return null;
  }, [messages]);
  const routeTarget = params.targetLocation || deepLinkTarget || null;
  const target =
    routeTarget || conversationTarget || sharedRequesterLocation || null;
  const panicMode = Boolean(resolvedSenderName || target);
  const isRasterBaseMap = useMemo(() => isRasterStyle(OSM_STYLE_NORMAL), []);
  const mapStyle = useMemo(
    () => (panicMode && isRasterBaseMap ? OSM_STYLE_PANIC : OSM_STYLE_NORMAL),
    [panicMode, isRasterBaseMap],
  );
  const showPanicOverlay = panicMode && !isRasterBaseMap;
  const securityLat =
    typeof securityState.location?.latitude === 'number'
      ? securityState.location.latitude
      : null;
  const securityLon =
    typeof securityState.location?.longitude === 'number'
      ? securityState.location.longitude
      : null;
  const hasSecurityLocation =
    canUseLocationForRiskMaps(securityState) &&
    isFiniteCoordinatePair(securityLat, securityLon);

  const guardianMapMarkers = useMemo<GuardianMapMarker[]>(() => {
    if (!isGuardiansMode) return [];
    const markers = new Map<string, GuardianMapMarker>();

    participants.forEach(item => {
      if (!item.lastLocation) return;
      const key = item.remoteId || item.id;
      if (!key || key === chatUser?.id) return;
      markers.set(key, {
        key,
        annotationId: `guardian-profile-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        name: item.name,
        coordinate: item.lastLocation,
        source: 'profile',
        updatedAtMs: Date.parse(item.lastUpdatedAt || '') || 0,
      });
    });

    messages.forEach(item => {
      if (item.isSelf) return;
      const shared = extractSharedLocation(item.meta);
      if (!shared) return;
      const key = String(item.senderId || item.sender || item.id).trim();
      if (!key || key === chatUser?.id) return;
      const createdAtMs = Number(
        item.createdAtMs || Date.parse(item.timestamp) || 0,
      );
      const candidate: GuardianMapMarker = {
        key,
        annotationId: `guardian-shared-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        name: item.sender || t('chat_sender_fallback'),
        coordinate: [shared.longitude, shared.latitude],
        source: 'shared',
        updatedAtMs: createdAtMs,
      };
      const existing = markers.get(key);
      if (
        !existing ||
        existing.source === 'profile' ||
        candidate.updatedAtMs >= existing.updatedAtMs
      ) {
        markers.set(key, candidate);
      }
    });

    return Array.from(markers.values());
  }, [chatUser?.id, isGuardiansMode, messages, participants, t]);

  const participantLocationKeys = useMemo(() => {
    const keys = new Set<string>();
    participants.forEach(item => {
      if (item.lastLocation) {
        keys.add(item.remoteId || item.id);
      }
    });
    guardianMapMarkers.forEach(item => {
      keys.add(item.key);
    });
    return keys;
  }, [guardianMapMarkers, participants]);

  useEffect(() => {
    if (!hasSecurityLocation) return;
    const nextLat = Number(securityLat);
    const nextLon = Number(securityLon);
    setCurrentRegion(prev => {
      if (
        prev &&
        Math.abs(prev.latitude - nextLat) < 0.00001 &&
        Math.abs(prev.longitude - nextLon) < 0.00001
      ) {
        return prev;
      }
      return {
        latitude: nextLat,
        longitude: nextLon,
        latitudeDelta: prev?.latitudeDelta ?? 0.005,
        longitudeDelta: prev?.longitudeDelta ?? 0.005,
      };
    });
  }, [hasSecurityLocation, securityLat, securityLon]);

  useEffect(() => {
    if (!isGuardiansMode || routeTarget) return;
    let active = true;

    const loadActiveSosTarget = async () => {
      try {
        const activeSos = await NotificationService.getActiveSos();
        if (!active || !activeSos?.location) return;
        const latitude = Number(activeSos.location.latitude);
        const longitude = Number(activeSos.location.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        setConversationTarget({ latitude, longitude });
      } catch {
        // ignore
      }
    };

    void loadActiveSosTarget();
    return () => {
      active = false;
    };
  }, [isGuardiansMode, routeTarget]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    recordingLockedRef.current = recordingLocked;
  }, [recordingLocked]);

  useEffect(() => {
    return () => {
      audioRecorderPlayer.stopRecorder().catch(() => {});
      audioRecorderPlayer.stopPlayer().catch(() => {});
      audioRecorderPlayer.removePlayBackListener();
      void ProximityAudioService.stop();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (locationToastTimeoutRef.current) {
        clearTimeout(locationToastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const markSeen = async () => {
      const key = isGuardiansMode
        ? guardiansConversationId
        : resolvedSenderName || 'default';
      try {
        const raw = await AsyncStorage.getItem(CHAT_LAST_SEEN_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[key] = Date.now();
        await AsyncStorage.setItem(CHAT_LAST_SEEN_KEY, JSON.stringify(map));
      } catch {
        // ignore
      }
    };
    void markSeen();
    const unsub = navigation.addListener?.('focus', () => {
      void markSeen();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [
    navigation,
    resolvedSenderName,
    isGuardiansMode,
    guardiansConversationId,
  ]);

  useEffect(() => {
    if (!isGuardiansMode) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const setupGuardiansThread = async () => {
      try {
        const me = await ChatThreadService.getCurrentChatUser();
        const guardiansRoster = await loadGuardiansRoster();
        const members = resolveGuardiansConversationMembers(
          me.id,
          guardiansRoster,
        );
        if (!active) return;
        setChatUser(me);
        setParticipants(guardiansRoster);
        if (!profileName) setProfileName(me.name || '');

        await ChatThreadService.ensureGuardiansConversation(me.id).catch(
          () => undefined,
        );
        await ChatThreadService.ensureConversation({
          conversationId: guardiansConversationId,
          title: t('guardians_conversation_title'),
          type: 'group',
          members,
        }).catch(() => undefined);

        const cached = ChatThreadService.getCachedMessages(
          guardiansConversationId,
          GUARDIANS_PAGE_SIZE,
        ).map(item => toGuardiansMessage(item, me.id));
        if (!active) return;
        guardiansOldestCursorRef.current =
          cached.length > 0
            ? Number(cached[cached.length - 1].createdAtMs || 0)
            : null;
        setGuardiansHasMore(cached.length >= GUARDIANS_PAGE_SIZE);
        setMessages(cached);
        setHasLoadedChat(true);

        unsubscribe = ChatThreadService.listenLatestMessages(
          guardiansConversationId,
          (incoming, oldestCursorMs) => {
            if (!active) return;
            const mapped = incoming.map(item =>
              toGuardiansMessage(item, me.id),
            );
            guardiansOldestCursorRef.current = oldestCursorMs;
            setGuardiansHasMore(
              incoming.length >= GUARDIANS_PAGE_SIZE || Boolean(oldestCursorMs),
            );
            setMessages(prev => mergeChatMessages(prev, mapped));
            setHasLoadedChat(true);
          },
          () => {
            if (!active) return;
            setHasLoadedChat(true);
          },
          GUARDIANS_PAGE_SIZE,
        );
      } catch {
        if (!active) return;
        setHasLoadedChat(true);
      }
    };

    void setupGuardiansThread();

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isGuardiansMode, guardiansConversationId, t, profileName]);

  useEffect(() => {
    const loadActiveCall = async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_CALL_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          type?: 'voice' | 'video';
          link?: string;
          startedAt?: string;
        };
        if (!parsed?.type || !parsed?.link || !parsed?.startedAt) return;
        const age = Date.now() - new Date(parsed.startedAt).getTime();
        if (Number.isNaN(age) || age > 6 * 60 * 60 * 1000) {
          await AsyncStorage.removeItem(ACTIVE_CALL_KEY);
          return;
        }
        setActiveCall({
          type: parsed.type,
          link: parsed.link,
          startedAt: parsed.startedAt,
        });
      } catch {
        // ignore
      }
    };
    void loadActiveCall();
  }, []);

  useEffect(() => {
    if (!activeCall) {
      AsyncStorage.removeItem(ACTIVE_CALL_KEY).catch(() => {});
      return;
    }
    AsyncStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify(activeCall)).catch(
      () => {},
    );
  }, [activeCall]);

  const routeLabel = useMemo(() => {
    if (!routeMeta) return null;
    if (routeMeta.routeMode === 'unavailable') {
      return {
        text: t('chat_route_unavailable_label'),
        degraded: true,
        icon: 'map-marker-off-outline',
      };
    }
    if (
      typeof routeMeta.distanceKm !== 'number' ||
      typeof routeMeta.durationMin !== 'number'
    ) {
      return null;
    }
    if (routeMeta.routeMode === 'estimated_straight_line') {
      return {
        text: t('chat_route_estimated_label', {
          distance: routeMeta.distanceKm,
          minutes: routeMeta.durationMin,
          defaultValue: `~${routeMeta.distanceKm} km - ${routeMeta.durationMin} min`,
        }),
        degraded: true,
        icon: 'alert-outline',
      };
    }
    return {
      text: `${routeMeta.distanceKm} km - ${routeMeta.durationMin} min`,
      degraded: false,
      icon: 'car',
    };
  }, [routeMeta, t]);
  const routeLineStyle = useMemo(
    () =>
      routeMeta?.routeMode === 'estimated_straight_line'
        ? {
            lineColor: ROUTE_ESTIMATED_COLOR,
            lineWidth: 3,
            lineOpacity: 0.76,
            lineDasharray: [2, 2],
          }
        : {
            lineColor: colors.alert,
            lineWidth: 4,
            lineOpacity: 0.85,
          },
    [colors.alert, routeMeta?.routeMode],
  );
  const routeLineShape = useMemo<ShapeSourceShape>(
    () =>
      ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: routeLine },
        properties: {},
      }) as unknown as ShapeSourceShape,
    [routeLine],
  );

  const guardiansSubtitle = useMemo(() => {
    if (!isGuardiansMode) return null;
    if (participants.length > 0) {
      return t('guardians_conversation_member_count', {
        count: participants.length,
      });
    }
    return t('guardians_conversation_stub_preview');
  }, [isGuardiansMode, participants.length, t]);

  const selfName =
    profileName?.trim() || t('chat_sender_fallback') || 'Usuário';

  const toGuardiansMessage = (
    item: ChatMessageItem,
    currentUserId: string | undefined = chatUser?.id,
  ): ChatMessage => {
    const type: ChatMessage['type'] =
      item.type === 'image' ||
      item.type === 'video' ||
      item.type === 'audio' ||
      item.type === 'document'
        ? item.type
        : 'text';
    const createdAtMs = Number(item.createdAtMs || Date.now());
    return {
      id: item.id,
      sender: item.senderName || t('chat_sender_fallback'),
      senderId: item.senderId,
      type,
      text:
        item.deletedAtMs && !item.text
          ? t('chat_deleted')
          : type === 'text'
          ? item.text || ''
          : type === 'document'
          ? item.meta?.fileName || t('chat_attachment_document')
          : item.text,
      uri: item.uri,
      meta: item.meta,
      duration:
        typeof item.meta?.durationSec === 'number'
          ? item.meta.durationSec
          : undefined,
      peakDb: undefined,
      status: item.status,
      createdAtMs,
      deletedAtMs: item.deletedAtMs ?? null,
      timestamp: toMessageTimestamp(createdAtMs),
      isSelf: Boolean(currentUserId) && item.senderId === currentUserId,
    };
  };

  const syncGuardiansFromCache = () => {
    const cached = ChatThreadService.getCachedMessages(
      guardiansConversationId,
      GUARDIANS_PAGE_SIZE,
    ).map(item => toGuardiansMessage(item, chatUser?.id));
    guardiansOldestCursorRef.current =
      cached.length > 0
        ? Number(cached[cached.length - 1].createdAtMs || 0)
        : null;
    setGuardiansHasMore(cached.length >= GUARDIANS_PAGE_SIZE);
    setMessages(prev => mergeChatMessages(prev, cached));
  };

  const sendGuardiansMessage = async (payload: {
    type: ChatMessageType;
    text?: string;
    uri?: string;
    meta?: ChatMessageMeta;
  }): Promise<boolean> => {
    if (!isGuardiansMode) return false;
    try {
      const activeUser = chatUser || (await ChatThreadService.getCurrentChatUser());
      const guardiansRoster =
        participants.length > 0 ? participants : await loadGuardiansRoster();
      if (participants.length === 0) {
        setParticipants(guardiansRoster);
      }
      const members = resolveGuardiansConversationMembers(
        activeUser.id,
        guardiansRoster,
      );
      const regionForShare = currentRegion;
      const canAttachLocation =
        regionForShare !== null &&
        Number.isFinite(Number(regionForShare.latitude)) &&
        Number.isFinite(Number(regionForShare.longitude));
      const sharedMeta =
        shareLocation &&
        canAttachLocation
          ? {
              ...(payload.meta || {}),
              location: {
                latitude: Number(regionForShare.latitude),
                longitude: Number(regionForShare.longitude),
                label:
                  typeof securityState.locationName === 'string' &&
                  securityState.locationName.trim().length > 0
                    ? securityState.locationName.trim()
                    : undefined,
                source: 'guardians_chat' as const,
                sharedAt: new Date().toISOString(),
              },
            }
          : payload.meta;
      await ChatThreadService.sendMessage({
        conversationId: guardiansConversationId,
        type: payload.type,
        text: payload.text,
        uri: payload.uri,
        meta: sharedMeta,
        conversation: {
          title: t('guardians_conversation_title'),
          type: 'group',
          members,
        },
      });
      syncGuardiansFromCache();
      return true;
    } catch {
      Alert.alert(t('messages_title'), t('chat_send_failed'));
      return false;
    }
  };

  const loadOlderGuardiansMessages = async () => {
    if (!isGuardiansMode) return;
    if (guardiansLoadingMore || !guardiansHasMore) return;
    const beforeCursor = guardiansOldestCursorRef.current;
    if (!beforeCursor) return;
    setGuardiansLoadingMore(true);
    try {
      const page = await ChatThreadService.loadOlderMessages(
        guardiansConversationId,
        beforeCursor,
        GUARDIANS_PAGE_SIZE,
      );
      const mapped = page.messages.map(item =>
        toGuardiansMessage(item, chatUser?.id),
      );
      if (mapped.length > 0) {
        guardiansOldestCursorRef.current = Number(
          mapped[mapped.length - 1].createdAtMs || beforeCursor,
        );
        setMessages(prev => mergeChatMessages(prev, mapped));
      }
      setGuardiansHasMore(page.hasMore);
    } catch {
      // ignore
    } finally {
      setGuardiansLoadingMore(false);
    }
  };

  useEffect(() => {
    if (hasSecurityLocation) return;
    void requestPreciseFixNow();
  }, [hasSecurityLocation, requestPreciseFixNow]);

  useEffect(() => {
    if (isGuardiansMode) return;
    const loadMessages = async () => {
      let shouldPersist = false;
      try {
        const raw = await AsyncStorage.getItem(CHAT_STORAGE_KEY);
        let list: ChatMessage[] = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];

        const systemText = t('chat_system_message');
        const hasSystem = list.some(
          msg => msg.sender === 'Central Alert' && msg.text === systemText,
        );
        if (!hasSystem) {
          list = [
            ...list,
            {
              id: `sys-${Date.now()}`,
              sender: 'Central Alert',
              type: 'text',
              text: systemText,
              timestamp: new Date(Date.now() - 1000).toISOString(),
              isSelf: false,
            },
          ];
          shouldPersist = true;
        }

        const shouldInject = Boolean(
          resolvedSenderName && (params.message || deepLinkTarget),
        );
        if (shouldInject) {
          const incomingText = params.message || t('chat_sos_shared');
          const exists = list.some(
            msg =>
              msg.sender === resolvedSenderName && msg.text === incomingText,
          );
          if (!exists) {
            list = [
              {
                id: `sos-${Date.now()}`,
                sender: resolvedSenderName || t('chat_sender_fallback'),
                type: 'text',
                text: incomingText,
                timestamp: new Date().toISOString(),
                isSelf: false,
              },
              ...list,
            ];
            shouldPersist = true;
          }
        }

        setMessages(list);
        setHasLoadedChat(true);
        if (shouldPersist) {
          await AsyncStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(list));
        }
      } catch {
        setMessages([]);
        setHasLoadedChat(true);
      }
    };
    void loadMessages();
  }, [resolvedSenderName, params.message, deepLinkTarget, t, isGuardiansMode]);

  useEffect(() => {
    if (isGuardiansMode) return;
    if (!hasLoadedChat) return;
    AsyncStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages)).catch(
      () => {
        // ignore persistence errors
      },
    );
  }, [messages, hasLoadedChat, isGuardiansMode]);

  useEffect(() => {
    const loadProfile = async () => {
      const profile = await ProfileService.getProfile();
      setProfileName(profile.name || '');
      const uri = typeof profile?.avatarUri === 'string' ? profile.avatarUri.trim() : '';
      setAvatarUri(uri ? uri : null);
    };
    void loadProfile();
  }, []);

  const loadGuardians = async () => {
    const list = await loadGuardiansRoster();
    setParticipants(list);
  };

  useEffect(() => {
    void loadGuardians();
    const unsubscribe = navigation.addListener('focus', () => {
      void loadGuardians();
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const loadRoute = async () => {
      if (!target || !currentRegion) {
        setRouteLine([]);
        setRouteMeta(null);
        return;
      }
      const details = await RouteService.getRouteDetails(
        {
          latitude: currentRegion.latitude,
          longitude: currentRegion.longitude,
        },
        { latitude: target.latitude, longitude: target.longitude },
      );
      setRouteLine(details.line);
      setRouteMeta(details);
    };
    void loadRoute();
  }, [target, currentRegion]);

  useEffect(() => {
    if (currentRegion?.latitude && currentRegion?.longitude && isFollowing) {
      setCameraCenter([currentRegion.longitude, currentRegion.latitude]);
    }
  }, [currentRegion?.latitude, currentRegion?.longitude, isFollowing]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const textValue = input.trim();
    setInput('');
    if (isGuardiansMode) {
      await sendGuardiansMessage({ type: 'text', text: textValue });
      return;
    }
    const next: ChatMessage = {
      id: String(Date.now()),
      sender: selfName,
      type: 'text',
      text: textValue,
      timestamp: new Date().toISOString(),
      isSelf: true,
    };
    setMessages(prev => [next, ...prev]);
  };

  const handlePickImage = async () => {
    const status = await PermissionManager.requestStoragePermission();
    if (status !== 'granted') return;

    const result = await launchImageLibrary({ mediaType: 'photo' });
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    if (isGuardiansMode) {
      await sendGuardiansMessage({
        type: 'image',
        uri: asset.uri,
        meta: {
          fileName: asset.fileName || undefined,
          mimeType: asset.type || undefined,
          size: typeof asset.fileSize === 'number' ? asset.fileSize : undefined,
        },
      });
      return;
    }

    const next: ChatMessage = {
      id: String(Date.now()),
      sender: selfName,
      type: 'image',
      uri: asset.uri,
      timestamp: new Date().toISOString(),
      isSelf: true,
    };
    setMessages(prev => [next, ...prev]);
  };

  const handleCaptureVideo = async () => {
    const status = await PermissionManager.requestCameraPermission();
    if (status !== 'granted') return;
    const micStatus = await PermissionManager.requestMicrophonePermission();
    if (micStatus !== 'granted') return;

    const result = await launchCamera({
      mediaType: 'video',
      cameraType: 'back',
      videoQuality: 'high',
      durationLimit: 60,
    });
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    if (isGuardiansMode) {
      await sendGuardiansMessage({
        type: 'video',
        uri: asset.uri,
        meta: {
          fileName: asset.fileName || undefined,
          mimeType: asset.type || undefined,
          size: typeof asset.fileSize === 'number' ? asset.fileSize : undefined,
        },
      });
      return;
    }

    const next: ChatMessage = {
      id: String(Date.now()),
      sender: selfName,
      type: 'video',
      uri: asset.uri,
      timestamp: new Date().toISOString(),
      isSelf: true,
    };
    setMessages(prev => [next, ...prev]);
  };

  const stopPlayback = async () => {
    try {
      await audioRecorderPlayer.stopPlayer();
    } catch {
      // ignore
    }
    audioRecorderPlayer.removePlayBackListener();
    await ProximityAudioService.stop();
    setPlayingId(null);
    setPlaybackPositionMs(0);
    setPlaybackDurationMs(0);
  };

  const toggleAudioPlayback = async (message: ChatMessage) => {
    if (!message?.uri) return;
    if (!audioMessagingAvailable) {
      Alert.alert(
        t('chat_audio_unavailable_title'),
        t('chat_audio_unavailable_body'),
      );
      return;
    }
    if (playingId === message.id) {
      await stopPlayback();
      return;
    }
    await stopPlayback();
    try {
      await ProximityAudioService.start();
      // On Android the native module expects a raw file path for local files.
      // stopRecorder() returns `file:///...`, so normalize before playback.
      const playbackUri =
        Platform.OS === 'android' && message.uri.startsWith('file://')
          ? message.uri.replace(/^file:\/\//, '')
          : message.uri;
      await audioRecorderPlayer.startPlayer(playbackUri);
      await audioRecorderPlayer.setVolume(
        resolvePlaybackVolume(message.peakDb),
      );
      setPlayingId(message.id);
      audioRecorderPlayer.addPlayBackListener(e => {
        const duration = e.duration || 0;
        const position = e.currentPosition || 0;
        setPlaybackDurationMs(duration);
        setPlaybackPositionMs(position);
        if (duration > 0 && position >= duration) {
          void stopPlayback();
        }
        return;
      });
    } catch {
      await ProximityAudioService.stop();
      setPlayingId(null);
    }
  };

  const startRecording = async () => {
    if (recordingRef.current) return;
    if (!audioMessagingAvailable) {
      Alert.alert(
        t('chat_audio_unavailable_title'),
        t('chat_audio_unavailable_body'),
      );
      return;
    }
    const status = await PermissionManager.requestMicrophonePermission();
    if (status !== 'granted') {
      if (status === 'blocked') {
        Alert.alert(
          t('permission_microphone_title'),
          t('permission_blocked_body'),
          [
            { text: t('common_cancel'), style: 'cancel' },
            {
              text: t('common_open_settings'),
              onPress: PermissionManager.openSettings,
            },
          ],
        );
      } else {
        Alert.alert(
          t('permission_microphone_title'),
          t('permission_denied_body'),
          [{ text: t('close'), style: 'cancel' }],
        );
      }
      return;
    }
    await stopPlayback();
    try {
      // Set the ref synchronously so a quick release can still stop/send.
      recordingRef.current = true;
      setRecording(true);
      recordingCancelRef.current = false;
      recordingLockedRef.current = false;
      recordingStartedAtRef.current = Date.now();
      recordingPeakDbRef.current = null;
      setRecordingSeconds(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
      await audioRecorderPlayer.startRecorder(undefined, VOICE_AUDIO_SET, true);
      audioRecorderPlayer.addRecordBackListener(e => {
        if (typeof e.currentMetering === 'number') {
          const current = recordingPeakDbRef.current;
          const next = e.currentMetering;
          recordingPeakDbRef.current =
            typeof current === 'number' ? Math.max(current, next) : next;
        }
        return;
      });
    } catch (err) {
      console.warn('[Chat] startRecorder failed:', err);
      recordingRef.current = false;
      recordingLockedRef.current = false;
      recordingStartedAtRef.current = null;
      setRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    // Prevent duplicate stop calls while async work is in flight.
    recordingRef.current = false;
    recordingLockedRef.current = false;
    try {
      const uri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(false);
      setRecordingLocked(false);
      const startedAt = recordingStartedAtRef.current;
      const durationSeconds =
        typeof startedAt === 'number'
          ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
          : recordingSeconds;
      recordingStartedAtRef.current = null;
      if (!uri) return;
      if (isGuardiansMode) {
        await sendGuardiansMessage({
          type: 'audio',
          uri,
          meta: {
            durationSec: durationSeconds,
          },
        });
        recordingPeakDbRef.current = null;
        return;
      }
      const next: ChatMessage = {
        id: String(Date.now()),
        sender: selfName,
        type: 'audio',
        uri,
        duration: durationSeconds,
        peakDb:
          typeof recordingPeakDbRef.current === 'number'
            ? recordingPeakDbRef.current
            : undefined,
        timestamp: new Date().toISOString(),
        isSelf: true,
      };
      recordingPeakDbRef.current = null;
      setMessages(prev => [next, ...prev]);
    } catch (err) {
      console.warn('[Chat] stopRecorder failed:', err);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(false);
      setRecordingLocked(false);
      recordingStartedAtRef.current = null;
      recordingPeakDbRef.current = null;
    }
  };

  const cancelRecording = async () => {
    if (!recordingRef.current) return;
    try {
      recordingRef.current = false;
      recordingLockedRef.current = false;
      recordingCancelRef.current = true;
      await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
    } catch (err) {
      console.warn('[Chat] cancelRecording failed:', err);
      // ignore
    } finally {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(false);
      setRecordingLocked(false);
      recordingStartedAtRef.current = null;
      recordingPeakDbRef.current = null;
    }
  };

  const playVideo = async (uri?: string) => {
    if (!uri) return;
    try {
      await Linking.openURL(uri);
    } catch {
      Alert.alert(t('chat_call_video'), t('chat_video_failed'));
    }
  };

  const handleRegionDidChange = (payload: unknown) => {
    if (!currentRegion?.latitude || !currentRegion?.longitude) return;
    const center = getCenterFromPayload(payload);
    if (!center) return;
    const dist = distanceMeters(
      { lat: currentRegion.latitude, lon: currentRegion.longitude },
      { lat: center[1], lon: center[0] },
    );
    const shouldShow = dist > 60;
    if (shouldShow !== showRecenter) {
      setShowRecenter(shouldShow);
    }
    if (shouldShow && isFollowing) {
      setIsFollowing(false);
    }
  };

  const handleRecenter = () => {
    if (!currentRegion?.latitude || !currentRegion?.longitude) return;
    setIsFollowing(true);
    setCameraCenter([currentRegion.longitude, currentRegion.latitude]);
    cameraRef.current?.setCamera({
      centerCoordinate: [currentRegion.longitude, currentRegion.latitude],
      zoomLevel: 15,
      animationMode: 'easeTo',
      animationDuration: 400,
    });
    setShowRecenter(false);
  };

  const handleShare = async () => {
    if (!currentRegion?.latitude || !currentRegion?.longitude) return;
    const shareLat = target?.latitude ?? currentRegion.latitude;
    const shareLon = target?.longitude ?? currentRegion.longitude;
    const shareName = encodeURIComponent(
      profileName || t('chat_sender_fallback'),
    );
    const deepLink = `alertapp://sos?lat=${shareLat}&lon=${shareLon}&user=${shareName}`;
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${shareLat},${shareLon}`;
    const message = `${t('share_sos_prefix')} ${deepLink} ${t(
      'share_sos_fallback',
    )} ${mapsLink}`;
    try {
      await Share.share({ message, url: deepLink });
    } catch {
      // ignore share failures
    }
  };

  const openMenu = () => setMenuVisible(true);
  const closeMenu = () => setMenuVisible(false);

  const startGroupCall = async (withVideo: boolean) => {
    const roomId = `alert-guardians-${Date.now().toString(36)}`;
    const config = withVideo ? '' : '#config.startWithVideoMuted=true';
    const link = `https://meet.jit.si/${roomId}${config}`;
    setActiveCall({
      type: withVideo ? 'video' : 'voice',
      link,
      startedAt: new Date().toISOString(),
    });
    const callText = withVideo
      ? `${t('chat_video_room')}: ${link}`
      : `${t('chat_voice_room')}: ${link}`;
    if (isGuardiansMode) {
      await sendGuardiansMessage({
        type: 'text',
        text: callText,
      });
    } else {
      const next: ChatMessage = {
        id: String(Date.now()),
        sender: selfName,
        type: 'text',
        text: callText,
        timestamp: new Date().toISOString(),
        isSelf: true,
      };
      setMessages(prev => [next, ...prev]);
    }
    try {
      await Linking.openURL(link);
    } catch {
      Alert.alert(
        withVideo ? t('chat_call_video') : t('chat_call_voice'),
        withVideo ? t('chat_video_failed') : t('chat_call_failed'),
      );
    }
  };

  const handleReturnToCall = async () => {
    if (!activeCall) return;
    try {
      await Linking.openURL(activeCall.link);
    } catch {
      Alert.alert(
        activeCall.type === 'video'
          ? t('chat_call_video')
          : t('chat_call_voice'),
        activeCall.type === 'video'
          ? t('chat_video_failed')
          : t('chat_call_failed'),
      );
    }
  };

  const [callTicker, setCallTicker] = useState(0);

  useEffect(() => {
    if (!activeCall) {
      setCallTicker(0);
      return;
    }
    const interval = setInterval(() => {
      setCallTicker(value => value + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeCall]);

  const callDuration = useMemo(() => {
    if (!activeCall) return null;
    const start = new Date(activeCall.startedAt).getTime();
    if (!start) return null;
    const diff = Math.max(0, Date.now() - start);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [activeCall, callTicker]);

  const handleVoiceCall = async () => {
    if (participants.length === 0) {
      Alert.alert(t('chat_call_voice'), t('chat_no_guardians'));
      return;
    }
    void startGroupCall(false);
  };

  const handleVideoCall = async () => {
    if (participants.length === 0) {
      Alert.alert(t('chat_call_video'), t('chat_no_guardians'));
      return;
    }
    void startGroupCall(true);
  };

  const handleMessageActions = (item: ChatMessage) => {
    const doShare = async () => {
      try {
        if (item.type === 'text' && item.text) {
          await Share.share({ message: item.text });
        } else if (item.uri) {
          await Share.share({ url: item.uri, message: item.uri });
        }
      } catch {
        // ignore
      }
    };

    const doCopy = () => {
      if (item.type !== 'text' || !item.text) return;
      Alert.alert(t('chat_action_copy'), t('chat_copy_unavailable'));
    };

    const doDelete = () => {
      if (isGuardiansMode) {
        void ChatThreadService.softDeleteMessage(
          guardiansConversationId,
          item.id,
        )
          .then(() => {
            syncGuardiansFromCache();
          })
          .catch(() => {});
        return;
      }
      setMessages(prev => prev.filter(msg => msg.id !== item.id));
    };

    Alert.alert(t('chat_action_title'), undefined, [
      { text: t('chat_action_copy'), onPress: doCopy },
      { text: t('chat_action_share'), onPress: () => void doShare() },
      {
        text: t('chat_action_delete'),
        style: 'destructive',
        onPress: doDelete,
      },
      { text: t('chat_action_cancel'), style: 'cancel' },
    ]);
  };

  const micPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (recordingLockedRef.current) {
            ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.success);
            void stopRecording();
            return;
          }
          recordingLockedRef.current = false;
          recordingCancelRef.current = false;
          setRecordingLocked(false);
          ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.light);
          void startRecording();
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx < -80 && !recordingLockedRef.current) {
            ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.error);
            void cancelRecording();
            return;
          }
          if (gestureState.dy < -40 && !recordingLockedRef.current) {
            recordingLockedRef.current = true;
            setRecordingLocked(true);
            ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.medium);
          }
        },
        onPanResponderRelease: () => {
          if (!recordingLockedRef.current && !recordingCancelRef.current) {
            ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.success);
            void stopRecording();
          }
        },
        onPanResponderTerminate: () => {
          if (!recordingLockedRef.current && !recordingCancelRef.current) {
            void stopRecording();
          }
        },
      }),
    [],
  );

  const formatDuration = (total: number) => {
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getAudioProgress = (message: ChatMessage) => {
    if (playingId !== message.id || playbackDurationMs <= 0) return 0;
    return Math.min(1, playbackPositionMs / playbackDurationMs);
  };

  const getAudioTimeLabel = (message: ChatMessage) => {
    const isPlaying = playingId === message.id;
    const totalSeconds =
      message.duration ??
      (isPlaying && playbackDurationMs > 0
        ? Math.floor(playbackDurationMs / 1000)
        : 0);
    const currentSeconds = isPlaying
      ? Math.floor(playbackPositionMs / 1000)
      : totalSeconds;
    if (!totalSeconds) {
      return formatDuration(currentSeconds);
    }
    if (isPlaying) {
      return `${formatDuration(currentSeconds)} / ${formatDuration(
        totalSeconds,
      )}`;
    }
    return formatDuration(totalSeconds);
  };

  const toggleShareLocation = () => {
    ReactNativeHapticFeedback.trigger(chatThemeTokens.haptics.light);
    setShareLocation(prev => {
      const next = !prev;
      if (next) {
        setLocationToast(true);
        if (locationToastTimeoutRef.current) {
          clearTimeout(locationToastTimeoutRef.current);
        }
        locationToastTimeoutRef.current = setTimeout(() => {
          setLocationToast(false);
        }, 2400);
      }
      return next;
    });
  };

  const openSafetyMap = () => {
    navigation.navigate('SafetyMap', {
      targetLocation: target || undefined,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={styles.mapBox}
        accessibilityRole="button"
        accessibilityLabel={t('chat_map_loading')}
        accessibilityHint={t('map_loading')}
      >
        {currentRegion ? (
          <MapLibreGL.MapView
            style={styles.map}
            mapStyle={mapStyle}
            scrollEnabled
            zoomEnabled
            rotateEnabled={false}
            pitchEnabled={false}
            compassEnabled={false}
            attributionEnabled
            logoEnabled={false}
            preferredFramesPerSecond={30}
            regionDidChangeDebounceTime={350}
            onRegionDidChange={handleRegionDidChange}
            onPress={openSafetyMap}
          >
            <MapLibreGL.Camera
              ref={cameraRef}
              zoomLevel={15}
              centerCoordinate={
                cameraCenter ?? [
                  currentRegion.longitude,
                  currentRegion.latitude,
                ]
              }
              animationMode="easeTo"
              animationDuration={0}
              maxZoomLevel={19}
            />

            <MapLibreGL.PointAnnotation
              id="me"
              coordinate={[currentRegion.longitude, currentRegion.latitude]}
            >
              <View style={styles.markerSelf}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.markerAvatar} />
                ) : (
                  <Icon name="account-circle" size={22} color="#1565C0" />
                )}
              </View>
            </MapLibreGL.PointAnnotation>

            {target && (
              <MapLibreGL.PointAnnotation
                id="target"
                coordinate={[target.longitude, target.latitude]}
              >
                <View style={styles.markerTarget}>
                  <Icon name="alert-decagram" size={22} color={colors.alert} />
                </View>
              </MapLibreGL.PointAnnotation>
            )}

            {guardianMapMarkers.map(item => (
              <MapLibreGL.PointAnnotation
                key={item.annotationId}
                id={item.annotationId}
                coordinate={item.coordinate}
              >
                <View
                  style={[
                    styles.markerGuardian,
                    item.source === 'shared'
                      ? {
                          backgroundColor: colors.primary,
                          borderColor: colors.primary,
                        }
                      : {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                        },
                  ]}
                >
                  <Icon
                    name="shield-account"
                    size={16}
                    color={item.source === 'shared' ? '#FFFFFF' : colors.primary}
                  />
                </View>
              </MapLibreGL.PointAnnotation>
            ))}

            {routeLine.length > 1 && routeMeta?.routeMode !== 'unavailable' && (
              <MapLibreGL.ShapeSource
                id="route"
                shape={routeLineShape}
              >
                <MapLibreGL.LineLayer
                  id="routeLine"
                  style={routeLineStyle}
                />
              </MapLibreGL.ShapeSource>
            )}
          </MapLibreGL.MapView>
        ) : (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={openSafetyMap}
            style={[
              styles.map,
              styles.mapPlaceholder,
              { backgroundColor: colors.card },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('chat_map_loading')}
            accessibilityHint={t('map_loading')}
          >
            <Text
              style={[
                styles.mapPlaceholderText,
                { color: colors.textSecondary },
              ]}
            >
              {t('chat_map_loading')}
            </Text>
          </TouchableOpacity>
        )}

        {showPanicOverlay && (
          <View pointerEvents="none" style={styles.panicOverlay} />
        )}
        <View
          pointerEvents="none"
          style={[styles.mapGlow, { backgroundColor: colors.primary }]}
        />

        {routeLabel && (
          <View
            style={[
              styles.routeSummary,
              routeLabel.degraded && {
                backgroundColor: 'rgba(255, 204, 0, 0.18)',
                borderColor: ROUTE_ESTIMATED_COLOR,
              },
            ]}
            accessible
            accessibilityRole="text"
            accessibilityLabel={routeLabel.text}
          >
            <Icon
              name={routeLabel.icon}
              size={14}
              color={routeLabel.degraded ? ROUTE_ESTIMATED_COLOR : '#FFF'}
            />
            <Text
              style={[
                styles.routeText,
                routeLabel.degraded && { color: ROUTE_ESTIMATED_COLOR },
              ]}
            >
              {routeLabel.text}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.shareButton,
            { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          onPress={handleShare}
          activeOpacity={0.9}
        >
          <Icon name="share-variant" size={18} color="#FFF" />
          <Text style={[styles.shareText, { color: '#FFF' }]}>
            {t('chat_share')}
          </Text>
        </TouchableOpacity>

        {showRecenter && (
          <TouchableOpacity
            style={[
              styles.recenterButton,
              {
                backgroundColor: isDark ? '#111111' : '#FFFFFF',
                borderColor: isDark
                  ? 'rgba(255,255,255,0.16)'
                  : 'rgba(17,17,17,0.12)',
              },
            ]}
            onPress={handleRecenter}
            activeOpacity={0.9}
          >
            <Icon
              name="crosshairs-gps"
              size={16}
              color={isDark ? '#FFFFFF' : '#111111'}
            />
            <Text
              style={[
                styles.recenterText,
                { color: isDark ? '#FFFFFF' : '#111111' },
              ]}
            >
              {t('recenter')}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[
            styles.btnTopLeft,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon name="chevron-left" size={30} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openMenu}
          style={[
            styles.btnTopRight,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon name="dots-vertical" size={30} color={colors.text} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={[styles.chatContainer, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSide} />
          <View style={styles.headerCenter}>
            <View
              style={[
                styles.headerPill,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.chatTitle, { color: colors.text }]}>
                {isGuardiansMode
                  ? t('guardians_conversation_title')
                  : t('chat_title')}
              </Text>
            </View>
            {guardiansSubtitle ? (
              <Text
                style={[styles.chatSubtitle, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {guardiansSubtitle}
              </Text>
            ) : resolvedSenderName ? (
              <Text
                style={[styles.chatSubtitle, { color: colors.textSecondary }]}
              >
                {t('chat_subtitle_sos', { name: resolvedSenderName })}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[
                styles.headerIconBtn,
                { backgroundColor: colors.surface },
              ]}
              onPress={handleVoiceCall}
            >
              <Icon name="phone" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.headerIconBtn,
                { backgroundColor: colors.surface },
              ]}
              onPress={handleVideoCall}
            >
              <Icon name="video" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {activeCall && (
          <View
            style={[
              styles.callBanner,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.callBannerInfo}>
              <Icon
                name={activeCall.type === 'video' ? 'video' : 'phone'}
                size={18}
                color={colors.primary}
              />
              <View>
                <Text style={[styles.callBannerText, { color: colors.text }]}>
                  {activeCall.type === 'video'
                    ? t('chat_call_active_video')
                    : t('chat_call_active_voice')}
                </Text>
                {callDuration && (
                  <Text
                    style={[
                      styles.callBannerTime,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {callDuration}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.callBannerActions}>
              <TouchableOpacity
                onPress={handleReturnToCall}
                style={[styles.callBannerBtn, { borderColor: colors.primary }]}
              >
                <Text
                  style={[styles.callBannerBtnText, { color: colors.primary }]}
                >
                  {t('chat_call_return')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveCall(null)}
                style={[
                  styles.callBannerBtn,
                  styles.callBannerBtnSolid,
                  { backgroundColor: colors.alert, borderColor: colors.alert },
                ]}
              >
                <Text style={styles.callBannerBtnSolidText}>
                  {t('chat_call_end')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {locationToast && (
          <View style={[styles.toast, { backgroundColor: colors.primary }]}>
            <Icon name="map-marker" size={14} color="#FFF" />
            <Text style={styles.toastText}>{t('chat_location_shared')}</Text>
          </View>
        )}

        <View style={styles.participantsRow}>
          {participants.length === 0 ? (
            <Text
              style={[styles.participantEmpty, { color: colors.textSecondary }]}
            >
              {t('chat_no_guardians')}
            </Text>
          ) : (
            participants.map(p => {
              const hasLocation = participantLocationKeys.has(p.remoteId || p.id);
              return (
                <View
                  key={p.id}
                  style={[
                    styles.participantChip,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Icon
                    name={
                      hasLocation ? 'map-marker-check-outline' : 'shield-account'
                    }
                    size={14}
                    color={hasLocation ? colors.primary : colors.textSecondary}
                    style={styles.participantIcon}
                  />
                  <Text style={[styles.participantText, { color: colors.text }]}>
                    {p.name}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <FlatList
          data={messages}
          keyExtractor={item => item.id}
          inverted
          contentContainerStyle={styles.chatList}
          onEndReached={
            isGuardiansMode
              ? () => void loadOlderGuardiansMessages()
              : undefined
          }
          onEndReachedThreshold={0.2}
          accessibilityRole="list"
          accessibilityLabel={t('messages_title')}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => handleMessageActions(item)}
              delayLongPress={250}
              style={[
                styles.bubble,
                item.isSelf ? styles.bubbleSelf : styles.bubbleOther,
                {
                  backgroundColor: item.isSelf ? colors.primary : colors.card,
                  borderColor: item.isSelf ? 'transparent' : colors.border,
                },
              ]}
            >
              {!item.isSelf && (
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: '600',
                    marginBottom: 4,
                  }}
                >
                  {item.sender}
                </Text>
              )}
              {item.type === 'text' && (
                <Text
                  style={[
                    styles.bubbleText,
                    { color: item.isSelf ? '#FFF' : colors.text },
                  ]}
                >
                  {item.text}
                </Text>
              )}
              {item.type === 'image' && item.uri && (
                <Image source={{ uri: item.uri }} style={styles.imageMsg} />
              )}
              {item.type === 'video' && (
                <TouchableOpacity
                  onPress={() => playVideo(item.uri)}
                  style={[
                    styles.mediaButton,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Icon name="play-circle-outline" size={20} color="#FFF" />
                  <Text style={styles.mediaText}>{t('chat_video_play')}</Text>
                </TouchableOpacity>
              )}
              {item.type === 'audio' && (
                <TouchableOpacity
                  onPress={() => void toggleAudioPlayback(item)}
                  style={[
                    styles.audioRow,
                    {
                      backgroundColor: item.isSelf
                        ? colors.primary
                        : colors.card,
                      borderColor: item.isSelf ? 'transparent' : colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.audioPlay,
                      {
                        backgroundColor: item.isSelf
                          ? 'rgba(255,255,255,0.2)'
                          : colors.surface,
                      },
                    ]}
                  >
                    <Icon
                      name={playingId === item.id ? 'pause' : 'play'}
                      size={16}
                      color={item.isSelf ? '#FFF' : colors.text}
                    />
                  </View>
                  <View
                    style={[
                      styles.audioTrack,
                      {
                        backgroundColor: item.isSelf
                          ? 'rgba(255,255,255,0.25)'
                          : colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.audioProgress,
                        {
                          width: `${Math.round(getAudioProgress(item) * 100)}%`,
                          backgroundColor: item.isSelf
                            ? '#FFF'
                            : colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.audioTime,
                      { color: item.isSelf ? '#E3F2FD' : colors.textSecondary },
                    ]}
                  >
                    {getAudioTimeLabel(item)}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={styles.bubbleMetaRow}>
                {item.isSelf && item.status ? (
                  <Icon
                    name={
                      item.status === 'failed'
                        ? 'alert-circle-outline'
                        : item.status === 'pending'
                        ? 'clock-outline'
                        : item.status === 'sent'
                        ? 'check'
                        : 'check-all'
                    }
                    size={12}
                    color={item.isSelf ? '#E3F2FD' : colors.textSecondary}
                  />
                ) : null}
                <Text
                  style={{
                    color: item.isSelf ? '#E3F2FD' : colors.textSecondary,
                    fontSize: 10,
                    marginTop: 0,
                  }}
                >
                  {new Date(item.timestamp).toLocaleTimeString(localeTag)}
                </Text>
              </View>
            </Pressable>
          )}
        />

        {isGuardiansMode && guardiansLoadingMore && (
          <Text
            style={[styles.loadingMoreText, { color: colors.textSecondary }]}
          >
            {t('map_loading')}
          </Text>
        )}

        {recording && (
          <View
            style={[
              styles.recordingBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.recordingLeft}>
              <View
                style={[styles.recordingDot, { backgroundColor: colors.alert }]}
              />
              <Text style={[styles.recordingTime, { color: colors.text }]}>
                {formatDuration(recordingSeconds)}
              </Text>
            </View>
            {!recordingLocked ? (
              <View style={styles.recordingHintRow}>
                <Icon
                  name="chevron-left"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text
                  style={[
                    styles.recordingHint,
                    { color: colors.textSecondary },
                  ]}
                >
                  {t('chat_recording_cancel')}
                </Text>
              </View>
            ) : (
              <View style={styles.recordingHintRow}>
                <Icon name="lock" size={14} color={colors.primary} />
                <Text style={[styles.recordingHint, { color: colors.primary }]}>
                  {t('chat_recording_send')}
                </Text>
              </View>
            )}
          </View>
        )}

        {recording && !recordingLocked && (
          <View
            style={[
              styles.lockHint,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.lockTrack}>
              <View
                style={[
                  styles.lockTrackDot,
                  { backgroundColor: colors.textSecondary },
                ]}
              />
              <View
                style={[
                  styles.lockTrackDot,
                  { backgroundColor: colors.textSecondary, opacity: 0.6 },
                ]}
              />
              <View
                style={[
                  styles.lockTrackDot,
                  { backgroundColor: colors.textSecondary, opacity: 0.4 },
                ]}
              />
            </View>
            <Text
              style={[styles.lockHintText, { color: colors.textSecondary }]}
            >
              {t('chat_recording_lock_hint')}
            </Text>
          </View>
        )}

        {recording && recordingLocked && (
          <View
            style={[
              styles.recordingSheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <TouchableOpacity
              onPress={() => void cancelRecording()}
              style={styles.recordingSheetBtn}
            >
              <Icon name="trash-can-outline" size={18} color={colors.alert} />
            </TouchableOpacity>
            <View style={styles.recordingSheetCenter}>
              <Text style={[styles.recordingSheetTime, { color: colors.text }]}>
                {formatDuration(recordingSeconds)}
              </Text>
              <Text
                style={[
                  styles.recordingSheetLabel,
                  { color: colors.textSecondary },
                ]}
              >
                {t('chat_recording_locked')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => void stopRecording()}
              style={[
                styles.recordingSheetBtn,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Icon name="send" size={18} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        <View
          style={[
            styles.inputRow,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          {!recording ? (
            <>
              <TouchableOpacity
                onPress={handlePickImage}
                style={[styles.iconBtn, { backgroundColor: colors.surface }]}
              >
                <Icon name="paperclip" size={22} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCaptureVideo}
                style={[styles.iconBtn, { backgroundColor: colors.surface }]}
              >
                <Icon name="camera" size={22} color={colors.text} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder={t('chat_send_message')}
                placeholderTextColor={colors.textSecondary}
                value={input}
                onChangeText={setInput}
                allowFontScaling
                accessibilityLabel={t('chat_send_message')}
                accessibilityHint={t('chat_send_message')}
              />
              <TouchableOpacity
                onPress={toggleShareLocation}
                style={[
                  styles.locationBtn,
                  {
                    backgroundColor: shareLocation
                      ? colors.primary
                      : colors.surface,
                    borderColor: shareLocation ? colors.primary : colors.border,
                  },
                ]}
              >
                <Icon
                  name="map-marker"
                  size={20}
                  color={shareLocation ? '#FFF' : colors.text}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSend}
                style={[styles.sendBtn, { backgroundColor: colors.primary }]}
              >
                <Icon name="send" size={20} color="#FFF" />
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <View
            // Use a plain View for PanResponder. Pressable can swallow responder
            // props on Android, which breaks hold-to-record.
            {...micPanResponder.panHandlers}
            style={[
              styles.micBtn,
              { backgroundColor: colors.alert },
              recording && styles.micBtnActive,
            ]}
          >
            <Icon
              name={recordingLocked ? 'send' : 'microphone'}
              size={20}
              color="#FFF"
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <BasePopup
        accessibilityLabel={t('chat_menu_title')}
        contentStyle={[
          styles.menuCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        maxWidth={560}
        onClose={closeMenu}
        placement="bottom"
        showHandle
        visible={menuVisible}
      >
            <Text style={[styles.menuTitle, { color: colors.text }]}>
              {t('chat_menu_title')}
            </Text>
            {!isGuardiansMode && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  closeMenu();
                  navigation.navigate('ChatMonitor', {
                    conversationId: GUARDIANS_CONVERSATION_ID,
                    mode: 'GUARDIANS_GROUP',
                  });
                }}
              >
                <Icon
                  name="shield-account"
                  size={20}
                  color={colors.text}
                />
                <Text style={[styles.menuItemText, { color: colors.text }]}>
                  {t('chat_menu_guardians_group')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                Alert.alert(t('chat_menu_search'), t('chat_menu_search'));
              }}
            >
              <Icon name="magnify" size={20} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_search')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                Alert.alert(t('chat_menu_mute'), t('chat_menu_mute'));
              }}
            >
              <Icon name="bell-off-outline" size={20} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_mute')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                navigation.navigate('ThemeSettings');
              }}
            >
              <Icon name="palette-outline" size={20} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_theme')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                navigation.navigate('Guardians');
              }}
            >
              <Icon
                name="account-multiple-plus-outline"
                size={20}
                color={colors.text}
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_add_members')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                Alert.alert(t('chat_menu_photo'), t('chat_menu_photo'));
              }}
            >
              <Icon name="image-outline" size={20} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_photo')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                Alert.alert(t('chat_menu_data'), t('chat_menu_data'));
              }}
            >
              <Icon name="information-outline" size={20} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {t('chat_menu_data')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuDanger]}
              onPress={() => {
                closeMenu();
                Alert.alert(
                  t('chat_menu_delete_confirm_title'),
                  t('chat_menu_delete_confirm_body'),
                  [
                    {
                      text: t('chat_menu_delete_confirm_cancel'),
                      style: 'cancel',
                    },
                    {
                      text: t('chat_menu_delete_confirm_ok'),
                      style: 'destructive',
                      onPress: async () => {
                        setMessages([]);
                        await AsyncStorage.removeItem(CHAT_STORAGE_KEY);
                      },
                    },
                  ],
                );
              }}
            >
              <Icon name="trash-can-outline" size={20} color={colors.alert} />
              <Text style={[styles.menuItemText, { color: colors.alert }]}>
                {t('chat_menu_delete')}
              </Text>
            </TouchableOpacity>
      </BasePopup>
    </View>
  );
};

export const ChatMonitorScreen = ({ navigation, route }: ChatMonitorScreenProps) => {
  const params = (route?.params || {}) as ChatParams;
  const guardiansConversationId = params.conversationId;
  const isGuardiansMode =
    params.mode === 'GUARDIANS_GROUP' ||
    String(guardiansConversationId || '').trim().toLowerCase() ===
      GUARDIANS_CONVERSATION_ID;

  if (isGuardiansMode) {
    return (
      <GuardiansGroupChatScreen navigation={navigation} params={params} />
    );
  }

  return <LegacyChatMonitorScreen navigation={navigation} params={params} />;
};

export default ChatMonitorScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapBox: { height: '35%', width: '100%' },
  map: { ...StyleSheet.absoluteFillObject },
  panicOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,20,20,0.45)',
  },
  mapPlaceholder: {
    backgroundColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholderText: {
    color: '#FFFFFF',
    fontSize: 12,
    opacity: 0.8,
    fontFamily: FONT_FAMILY,
  },
  mapGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -100,
    top: -120,
    opacity: 0.08,
  },
  btnTopLeft: {
    position: 'absolute',
    top: 50,
    left: 20,
    borderRadius: 25,
    padding: 5,
    zIndex: 10,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  btnTopRight: {
    position: 'absolute',
    top: 50,
    right: 20,
    borderRadius: 25,
    padding: 5,
    zIndex: 10,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  shareButton: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: chatThemeTokens.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    zIndex: 10,
  },
  shareText: { fontSize: 12, fontWeight: '700', fontFamily: FONT_FAMILY },
  recenterButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  recenterText: { fontSize: 12, fontWeight: '700', fontFamily: FONT_FAMILY },
  routeSummary: {
    position: 'absolute',
    bottom: 12,
    right: 58,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  chatContainer: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    backgroundColor: 'transparent',
  },
  chatHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  headerSide: { width: 88 },
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  headerPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 88,
    justifyContent: 'flex-end',
  },
  callBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  callBannerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  callBannerText: { fontSize: 13, fontWeight: '700', fontFamily: FONT_FAMILY },
  callBannerTime: { fontSize: 11, marginTop: 2, fontFamily: FONT_FAMILY },
  callBannerActions: { flexDirection: 'row', gap: 8 },
  callBannerBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  callBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  callBannerBtnSolid: {},
  callBannerBtnSolidText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatTitle: { fontSize: 16, fontWeight: '800', fontFamily: FONT_FAMILY },
  chatSubtitle: { fontSize: 12, marginTop: 6, fontFamily: FONT_FAMILY },
  toast: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  participantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  participantIcon: {
    marginRight: 6,
  },
  participantText: { fontSize: 12, fontWeight: '600', fontFamily: FONT_FAMILY },
  participantEmpty: {
    fontSize: 12,
    paddingVertical: 6,
    fontFamily: FONT_FAMILY,
  },
  chatList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  loadingMoreText: {
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 6,
    fontFamily: FONT_FAMILY,
  },
  bubble: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    maxWidth: '85%',
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 1 },
    }),
  },
  bubbleSelf: { alignSelf: 'flex-end' },
  bubbleOther: { alignSelf: 'flex-start' },
  imageMsg: { width: 180, height: 120, borderRadius: 12, marginTop: 6 },
  mediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  mediaText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  audioPlay: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  audioProgress: {
    height: '100%',
    borderRadius: 2,
  },
  audioTime: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FONT_FAMILY,
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 6,
  },
  bubbleText: { fontSize: 14, lineHeight: 20, fontFamily: FONT_FAMILY },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  recordingLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 8, height: 8, borderRadius: 4 },
  recordingTime: { fontSize: 13, fontWeight: '700', fontFamily: FONT_FAMILY },
  recordingHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recordingHint: { fontSize: 11, fontFamily: FONT_FAMILY },
  lockHint: {
    position: 'absolute',
    right: 68,
    bottom: 94,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lockHintText: { fontSize: 11, fontFamily: FONT_FAMILY },
  lockTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockTrackDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  recordingSheet: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordingSheetCenter: { flex: 1, alignItems: 'center' },
  recordingSheetTime: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  recordingSheetLabel: { fontSize: 11, marginTop: 2, fontFamily: FONT_FAMILY },
  recordingSheetBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  input: { flex: 1, fontSize: 14, fontFamily: FONT_FAMILY },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  iconBtnDisabled: {
    opacity: 0.45,
  },
  locationBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: { opacity: 0.7 },
  markerSelf: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 2,
  },
  markerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  markerTarget: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 2,
  },
  markerGuardian: {
    borderRadius: 16,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderWidth: 1,
  },
  menuCard: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: chatThemeTokens.spacing.xl,
    paddingTop: chatThemeTokens.spacing.sm,
    paddingBottom: chatThemeTokens.spacing.xl,
    borderWidth: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
    fontFamily: FONT_FAMILY,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  menuItemText: { fontSize: 14, fontWeight: '600', fontFamily: FONT_FAMILY },
  menuDanger: { marginTop: 6 },
});
