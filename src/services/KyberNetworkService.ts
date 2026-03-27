import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import { AlertRelayService } from './AlertRelayService';
import { appendQueueItem } from './starlink/starlinkUtils';

/**
 * KYBER NETWORK SERVICE - Emergency Broadcast Protocol
 *
 * Uses store-and-forward queue for high-priority SOS payloads.
 * Queue is flushed when connectivity returns and on app bootstrap.
 */

const QUEUE_KEY = '@Alert:EmergencyQueue';
const MAX_QUEUE = 40;

type EmergencyPayload = {
  id: string;
  location: any;
  contacts: any[];
  userName?: string;
  createdAt: string;
  priority: 'high';
};

let networkSubscription: NetInfoSubscription | null = null;

const buildPayload = (
  location: any,
  contacts: any[],
  userName?: string,
): EmergencyPayload => ({
  id: `sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  location,
  contacts,
  userName,
  createdAt: new Date().toISOString(),
  priority: 'high',
});

const loadQueue = async (): Promise<EmergencyPayload[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as EmergencyPayload[]) : [];
  } catch {
    return [];
  }
};

const saveQueue = async (items: EmergencyPayload[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Avoid blocking emergency flow if storage fails.
  }
};

const enqueue = async (payload: EmergencyPayload): Promise<void> => {
  const queue = await loadQueue();
  const next = appendQueueItem(queue, payload, MAX_QUEUE);
  await saveQueue(next);
};

const sendToServer = async (payload: EmergencyPayload): Promise<boolean> => {
  const result = await AlertRelayService.sendSos({
    id: payload.id,
    location: payload.location,
    contacts: payload.contacts,
    userName: payload.userName,
    createdAt: payload.createdAt,
    priority: payload.priority,
  });
  return result.ok;
};

export const KyberNetworkService = {
  async broadcastEmergency(
    location: any,
    contacts: any[],
    userName?: string,
  ): Promise<boolean> {
    try {
      const payload = buildPayload(location, contacts, userName);
      const ok = await sendToServer(payload);
      if (!ok) {
        await enqueue(payload);
      }
      return ok;
    } catch (error) {
      await enqueue(buildPayload(location, contacts, userName));
      if (__DEV__) {
        console.warn('[Kyber] Falha no broadcast, fila ativada.', error);
      }
      return false;
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
};
