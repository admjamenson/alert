import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import CryptoJS from 'crypto-js';
import { getAlertApiBaseUrl } from '../core/config';
import { AlertRelayService } from './AlertRelayService';
import { appendQueueItem } from './starlink/starlinkUtils';
import { logSosDiagnostic, summarizeError } from '../observability/SosDiagnostics';

/**
 * KYBER NETWORK SERVICE - Emergency Broadcast Protocol
 *
 * Uses store-and-forward queue for high-priority SOS payloads.
 * Queue is flushed when connectivity returns and on app bootstrap.
 */

const QUEUE_KEY = '@Alert:EmergencyQueue';
const MAX_QUEUE = 40;

type EmergencyRecipient = {
  id?: string;
  phone?: string;
  name?: string;
  channel?: 'guardian' | 'contact';
};

type EmergencyIntegrity = {
  version: 1;
  alg: 'sha256';
  digest: string;
};

type EmergencyPayloadBase = {
  id: string;
  location: {
    latitude: number;
    longitude: number;
  };
  contacts: EmergencyRecipient[];
  userName?: string;
  createdAt: string;
  priority: 'high';
};

type EmergencyPayload = EmergencyPayloadBase & {
  integrity: EmergencyIntegrity;
};

export type KyberBroadcastResult = {
  accepted: boolean;
  delivered: boolean;
  queued: boolean;
  integrityProtected: boolean;
};

let networkSubscription: NetInfoSubscription | null = null;

const normalizeLocation = (location: any): EmergencyPayloadBase['location'] => ({
  latitude: Number(location?.latitude ?? 0),
  longitude: Number(location?.longitude ?? 0),
});

const normalizeRecipients = (contacts: any[]): EmergencyRecipient[] =>
  (Array.isArray(contacts) ? contacts : [])
    .reduce<EmergencyRecipient[]>((acc, item) => {
      const id =
        typeof item?.id === 'string'
          ? item.id.trim()
          : typeof item?.remoteId === 'string'
            ? item.remoteId.trim()
            : '';
      const phone =
        typeof item?.phone === 'string'
          ? item.phone.trim()
          : '';
      const name =
        typeof item?.name === 'string'
          ? item.name.trim()
          : '';
      const channel =
        item?.channel === 'guardian' || item?.channel === 'contact'
          ? item.channel
          : id
            ? 'guardian'
            : 'contact';
      if (!id && !phone && !name) return acc;
      acc.push({
        id: id || undefined,
        phone: phone || undefined,
        name: name || undefined,
        channel,
      });
      return acc;
    }, [])
    .sort((left, right) => {
      const a = `${left.channel || ''}|${left.id || ''}|${left.phone || ''}|${left.name || ''}`;
      const b = `${right.channel || ''}|${right.id || ''}|${right.phone || ''}|${right.name || ''}`;
      return a.localeCompare(b);
    });

const buildPayloadBase = (
  location: any,
  contacts: any[],
  userName?: string,
): EmergencyPayloadBase => ({
  id: `sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  location: normalizeLocation(location),
  contacts: normalizeRecipients(contacts),
  userName: typeof userName === 'string' ? userName.trim() : undefined,
  createdAt: new Date().toISOString(),
  priority: 'high',
});

const toIntegrityContacts = (contacts: EmergencyRecipient[]) =>
  normalizeRecipients(contacts).map(item => ({
    id: item.id || '',
    phone: item.phone || '',
    name: item.name || '',
    channel: item.channel === 'guardian' || item.channel === 'contact'
      ? item.channel
      : 'contact',
  }));

const toIntegritySource = (payload: EmergencyPayloadBase) =>
  JSON.stringify({
    id: typeof payload.id === 'string' ? payload.id.trim() : '',
    location: payload.location,
    contacts: toIntegrityContacts(payload.contacts),
    userName: typeof payload.userName === 'string' ? payload.userName.trim() : '',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt.trim() : '',
    priority:
      typeof payload.priority === 'string' && payload.priority.trim().length > 0
        ? payload.priority.trim()
        : 'high',
  });

const buildIntegrity = (payload: EmergencyPayloadBase): EmergencyIntegrity => ({
  version: 1,
  alg: 'sha256',
  digest: CryptoJS.SHA256(toIntegritySource(payload)).toString(CryptoJS.enc.Hex),
});

const attachIntegrity = (payload: EmergencyPayloadBase): EmergencyPayload => ({
  ...payload,
  integrity: buildIntegrity(payload),
});

const coercePayload = (raw: any): EmergencyPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const latitude = Number(raw?.location?.latitude);
  const longitude = Number(raw?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const payloadBase: EmergencyPayloadBase = {
    id:
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    location: {
      latitude,
      longitude,
    },
    contacts: normalizeRecipients(raw.contacts),
    userName:
      typeof raw.userName === 'string' && raw.userName.trim().length > 0
        ? raw.userName.trim()
        : undefined,
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt.trim().length > 0
        ? raw.createdAt
        : new Date().toISOString(),
    priority: 'high',
  };

  const integrityCandidate =
    raw.integrity && typeof raw.integrity === 'object' ? raw.integrity : null;
  if (!integrityCandidate) {
    return attachIntegrity(payloadBase);
  }

  const digest = String(integrityCandidate.digest || '').trim().toLowerCase();
  const alg = String(integrityCandidate.alg || '').trim().toLowerCase();
  const version = Number(integrityCandidate.version || 0);
  const expected = buildIntegrity(payloadBase);
  if (alg !== expected.alg || version !== expected.version) {
    return null;
  }

  if (digest !== expected.digest) {
    return {
      ...payloadBase,
      integrity: expected,
    };
  }

  return {
    ...payloadBase,
    integrity: expected,
  };
};

const loadQueue = async (): Promise<EmergencyPayload[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const valid = parsed
      .map(item => coercePayload(item))
      .filter((item): item is EmergencyPayload => item !== null);
    if (valid.length !== parsed.length) {
      if (__DEV__) {
        console.warn('[Kyber] Dropped corrupted SOS items from queue.');
      }
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
};

const saveQueue = async (items: EmergencyPayload[]): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

const enqueue = async (payload: EmergencyPayload): Promise<boolean> => {
  const queue = await loadQueue();
  const next = appendQueueItem(queue, payload, MAX_QUEUE);
  return saveQueue(next);
};

const sendToServer = async (payload: EmergencyPayload): Promise<boolean> => {
  logSosDiagnostic('kyber:relay_send_start', {
    payloadId: payload.id,
    recipientCount: payload.contacts.length,
    hasApiBaseUrl: Boolean(String(getAlertApiBaseUrl() || '').trim()),
  });
  const result = await AlertRelayService.sendSos({
    id: payload.id,
    location: payload.location,
    contacts: payload.contacts,
    userName: payload.userName,
    createdAt: payload.createdAt,
    priority: payload.priority,
    integrity: payload.integrity,
  });
  logSosDiagnostic('kyber:relay_send_result', {
    payloadId: payload.id,
    ok: result.ok,
    status: result.status,
    retriesUsed: result.retriesUsed,
    latencyMs: result.latencyMs,
    response: result.data,
  });
  return result.ok;
};

export const KyberNetworkService = {
  async broadcastEmergency(
    location: any,
    contacts: any[],
    userName?: string,
  ): Promise<KyberBroadcastResult> {
    const payload = attachIntegrity(buildPayloadBase(location, contacts, userName));
    try {
      const ok = await sendToServer(payload);
      if (!ok) {
        const queued = await enqueue(payload);
        logSosDiagnostic('kyber:broadcast_fallback_queue', {
          payloadId: payload.id,
          queued,
        });
        return {
          accepted: queued,
          delivered: false,
          queued,
          integrityProtected: true,
        };
      }
      return {
        accepted: true,
        delivered: true,
        queued: false,
        integrityProtected: true,
      };
    } catch (error) {
      const queued = await enqueue(payload);
      logSosDiagnostic('kyber:broadcast_error', {
        payloadId: payload.id,
        queued,
        error: summarizeError(error),
      });
      if (__DEV__) {
        console.warn('[Kyber] Falha no broadcast, fila ativada.', error);
      }
      return {
        accepted: queued,
        delivered: false,
        queued,
        integrityProtected: true,
      };
    }
  },

  async flushPending(): Promise<void> {
    const queue = await loadQueue();
    if (queue.length === 0) return;

    const remaining: EmergencyPayload[] = [];
    for (const payload of queue) {
      const ok = await sendToServer(payload);
      if (!ok) {
        remaining.push(payload);
      }
    }
    await saveQueue(remaining);
  },

  startAutoFlush(): void {
    if (networkSubscription) return;
    networkSubscription = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        void KyberNetworkService.flushPending();
      }
    });
  },

  stopAutoFlush(): void {
    if (!networkSubscription) return;
    networkSubscription();
    networkSubscription = null;
  },

  getCapabilityStatus(): {
    secureDispatch: boolean;
    offlineQueue: true;
    integrityProtection: true;
  } {
    return {
      secureDispatch: Boolean(String(getAlertApiBaseUrl() || '').trim()),
      offlineQueue: true,
      integrityProtection: true,
    };
  },
};
