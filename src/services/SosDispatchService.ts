import AsyncStorage from '@react-native-async-storage/async-storage';
import { KyberNetworkService, type KyberBroadcastResult } from './KyberNetworkService';
import { ProfileService } from './ProfileService';
import { GuardianNetworkService } from './GuardianNetworkService';
import { RiskReportService } from './RiskReportService';
import { ChatThreadService } from './ChatThreadService';
import { UserIdentityService } from './UserIdentityService';
import { GUARDIANS_CONVERSATION_ID } from './chat/guardiansConversation';
import i18n from '../i18n';
import { logSosDiagnostic } from '../observability/SosDiagnostics';

const LAST_LOCATION_KEY = '@Alert:LastLocation';
const GOOGLE_MAPS_QUERY_URL = 'https://www.google.com/maps/search/?api=1&query=';

type SosLocation = {
  latitude: number;
  longitude: number;
};

type GuardianTarget = {
  id?: string;
  remoteId?: string;
  phone?: string;
  name: string;
};

export type SosDispatchResult = {
  accepted: boolean;
  delivered: boolean;
  queued: boolean;
  viaKyber: boolean;
  viaGuardians: boolean;
  viaConversation: boolean;
  integrityProtected: boolean;
};

const normalizeGuardians = (
  guardians: GuardianTarget[],
): Array<{ id?: string; remoteId?: string; phone?: string; name: string }> =>
  (Array.isArray(guardians) ? guardians : [])
    .reduce<Array<{ id?: string; remoteId?: string; phone?: string; name: string }>>((acc, item) => {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      const remoteId = typeof item?.remoteId === 'string' ? item.remoteId.trim() : '';
      const phone = UserIdentityService.normalizePhone(item?.phone || '');
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name && !id && !remoteId && !phone) {
        return acc;
      }
      acc.push({
        id: id || undefined,
        remoteId: remoteId || undefined,
        phone: phone || undefined,
        name: name || i18n.t('guardian_label', { defaultValue: 'Guardian' }),
      });
      return acc;
    }, []);

const mergeSosResults = (params: {
  kyber: KyberBroadcastResult;
  guardiansDelivered: boolean;
  conversationDelivered: boolean;
}): SosDispatchResult => ({
  accepted:
    params.kyber.accepted || params.guardiansDelivered || params.conversationDelivered,
  delivered:
    params.kyber.delivered || params.guardiansDelivered || params.conversationDelivered,
  queued: params.kyber.queued,
  viaKyber: params.kyber.accepted,
  viaGuardians: params.guardiansDelivered,
  viaConversation: params.conversationDelivered,
  integrityProtected: params.kyber.integrityProtected,
});

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
  guardians: Array<{ remoteId?: string; name: string }>,
  message: string,
  location: SosLocation,
  locationName?: string,
) => {
  const guardianIds = guardians
    .map(item => item.remoteId)
    .filter((item): item is string => Boolean(item));
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
  async dispatchFromQuickAction(): Promise<SosDispatchResult> {
    const location = await loadLastLocation();
    logSosDiagnostic('dispatchFromQuickAction:start', {
      hasLocation: Boolean(location),
    });
    if (!location) {
      return {
        accepted: false,
        delivered: false,
        queued: false,
        viaKyber: false,
        viaGuardians: false,
        viaConversation: false,
        integrityProtected: false,
      };
    }

    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(location, 'quick_action');

    const profile = await ProfileService.getProfile();
    const storedContacts = await AsyncStorage.getItem('@emergency_contacts');
    const contacts = storedContacts ? JSON.parse(storedContacts) : [];

    const kyberResult = await KyberNetworkService.broadcastEmergency(
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
    logSosDiagnostic('dispatchFromQuickAction:result', {
      accepted: kyberResult.accepted || guardianResult.ok,
      kyberAccepted: kyberResult.accepted,
      kyberDelivered: kyberResult.delivered,
      kyberQueued: kyberResult.queued,
      guardianOk: guardianResult.ok,
    });

    return mergeSosResults({
      kyber: kyberResult,
      guardiansDelivered: guardianResult.ok,
      conversationDelivered: false,
    });
  },

  async dispatchFromApp(payload: {
    location: SosLocation;
    locationName?: string;
    senderName?: string;
    guardians: GuardianTarget[];
  }): Promise<SosDispatchResult> {
    const guardians = normalizeGuardians(payload.guardians);
    const deliverableGuardianCount = guardians.filter(
      item => Boolean(item.remoteId) || Boolean(item.phone) || Boolean(item.id),
    ).length;
    logSosDiagnostic('dispatchFromApp:start', {
      guardianCount: guardians.length,
      deliverableGuardianCount,
      hasLocationName: Boolean(payload.locationName),
      senderNamePresent: Boolean(String(payload.senderName || '').trim()),
    });

    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(payload.location, 'self');

    const message = buildSosMessage(payload.location, payload.locationName);
    const guardianResult = await GuardianNetworkService.sendSosToGuardians({
      location: payload.location,
      senderName: payload.senderName,
      message,
      guardians,
    });

    let kyberResult: KyberBroadcastResult = {
      accepted: false,
      delivered: false,
      queued: false,
      integrityProtected: false,
    };
    if (!guardianResult.ok) {
      logSosDiagnostic('dispatchFromApp:fallback_to_relay', {
        reason: guardianResult.reason || 'guardian_direct_unavailable',
        guardianCount: guardians.length,
        deliverableGuardianCount,
        guardianAccepted: Boolean(guardianResult.accepted),
        guardianRequestId: guardianResult.requestId || null,
        guardianJobId: guardianResult.jobId || null,
      });
      kyberResult = await KyberNetworkService.broadcastEmergency(
        payload.location,
        guardians.map(item => ({
          id: item.remoteId,
          name: item.name,
          channel: 'guardian' as const,
        })),
        payload.senderName,
      );
    } else {
      logSosDiagnostic('dispatchFromApp:guardian_direct_succeeded', {
        guardianCount: guardians.length,
        deliverableGuardianCount,
        guardianRequestId: guardianResult.requestId || null,
        guardianJobId: guardianResult.jobId || null,
      });
    }

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

    logSosDiagnostic('dispatchFromApp:result', {
      kyberAccepted: kyberResult.accepted,
      kyberDelivered: kyberResult.delivered,
      kyberQueued: kyberResult.queued,
      guardianOk: guardianResult.ok,
      guardianAccepted: Boolean(guardianResult.accepted),
      guardianRequestId: guardianResult.requestId || null,
      guardianJobId: guardianResult.jobId || null,
      conversationDelivered: conversationResult,
    });

    return mergeSosResults({
      kyber: kyberResult,
      guardiansDelivered: guardianResult.ok,
      conversationDelivered: conversationResult,
    });
  },
};
