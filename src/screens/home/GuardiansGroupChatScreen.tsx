import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapLibreGL from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLocales } from 'react-native-localize';
import { useTranslation } from 'react-i18next';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { OSM_STYLE_NORMAL } from '../../constants/MapStyles';
import {
  ChatThreadService,
  type ChatMessageItem,
  type ChatMessageMeta,
} from '../../services/ChatThreadService';
import {
  GUARDIANS_CONVERSATION_ID,
  isGuardiansConversation,
} from '../../services/chat/guardiansConversation';
import type { RootStackParamList } from '../../navigation/types';

const LAST_LOCATION_KEY = '@Alert:LastLocation';
const LAST_LOCATION_NAME_KEY = '@Alert:LastLocationName';
const GUARDIANS_PAGE_SIZE = 30;

type ChatParams = {
  conversationId?: string;
  targetLocation?: { latitude: number; longitude: number };
  lat?: number | string;
  lon?: number | string;
  user?: string;
};

type Guardian = {
  id: string;
  name: string;
  remoteId?: string;
  lastLocation?: [number, number];
  lastUpdatedAt?: string;
};
type ChatMonitorNavigation = NativeStackScreenProps<RootStackParamList, 'ChatMonitor'>['navigation'];

type GuardiansChatMessage = {
  id: string;
  sender: string;
  senderId?: string;
  text: string;
  createdAtMs: number;
  timestamp: string;
  isSelf: boolean;
  meta?: ChatMessageMeta;
};

const colorsByScheme = ThemeTokens?.colors ?? {
  light: {
    primary: '#E61C24',
    background: '#FFFFFF',
    surface: '#F5F7FA',
    card: '#FFFFFF',
    text: '#111111',
    textSecondary: '#667085',
    border: '#E6E8EC',
    alert: '#E61C24',
  },
  dark: {
    primary: '#E61C24',
    background: '#0C0F12',
    surface: '#161B20',
    card: '#11161B',
    text: '#FFFFFF',
    textSecondary: '#A7B0BA',
    border: '#232A33',
    alert: '#E61C24',
  },
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens?.typography?.families?.ios || 'System'
    : ThemeTokens?.typography?.families?.android || 'sans-serif';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readStringField = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
};

const normalizeGuardianLocation = (value: unknown): [number, number] | undefined => {
  if (!isRecord(value)) return undefined;
  const location = isRecord(value.location) ? value.location : {};
  const latitude = Number(
    value.latitude ?? value.lat ?? location.latitude ?? location.lat,
  );
  const longitude = Number(
    value.longitude ?? value.lon ?? value.lng ?? location.longitude ?? location.lon ?? location.lng,
  );
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? [longitude, latitude]
    : undefined;
};

const parseStoredGuardians = (rawGuardians: string | null, fallbackName: string): Guardian[] => {
  let parsed: unknown = [];
  try {
    parsed = rawGuardians ? JSON.parse(rawGuardians) : [];
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value): Guardian | null => {
      if (!isRecord(value)) return null;
      const id = readStringField(value, ['id', 'recordID', 'remoteId', 'phone']);
      if (!id) return null;
      const remoteId = readStringField(value, ['remoteId']);
      const lastUpdatedAt = readStringField(value, ['lastUpdatedAt', 'updatedAt']);
      return {
        id,
        name: readStringField(value, ['name', 'displayName', 'fromName']) || fallbackName,
        remoteId: remoteId || undefined,
        lastLocation: normalizeGuardianLocation(value),
        lastUpdatedAt: lastUpdatedAt || undefined,
      };
    })
    .filter((value): value is Guardian => Boolean(value));
};

const extractSharedLocation = (meta?: ChatMessageMeta) => {
  const latitude = Number(meta?.location?.latitude);
  const longitude = Number(meta?.location?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, source: meta?.location?.source }
    : null;
};

const toTimestamp = (createdAtMs: number) => new Date(createdAtMs || Date.now()).toISOString();

const mergeMessages = (prev: GuardiansChatMessage[], next: GuardiansChatMessage[]) => {
  const map = new Map<string, GuardiansChatMessage>();
  prev.forEach(item => map.set(item.id, item));
  next.forEach(item => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
};

export const GuardiansGroupChatScreen = ({
  navigation,
  params,
}: {
  navigation: ChatMonitorNavigation;
  params: ChatParams;
}) => {
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const systemColorScheme = useColorScheme();
  const colors = systemColorScheme === 'dark' ? colorsByScheme.dark : colorsByScheme.light;
  const localeTag = getLocales()?.[0]?.languageTag || 'pt-BR';
  const mapHeight = Math.round(Math.max(220, Math.min(360, windowHeight * 0.33)));
  const conversationId =
    params.conversationId && isGuardiansConversation(params.conversationId)
      ? params.conversationId
      : GUARDIANS_CONVERSATION_ID;
  const deepLinkTarget =
    params.lat !== undefined && params.lon !== undefined
      ? { latitude: Number(params.lat), longitude: Number(params.lon) }
      : null;

  const [messages, setMessages] = useState<GuardiansChatMessage[]>([]);
  const [participants, setParticipants] = useState<Guardian[]>([]);
  const [chatUser, setChatUser] = useState<{ id: string; name: string } | null>(null);
  const [input, setInput] = useState('');
  const [shareLocation, setShareLocation] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentLocationName, setCurrentLocationName] = useState('');
  const [loading, setLoading] = useState(true);

  const toMessage = useCallback(
    (item: ChatMessageItem, currentUserId?: string): GuardiansChatMessage => ({
      id: item.id,
      sender: item.senderName || t('chat_sender_fallback'),
      senderId: item.senderId,
      text: item.deletedAtMs && !item.text ? t('chat_deleted') : item.text || '',
      createdAtMs: Number(item.createdAtMs || Date.now()),
      timestamp: toTimestamp(Number(item.createdAtMs || Date.now())),
      isSelf: Boolean(currentUserId) && item.senderId === currentUserId,
      meta: item.meta,
    }),
    [t],
  );

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const [rawLocation, rawLocationName, rawGuardians, me] = await Promise.all([
          AsyncStorage.getItem(LAST_LOCATION_KEY),
          AsyncStorage.getItem(LAST_LOCATION_NAME_KEY),
          AsyncStorage.getItem('@guardians_list'),
          ChatThreadService.getCurrentChatUser(),
        ]);
        if (!active) return;
        setChatUser(me);
        if (!me || !me.id) {
          setLoading(false);
          return;
        }

        const parsedLocation = rawLocation ? JSON.parse(rawLocation) : null;
        const latitude = Number(parsedLocation?.latitude);
        const longitude = Number(parsedLocation?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setCurrentLocation({ latitude, longitude });
        }
        if (typeof rawLocationName === 'string' && rawLocationName.trim()) {
          setCurrentLocationName(rawLocationName.trim());
        }
        const guardians = parseStoredGuardians(rawGuardians, t('chat_sender_fallback'));
        setParticipants(guardians);
        const members = Array.from(
          new Set([
            me.id,
            ...guardians
              .map(item => (typeof item.remoteId === 'string' ? item.remoteId.trim() : ''))
              .filter(Boolean),
          ]),
        );
        await ChatThreadService.ensureGuardiansConversation(me.id).catch(() => undefined);
        await ChatThreadService.ensureConversation({
          conversationId,
          title: t('guardians_conversation_title'),
          type: 'group',
          members,
        }).catch(() => undefined);
        const cached = ChatThreadService.getCachedMessages(conversationId, GUARDIANS_PAGE_SIZE).map(item =>
          toMessage(item, me.id),
        );
        if (!active) return;
        setMessages(cached);
        setLoading(false);
        return ChatThreadService.listenLatestMessages(
          conversationId,
          incoming => {
            if (!active) return;
            setMessages(prev => mergeMessages(prev, incoming.map(item => toMessage(item, me.id))));
            setLoading(false);
          },
          () => {
            if (!active) return;
            setLoading(false);
          },
          GUARDIANS_PAGE_SIZE,
        );
      } catch {
        if (!active) return;
        setLoading(false);
      }
    };

    let unsubscribe: (() => void) | undefined;
    void boot().then(value => {
      if (typeof value === 'function') unsubscribe = value;
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [conversationId, t, toMessage]);

  const requesterLocation = useMemo(() => {
    if (params.targetLocation) return params.targetLocation;
    if (deepLinkTarget) return deepLinkTarget;
    for (const item of messages) {
      if (item.isSelf) continue;
      const shared = extractSharedLocation(item.meta);
      if (shared?.source === 'sos') return { latitude: shared.latitude, longitude: shared.longitude };
    }
    return null;
  }, [deepLinkTarget, messages, params.targetLocation]);

  const guardianMarkers = useMemo(() => {
    const markers = new Map<string, { id: string; name: string; coordinate: [number, number]; shared: boolean }>();
    participants.forEach(item => {
      const key = item.remoteId || item.id;
      if (!key || !item.lastLocation || key === chatUser?.id) return;
      markers.set(key, { id: `guardian-${key}`, name: item.name, coordinate: item.lastLocation, shared: false });
    });
    messages.forEach(item => {
      if (item.isSelf) return;
      const shared = extractSharedLocation(item.meta);
      const key = String(item.senderId || item.id).trim();
      if (!shared || !key || key === chatUser?.id) return;
      markers.set(key, {
        id: `guardian-shared-${key}`,
        name: item.sender,
        coordinate: [shared.longitude, shared.latitude],
        shared: true,
      });
    });
    return Array.from(markers.values());
  }, [chatUser?.id, messages, participants]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (requesterLocation) return [requesterLocation.longitude, requesterLocation.latitude];
    if (currentLocation) return [currentLocation.longitude, currentLocation.latitude];
    if (guardianMarkers[0]) return guardianMarkers[0].coordinate;
    return [-38.5267, -3.7319];
  }, [currentLocation, guardianMarkers, requesterLocation]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    try {
      const me = chatUser || (await ChatThreadService.getCurrentChatUser());
      if (!chatUser) setChatUser(me);
      const members = Array.from(
        new Set([
          me.id,
          ...participants.map(item => (typeof item.remoteId === 'string' ? item.remoteId.trim() : '')).filter(Boolean),
        ]),
      );
      await ChatThreadService.sendMessage({
        conversationId,
        type: 'text',
        text,
        meta:
          shareLocation && currentLocation
            ? {
                location: {
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                  label: currentLocationName.trim() || undefined,
                  source: 'guardians_chat',
                  sharedAt: new Date().toISOString(),
                },
              }
            : undefined,
        conversation: {
          title: t('guardians_conversation_title'),
          type: 'group',
          members,
        },
      });
    } catch {
      setInput(text);
      Alert.alert(t('guardians_conversation_title'), t('chat_send_failed'));
    }
  }, [chatUser, conversationId, currentLocation, currentLocationName, input, participants, shareLocation, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Icon name="chevron-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>{t('guardians_conversation_title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('guardians_conversation_member_count', { count: participants.length })}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShareLocation(value => !value)}
          style={[
            styles.locationBtn,
            {
              backgroundColor: shareLocation ? colors.primary : colors.surface,
              borderColor: shareLocation ? colors.primary : colors.border,
            },
          ]}
        >
          <Icon
            name={shareLocation ? 'map-marker-check-outline' : 'map-marker-off-outline'}
            size={16}
            color={shareLocation ? '#FFFFFF' : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.mapShell,
          {
            height: mapHeight,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('guardians_map_accessibility_label', {
          defaultValue: 'Mapa dos guardiões e da sua localização compartilhada',
        })}
      >
        <MapLibreGL.MapView style={styles.map} mapStyle={OSM_STYLE_NORMAL} rotateEnabled={false} pitchEnabled={false} logoEnabled={false} attributionEnabled compassEnabled={false}>
          <MapLibreGL.Camera centerCoordinate={mapCenter} zoomLevel={14} animationMode="easeTo" animationDuration={0} />
          {currentLocation ? (
            <MapLibreGL.PointAnnotation id="guardian-self" coordinate={[currentLocation.longitude, currentLocation.latitude]}>
              <View style={[styles.selfMarker, { borderColor: colors.primary }]}>
                <Icon name="account-circle" size={18} color={colors.primary} />
              </View>
            </MapLibreGL.PointAnnotation>
          ) : null}
          {requesterLocation ? (
            <MapLibreGL.PointAnnotation id="guardian-requester" coordinate={[requesterLocation.longitude, requesterLocation.latitude]}>
              <View style={[styles.requesterMarker, { backgroundColor: colors.alert }]}>
                <Icon name="alert-decagram" size={16} color="#FFFFFF" />
              </View>
            </MapLibreGL.PointAnnotation>
          ) : null}
          {guardianMarkers.map(item => (
            <MapLibreGL.PointAnnotation key={item.id} id={item.id} coordinate={item.coordinate}>
              <View
                style={[
                  styles.guardianMarker,
                  item.shared
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Icon name="shield-account" size={14} color={item.shared ? '#FFFFFF' : colors.primary} />
              </View>
            </MapLibreGL.PointAnnotation>
          ))}
        </MapLibreGL.MapView>
        <View style={styles.overlayRow}>
          <View style={[styles.overlayChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="alert-decagram" size={14} color={colors.alert} />
            <Text style={[styles.overlayText, { color: colors.text }]} numberOfLines={1}>
              {params.user ? decodeURIComponent(params.user) : t('guardians_conversation_stub_preview')}
            </Text>
          </View>
          <View style={[styles.overlayChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="shield-account" size={14} color={colors.primary} />
            <Text style={[styles.overlayText, { color: colors.text }]} numberOfLines={1}>
              {`${guardianMarkers.length}`}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.membersRow, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.membersContent}>
          {participants.length === 0 ? (
            <View style={[styles.memberChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Icon name="shield-account-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.memberText, { color: colors.textSecondary }]}>{t('chat_no_guardians')}</Text>
            </View>
          ) : (
            participants.map(item => {
              const hasLocation = guardianMarkers.some(marker => marker.id.includes(item.remoteId || item.id));
              return (
                <View key={item.id} style={[styles.memberChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Icon name={hasLocation ? 'map-marker-check-outline' : 'shield-account'} size={14} color={hasLocation ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.memberText, { color: colors.text }]}>{item.name}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>

      <KeyboardAvoidingView style={styles.chatWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{t('chat_map_loading')}</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.isSelf ? styles.bubbleSelf : styles.bubbleOther,
                  {
                    backgroundColor: item.isSelf ? colors.primary : colors.card,
                    borderColor: item.isSelf ? colors.primary : colors.border,
                  },
                ]}
              >
                {!item.isSelf ? <Text style={[styles.sender, { color: colors.text }]}>{item.sender}</Text> : null}
                <Text style={[styles.message, { color: item.isSelf ? '#FFFFFF' : colors.text }]}>{item.text}</Text>
                {extractSharedLocation(item.meta) ? (
                  <View style={styles.metaRow}>
                    <Icon name="map-marker" size={12} color={item.isSelf ? '#FDECEC' : colors.primary} />
                    <Text style={[styles.metaText, { color: item.isSelf ? '#FDECEC' : colors.textSecondary }]}>
                      {item.meta?.location?.label || t('chat_share_location')}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.time, { color: item.isSelf ? '#FDECEC' : colors.textSecondary }]}>
                  {new Date(item.timestamp).toLocaleTimeString(localeTag)}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {t('guardians_conversation_stub_preview')}
                </Text>
              </View>
            }
          />
        )}

        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <View style={[styles.inputShell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('chat_add_text_placeholder')}
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text }]}
              accessibilityLabel={t('chat_add_text_placeholder')}
              multiline
            />
          </View>
          <TouchableOpacity
            onPress={() => void handleSend()}
            disabled={input.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('chat_send_message')}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim().length === 0 ? colors.border : colors.primary },
            ]}
          >
            <Icon name="send" size={18} color={input.trim().length === 0 ? colors.textSecondary : '#FFFFFF'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontFamily: FONT_FAMILY, fontSize: 20, fontWeight: '800' },
  subtitle: { fontFamily: FONT_FAMILY, fontSize: 12, marginTop: 2 },
  locationBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mapShell: { height: 240, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  map: { flex: 1 },
  selfMarker: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  requesterMarker: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  guardianMarker: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  overlayRow: { position: 'absolute', left: 14, right: 14, bottom: 12, flexDirection: 'row', gap: 8 },
  overlayChip: { flex: 1, minHeight: 38, borderRadius: 19, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  overlayText: { fontFamily: FONT_FAMILY, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  membersRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  membersContent: { paddingHorizontal: 18 },
  memberChip: { minHeight: 38, borderRadius: 19, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 10 },
  memberText: { fontFamily: FONT_FAMILY, fontSize: 13, fontWeight: '700' },
  chatWrap: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingText: { fontFamily: FONT_FAMILY, fontSize: 14, textAlign: 'center' },
  listContent: { paddingHorizontal: 18, paddingVertical: 16 },
  bubble: { maxWidth: '84%', borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  bubbleSelf: { alignSelf: 'flex-end', borderBottomRightRadius: 8 },
  bubbleOther: { alignSelf: 'flex-start', borderBottomLeftRadius: 8 },
  sender: { fontFamily: FONT_FAMILY, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  message: { fontFamily: FONT_FAMILY, fontSize: 15, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: { fontFamily: FONT_FAMILY, fontSize: 11, fontWeight: '600' },
  time: { fontFamily: FONT_FAMILY, fontSize: 10, marginTop: 8, textAlign: 'right' },
  emptyWrap: { paddingTop: 24, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: FONT_FAMILY, fontSize: 14, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  inputShell: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, minHeight: 48 },
  input: { fontFamily: FONT_FAMILY, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
