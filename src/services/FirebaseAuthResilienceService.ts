import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { APP_CONFIG } from '../core/config';

const authClient = getAuth();

let authEnsureInFlight: Promise<boolean> | null = null;
let authLastAttemptMs = 0;
let authBlockedUntilMs = 0;
let authAnonymousUnavailableForSession = false;

const AUTH_RETRY_COOLDOWN_MS = 60_000;
const AUTH_TOO_MANY_REQUESTS_BACKOFF_MS = 10 * 60_000;
const AUTH_ANONYMOUS_DISABLED_BACKOFF_MS = 24 * 60 * 60_000;

const getErrorCode = (error: unknown): string =>
  String((error as any)?.code || '')
    .trim()
    .toLowerCase();

const getErrorMessage = (error: unknown): string =>
  String((error as any)?.message || error || '')
    .trim()
    .toLowerCase();

const isTooManyRequestsError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  if (code.includes('too-many-requests') || code.includes('too_many_requests')) {
    return true;
  }
  return getErrorMessage(error).includes('too many requests');
};

const isAnonymousAuthUnavailableError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  if (
    code.includes('operation-not-allowed') ||
    code.includes('operation_not_allowed') ||
    code.includes('admin-restricted-operation') ||
    code.includes('admin_restricted_operation')
  ) {
    return true;
  }

  const message = getErrorMessage(error);
  return (
    message.includes('restricted to administrators') ||
    message.includes('operation is not allowed') ||
    (message.includes('anonymous') && message.includes('disabled'))
  );
};

export const ensureAnonymousAuth = async (): Promise<boolean> => {
  if (!APP_CONFIG.AUTH_ANONYMOUS_ENABLED) return false;
  if (authClient.currentUser) return true;
  if (authAnonymousUnavailableForSession) return false;

  const now = Date.now();
  if (authBlockedUntilMs > now) return false;
  if (authEnsureInFlight) return authEnsureInFlight;
  if (now - authLastAttemptMs < AUTH_RETRY_COOLDOWN_MS) return false;

  authLastAttemptMs = now;
  authEnsureInFlight = (async () => {
    try {
      await signInAnonymously(authClient);
      authBlockedUntilMs = 0;
      return Boolean(authClient.currentUser);
    } catch (error: unknown) {
      if (isAnonymousAuthUnavailableError(error)) {
        authAnonymousUnavailableForSession = true;
        authBlockedUntilMs = Date.now() + AUTH_ANONYMOUS_DISABLED_BACKOFF_MS;
        return false;
      }

      if (isTooManyRequestsError(error)) {
        authBlockedUntilMs = Date.now() + AUTH_TOO_MANY_REQUESTS_BACKOFF_MS;
      }
      return false;
    } finally {
      authEnsureInFlight = null;
    }
  })();

  return authEnsureInFlight;
};

export const __resetAnonymousAuthStateForTests = () => {
  authEnsureInFlight = null;
  authLastAttemptMs = 0;
  authBlockedUntilMs = 0;
  authAnonymousUnavailableForSession = false;
};
