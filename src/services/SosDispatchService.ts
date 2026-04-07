import AsyncStorage from '@react-native-async-storage/async-storage';
import { KyberNetworkService } from './KyberNetworkService';
import { ProfileService } from './ProfileService';
import { GuardianNetworkService } from './GuardianNetworkService';
import { RiskReportService } from './RiskReportService';
import { ChatThreadService } from './ChatThreadService';
import { GUARDIANS_CONVERSATION_ID } from './chat/guardiansConversation';
import i18n from '../i18n';

const LAST_LOCATION_KEY = '@Alert:LastLocation';
const GOOGLE_MAPS_QUERY_URL = 'https://www.google.com/maps/search/?api=1&query=';

type SosLocation = {
  latitude: number;
  longitude: number;
};

type GuardianTarget = {
  remoteId?: string;
  name: string;
};

const normalizeGuardians = (guardians: GuardianTarget[]): Array<{ remoteId: string; name: string }> =>
  (Array.isArray(guardians) ? guardians : [])
    .map(item => {
      const remoteId = typeof item?.remoteId === 'string' ? item.remoteId.trim() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!remoteId) return null;
      return {
        remoteId,
        name: name || i18n.t('guardian_label', { defaultValue: 'Guardian' }),
      };
    })
    .filter((item): item is { remoteId: string; name: string } => item !== null);

const formatCoordinate = (value: number) => Number(value).toFixed(5);

const buildSosLocationLabel = (location: SosLocation, locationName?: string) => {
  const normalizedLocationName = typeof locationName === 'string' ? locationName.trim() : '';
  const coordinates = `${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}`;
  return normalizedLocationName ? `${normalizedLocationName} (${coordinates})` : coordinates;
};

const buildSosMessage = (location: SosLocation, locationName?: string) => {
  const locationLabel = buildSosLocationLabel(location, locationName);
  const mapUrl = `${GOOGLE_MAPS_QUERY_URL}${encodeURIComponent(
    `${location.latitude},${location.longitude}`,
  )}`;
  return i18n.t('sos_in_app_message_body', {
    defaultValue: 'SOS active. My location: {{location}}. Open map: {{mapUrl}}',
    location: locationLabel,
    mapUrl,
  });
};

const sendGuardiansConversationMessage = async (
  guardians: Array<{ remoteId: string; name: string }>,
  message: string,
  location: SosLocation,
  locationName?: string,
) => {
  const guardianIds = guardians.map(item => item.remoteId).filter(Boolean);
  if (guardianIds.length === 0) return false;

  const me = await ChatThreadService.getCurrentChatUser();
  const members = Array.from(new Set([me.id, ...guardianIds]));
  await ChatThreadService.sendMessage({
    conversationId: GUARDIANS_CONVERSATION_ID,
    type: 'text',
    text: message,
    meta: {
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        label:
          typeof locationName === 'string' && locationName.trim().length > 0
            ? locationName.trim()
            : undefined,
        source: 'sos',
        sharedAt: new Date().toISOString(),
      },
    },
    conversation: {
      title: i18n.t('guardians_conversation_title'),
      type: 'group',
      members,
    },
  });
  return true;
};

const loadLastLocation = async (): Promise<{
  latitude: number;
  longitude: number;
} | null> => {
  try {
    const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.latitude === 'number' &&
      typeof parsed?.longitude === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const SosDispatchService = {
  async dispatchFromQuickAction(): Promise<boolean> {
    const location = await loadLastLocation();
    if (!location) return false;

    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(location, 'quick_action');

    const profile = await ProfileService.getProfile();
    const storedContacts = await AsyncStorage.getItem('@emergency_contacts');
    const contacts = storedContacts ? JSON.parse(storedContacts) : [];

    const ok = await KyberNetworkService.broadcastEmergency(
      location,
      contacts,
      profile.name,
    );

    const guardiansRaw = await AsyncStorage.getItem('@guardians_list');
    const guardians = guardiansRaw ? JSON.parse(guardiansRaw) : [];
    const guardianResult = await GuardianNetworkService.sendSosToGuardians({
      location,
      senderName: profile.name,
      guardians,
    });

    return ok || guardianResult.ok;
  },

  async dispatchFromApp(payload: {
    location: SosLocation;
    locationName?: string;
    senderName?: string;
    guardians: GuardianTarget[];
  }): Promise<boolean> {
    const guardians = normalizeGuardians(payload.guardians);
    if (guardians.length === 0) return false;

    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(payload.location, 'self');

    const message = buildSosMessage(payload.location, payload.locationName);
    const guardianResult = await GuardianNetworkService.sendSosToGuardians({
      location: payload.location,
      senderName: payload.senderName,
      message,
      guardians,
    });

    let conversationResult = false;
    try {
      conversationResult = await sendGuardiansConversationMessage(
        guardians,
        message,
        payload.location,
        payload.locationName,
      );
    } catch {
      conversationResult = false;
    }

    return guardianResult.ok || conversationResult;
  },
};
