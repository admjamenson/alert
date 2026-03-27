import { getAuth } from '@react-native-firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import i18n from '../i18n';
import { NotificationService } from './NotificationService';
import { ProfileService } from './ProfileService';
import { UserIdentityService } from './UserIdentityService';
import { ensureAnonymousAuth } from './FirebaseAuthResilienceService';
import { APP_CONFIG } from '../core/config';

const USERS_COLLECTION = 'users';
const REQUESTS_COLLECTION = 'guardian_requests';
const SOS_COLLECTION = 'sos_alerts';
const CHECKIN_COLLECTION = 'checkins';

const authClient = getAuth();
const db = getFirestore();
const messagingClient = getMessaging();

type GuardianRequestDoc = {
  fromId: string;
  fromName: string;
  fromPhone?: string;
  toId: string;
  toPhone?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};

const getLocalUserId = async (): Promise<string> => {
  const current = authClient.currentUser;
  if (current?.uid) return current.uid;
  const deviceId = await UserIdentityService.getDeviceId();
  return `device_${deviceId}`;
};

const getApiBaseUrl = () => (APP_CONFIG.API_BASE_URL || '').trim();
const getFallbackSenderName = () => i18n.t('chat_sender_fallback');
const getDefaultCheckInMessage = () => i18n.t('checkin_default_message');
let guardianRequestsRealtimeDisabled = false;
let incomingSosRealtimeDisabled = false;
let guardianRequestsWarnedUnexpectedError = false;
let incomingSosWarnedUnexpectedError = false;
const NOOP_UNSUBSCRIBE = () => {};

const getErrorCode = (error: unknown): string =>
  String((error as any)?.code || '')
    .trim()
    .toLowerCase();

const getErrorMessage = (error: unknown): string =>
  String((error as any)?.message || error || '')
    .trim()
    .toLowerCase();

const isFirestorePermissionDenied = (error: unknown): boolean => {
  const code = getErrorCode(error);
  if (code.includes('permission-denied') || code.includes('permission_denied')) {
    return true;
  }
  const message = getErrorMessage(error);
  return (
    message.includes('permission-denied') ||
    message.includes('permission_denied') ||
    message.includes('does not have permission')
  );
};

const warnUnexpectedRealtimeError = (
  scope: 'requests' | 'sos',
  prefix: string,
  error: unknown,
) => {
  if (!__DEV__) return;

  if (scope === 'requests') {
    if (guardianRequestsWarnedUnexpectedError) return;
    guardianRequestsWarnedUnexpectedError = true;
  } else {
    if (incomingSosWarnedUnexpectedError) return;
    incomingSosWarnedUnexpectedError = true;
  }

  console.log(prefix, (error as any)?.message || error);
};

export const GuardianNetworkService = {
  async registerDevice(): Promise<void> {
    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return;

    const userId = await getLocalUserId();
    const profile = await ProfileService.getProfile();
    const phone = await UserIdentityService.getUserPhone();
    let token = '';
    try {
      token = await getToken(messagingClient);
    } catch {
      token = '';
    }

    const payload = {
      id: userId,
      name: profile.name || getFallbackSenderName(),
      phone: phone || null,
      fcmToken: token || null,
      platform: 'mobile',
      updatedAt: new Date().toISOString(),
    };

    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/api/register-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // ignore backend errors
      }
    }

    try {
      await setDoc(doc(collection(db, USERS_COLLECTION), userId), payload, {
        merge: true,
      });
    } catch {
      // ignore if Firestore rules block
    }
  },

  async sendGuardianRequestByPhone(phone: string): Promise<{
    status: 'ok' | 'not_found' | 'error';
    requestId?: string;
    targetId?: string;
  }> {
    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return { status: 'error' };

    const normalized = UserIdentityService.normalizePhone(phone);
    if (!normalized) return { status: 'error' };

    const me = await getLocalUserId();
    const profile = await ProfileService.getProfile();
    const myPhone = await UserIdentityService.getUserPhone();

    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/guardian/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromId: me,
            fromName: profile.name || getFallbackSenderName(),
            fromPhone: myPhone || undefined,
            toPhone: normalized,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          return {
            status: 'ok',
            requestId: json?.requestId,
            targetId: json?.targetId,
          };
        }
      } catch {
        // ignore backend errors
      }
    }

    try {
      const usersQuery = query(
        collection(db, USERS_COLLECTION),
        where('phone', '==', normalized),
        limit(1),
      );
      const usersSnapshot = await getDocs(usersQuery);

      if (usersSnapshot.empty) return { status: 'not_found' };

      const targetDoc = usersSnapshot.docs[0];
      const targetId = targetDoc.id;

      const requestRef = doc(collection(db, REQUESTS_COLLECTION));
      const payload: GuardianRequestDoc = {
        fromId: me,
        fromName: profile.name || getFallbackSenderName(),
        fromPhone: myPhone || undefined,
        toId: targetId,
        toPhone: normalized,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await setDoc(requestRef, payload);

      return { status: 'ok', requestId: requestRef.id, targetId };
    } catch {
      return { status: 'error' };
    }
  },

  listenGuardianRequests: async (): Promise<() => void> => {
    if (guardianRequestsRealtimeDisabled) return NOOP_UNSUBSCRIBE;

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return NOOP_UNSUBSCRIBE;

    const me = await getLocalUserId();
    let unsubscribe = NOOP_UNSUBSCRIBE;
    const pendingRequestsQuery = query(
      collection(db, REQUESTS_COLLECTION),
      where('toId', '==', me),
      where('status', '==', 'pending'),
    );
    unsubscribe = onSnapshot(
      pendingRequestsQuery,
      snapshot => {
        if (!snapshot || typeof snapshot.docChanges !== 'function') return;
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const data = change.doc.data() as GuardianRequestDoc;
          void NotificationService.addGuardianRequest({
            requesterName: data.fromName,
            requesterPhone: data.fromPhone,
            requesterId: data.fromId,
            requestId: change.doc.id,
          });
        });
      },
      error => {
        if (isFirestorePermissionDenied(error)) {
          guardianRequestsRealtimeDisabled = true;
          try {
            unsubscribe();
          } catch {
            // ignore
          }
          return;
        }
        warnUnexpectedRealtimeError(
          'requests',
          '[GuardianNetworkService] listenGuardianRequests error:',
          error,
        );
      },
    );

    return unsubscribe;
  },

  async respondToGuardianRequest(
    requestId: string | undefined,
    accepted: boolean,
  ): Promise<void> {
    if (!requestId) return;

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return;

    try {
      await updateDoc(doc(collection(db, REQUESTS_COLLECTION), requestId), {
        status: accepted ? 'accepted' : 'rejected',
        respondedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  },

  async sendSosToGuardians(payload: {
    location: { latitude: number; longitude: number };
    senderName?: string;
    message?: string;
    guardians: Array<{ remoteId?: string; name: string }>;
  }): Promise<void> {
    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return;

    const me = await getLocalUserId();
    const targets = payload.guardians
      .map(g => g.remoteId)
      .filter((id): id is string => Boolean(id));
    if (targets.length === 0) return;

    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/api/sos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromId: me,
            fromName: payload.senderName || getFallbackSenderName(),
            message: payload.message || '',
            location: payload.location,
            targets,
          }),
        });
      } catch {
        // ignore backend errors
      }
    }

    const now = new Date().toISOString();
    const batch = writeBatch(db);
    targets.forEach(targetId => {
      const ref = doc(collection(db, SOS_COLLECTION));
      batch.set(ref, {
        fromId: me,
        fromName: payload.senderName || getFallbackSenderName(),
        toId: targetId,
        location: payload.location,
        message: payload.message || '',
        createdAt: now,
        status: 'new',
      });
    });
    try {
      await batch.commit();
    } catch {
      // ignore
    }
  },

  async sendCheckInToGuardians(payload: {
    city?: string;
    senderName?: string;
    message?: string;
    guardians: Array<{ remoteId?: string; name: string }>;
  }): Promise<{ ok: boolean }> {
    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return { ok: false };

    const me = await getLocalUserId();
    const targets = payload.guardians
      .map(g => g.remoteId)
      .filter((id): id is string => Boolean(id));
    if (targets.length === 0) return { ok: false };

    const now = new Date().toISOString();
    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromId: me,
            fromName: payload.senderName || getFallbackSenderName(),
            message: payload.message || getDefaultCheckInMessage(),
            city: payload.city || '',
            targets,
          }),
        });
        if (res.ok) return { ok: true };
      } catch {
        // ignore backend errors
      }
    }

    // Fallback: persist to Firestore (useful for future server-side fanout).
    const batch = writeBatch(db);
    targets.forEach(targetId => {
      const ref = doc(collection(db, CHECKIN_COLLECTION));
      batch.set(ref, {
        fromId: me,
        fromName: payload.senderName || getFallbackSenderName(),
        toId: targetId,
        city: payload.city || null,
        message: payload.message || getDefaultCheckInMessage(),
        createdAt: now,
        status: 'new',
      });
    });
    try {
      await batch.commit();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  listenIncomingSos: async (onSos: (payload: any) => void): Promise<() => void> => {
    if (incomingSosRealtimeDisabled) return NOOP_UNSUBSCRIBE;

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return NOOP_UNSUBSCRIBE;

    const me = await getLocalUserId();
    let unsubscribe = NOOP_UNSUBSCRIBE;
    const incomingSosQuery = query(
      collection(db, SOS_COLLECTION),
      where('toId', '==', me),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    unsubscribe = onSnapshot(
      incomingSosQuery,
      snapshot => {
        if (!snapshot || typeof snapshot.docChanges !== 'function') return;
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const data = change.doc.data();
          onSos({ id: change.doc.id, ...data });
        });
      },
      error => {
        if (isFirestorePermissionDenied(error)) {
          incomingSosRealtimeDisabled = true;
          try {
            unsubscribe();
          } catch {
            // ignore
          }
          return;
        }
        warnUnexpectedRealtimeError(
          'sos',
          '[GuardianNetworkService] listenIncomingSos error:',
          error,
        );
      },
    );
    return unsubscribe;
  },
};
