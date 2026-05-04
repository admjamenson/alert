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
import {
  ensureAnonymousAuth,
  getAnonymousAuthStatus,
} from './FirebaseAuthResilienceService';
import { getAlertApiBaseUrl } from '../core/config';
import {
  logSosDiagnostic,
  summarizeError,
  summarizeResponseBody,
  summarizeUrl,
} from '../observability/SosDiagnostics';

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

type GuardianSosResult = {
  ok: boolean;
  accepted?: boolean;
  delivered?: boolean;
  requestId?: string;
  jobId?: string;
  reason?: string;
};

const getLocalUserId = async (): Promise<string> => {
  const current = authClient.currentUser;
  if (current?.uid) return current.uid;
  const deviceId = await UserIdentityService.getDeviceId();
  return `device_${deviceId}`;
};

const normalizeGuardianPhone = (phone?: string | null): string =>
  UserIdentityService.normalizePhone(phone || '');

const looksLikePhoneNumber = (value: string): boolean =>
  /^[\d+\-\s()]+$/.test(value) && value.replace(/\D/g, '').length >= 7;

const normalizeLegacyGuardianTargetId = (value?: string | null): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return '';
  if (looksLikePhoneNumber(raw)) return '';
  return raw;
};

const getApiBaseUrl = () => getAlertApiBaseUrl();
const getFallbackSenderName = () => i18n.t('chat_sender_fallback');
const getDefaultCheckInMessage = () => i18n.t('checkin_default_message');
const buildGuardianSosRequestId = () =>
  `guardian-sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return;

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

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) return { status: 'error' };

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
    guardians: Array<{ id?: string; remoteId?: string; name: string; phone?: string }>;
  }): Promise<GuardianSosResult> {
    const me = await getLocalUserId();
    const authState = getAnonymousAuthStatus();
    const requestId = buildGuardianSosRequestId();
    const targets = payload.guardians
      .map(g => g.remoteId || normalizeLegacyGuardianTargetId(g.id))
      .filter((id): id is string => Boolean(id));
    const targetPhones = Array.from(
      new Set(
        payload.guardians
          .map(g => normalizeGuardianPhone(g.phone))
          .filter((phone): phone is string => Boolean(phone)),
      ),
    );

    logSosDiagnostic('guardian_sos:auth_state', {
      anonymousAuthEnabled: authState.enabled,
      hasCurrentUser: authState.hasCurrentUser,
      hasCurrentUserId: authState.hasCurrentUserId,
      blockedForSession: authState.blockedForSession,
      targetCount: targets.length,
      targetPhoneCount: targetPhones.length,
    });

    if (targets.length === 0 && targetPhones.length === 0) {
      logSosDiagnostic('guardian_sos:blocked', {
        requestId,
        reason: 'no_guardian_targets',
      });
      return { ok: false, reason: 'no_guardian_targets', requestId };
    }

    const baseUrl = getApiBaseUrl();
    if (baseUrl) {
      try {
        const requestUrl = `${baseUrl}/api/sos`;
        logSosDiagnostic('guardian_sos:request_start', {
          requestId,
          method: 'POST',
          url: summarizeUrl(requestUrl),
          targetCount: targets.length,
          targetPhoneCount: targetPhones.length,
        });
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Alert-Request-Id': requestId,
          },
          body: JSON.stringify({
            fromId: me,
            fromName: payload.senderName || getFallbackSenderName(),
            message: payload.message || '',
            location: payload.location,
            targets,
            targetPhones,
          }),
        });
        const json = await response.json().catch(() => null);
        const responseRequestId =
          String(
            response.headers.get('x-alert-request-id') ||
              json?.requestId ||
              requestId,
          ).trim() || requestId;
        const fanout = json?.fanout && typeof json.fanout === 'object' ? json.fanout : {};
        const tokenCount = Number(fanout?.tokenCount || 0);
        const delivered =
          Boolean(fanout?.queued) ||
          Boolean(fanout?.sentInline) ||
          Boolean(fanout?.deduped) ||
          tokenCount > 0;
        const jobId =
          typeof fanout?.jobId === 'string' && fanout.jobId.trim().length > 0
            ? fanout.jobId.trim()
            : undefined;
        logSosDiagnostic('guardian_sos:response', {
          requestId: responseRequestId,
          method: 'POST',
          url: summarizeUrl(requestUrl),
          status: response.status,
          ok: response.ok,
          body: summarizeResponseBody(json),
        });
        if (response.ok && delivered) {
          return {
            ok: true,
            accepted: true,
            delivered: true,
            requestId: responseRequestId,
            jobId,
          };
        }
        if (response.ok) {
          logSosDiagnostic('guardian_sos:accepted_without_fanout', {
            requestId: responseRequestId,
            jobId: jobId || null,
            tokenCount,
            queued: Boolean(fanout?.queued),
            sentInline: Boolean(fanout?.sentInline),
            deduped: Boolean(fanout?.deduped),
          });
          return {
            ok: false,
            accepted: true,
            delivered: false,
            requestId: responseRequestId,
            jobId,
            reason: 'backend_accepted_without_fanout',
          };
        }
      } catch (error) {
        logSosDiagnostic('guardian_sos:error', {
          requestId,
          method: 'POST',
          url: summarizeUrl(`${baseUrl}/api/sos`),
          error: summarizeError(error),
        });
      }
    } else {
      logSosDiagnostic('guardian_sos:blocked', {
        requestId,
        reason: 'missing_base_url',
      });
    }

    const authenticated = await ensureAnonymousAuth();
    if (!authenticated) {
      logSosDiagnostic('guardian_sos:blocked', {
        requestId,
        reason: 'anonymous_auth_unavailable_for_firestore_fallback',
      });
      return {
        ok: false,
        accepted: false,
        delivered: false,
        requestId,
        reason: 'anonymous_auth_unavailable_for_firestore_fallback',
      };
    }

    if (targets.length === 0) {
      logSosDiagnostic('guardian_sos:blocked', {
        requestId,
        reason: 'missing_firestore_targets',
      });
      return {
        ok: false,
        accepted: false,
        delivered: false,
        requestId,
        reason: 'missing_firestore_targets',
      };
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
      logSosDiagnostic('guardian_sos:firestore_fallback_written', {
        requestId,
        targetCount: targets.length,
      });
      return {
        ok: false,
        accepted: true,
        delivered: false,
        requestId,
        reason: 'firestore_fallback_only',
      };
    } catch {
      return {
        ok: false,
        accepted: false,
        delivered: false,
        requestId,
        reason: 'firestore_fallback_failed',
      };
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
