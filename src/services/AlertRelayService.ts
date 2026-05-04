import AsyncStorage from '@react-native-async-storage/async-storage';
import { encode as encodeMsgpack } from '@msgpack/msgpack';
import pako from 'pako';
import { getAlertApiBaseUrl } from '../core/config';
import { StarlinkConnectService } from './StarlinkConnectService';
import { UserIdentityService } from './UserIdentityService';
import {
  logSosDiagnostic,
  summarizeError,
  summarizeResponseBody,
  summarizeUrl,
} from '../observability/SosDiagnostics';
import { toUrlEncodedString } from '../utils/urlEncoding';

const RELAY_TOKEN_KEY = '@Alert:RelayAuthTokenV1';
const RELAY_TOKEN_EXP_KEY = '@Alert:RelayAuthTokenExpV1';
const RELAY_TOKEN_LEEWAY_MS = 45 * 1000;

type RelayAuthSnapshot = {
  token: string;
  expiresAtMs: number;
};

type RelayResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  retriesUsed: number;
  latencyMs: number;
};

const getApiBaseUrl = () => getAlertApiBaseUrl();

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const nowMs = () => Date.now();

const decodeStoredAuth = async (): Promise<RelayAuthSnapshot | null> => {
  const [token, expiresRaw] = await Promise.all([
    AsyncStorage.getItem(RELAY_TOKEN_KEY),
    AsyncStorage.getItem(RELAY_TOKEN_EXP_KEY),
  ]);
  if (!token || !expiresRaw) return null;
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isFinite(expiresAtMs)) return null;
  return { token, expiresAtMs };
};

const storeAuth = async (snapshot: RelayAuthSnapshot): Promise<void> => {
  await Promise.all([
    AsyncStorage.setItem(RELAY_TOKEN_KEY, snapshot.token),
    AsyncStorage.setItem(RELAY_TOKEN_EXP_KEY, String(snapshot.expiresAtMs)),
  ]);
};

const clearAuth = async (): Promise<void> => {
  await Promise.all([
    AsyncStorage.removeItem(RELAY_TOKEN_KEY),
    AsyncStorage.removeItem(RELAY_TOKEN_EXP_KEY),
  ]);
};

const buildCompactPayload = (payload: Record<string, unknown>) => {
  const msgPackPayload = encodeMsgpack(payload);
  const gzipped = pako.gzip(msgPackPayload, { level: 6 });
  return {
    encoding: 'msgpack+gzip+base64',
    payload: toBase64(gzipped),
  };
};

const ensureRelayToken = async (forceRefresh = false): Promise<string> => {
  const cached = await decodeStoredAuth();
  const safeNow = nowMs();

  if (
    cached &&
    !forceRefresh &&
    cached.expiresAtMs > safeNow + RELAY_TOKEN_LEEWAY_MS
  ) {
    return cached.token;
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    logSosDiagnostic('relay:token_blocked', {
      reason: 'missing_base_url',
    });
    throw new Error('relay_base_url_missing');
  }

  const [deviceId, userPhone] = await Promise.all([
    UserIdentityService.getDeviceId(),
    UserIdentityService.getUserPhone(),
  ]);
  const userId = userPhone || deviceId;

  const requestUrl = `${baseUrl}/api/relay/token`;
  logSosDiagnostic('relay:token_request_start', {
    method: 'POST',
    url: summarizeUrl(requestUrl),
  });
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Alert-Device-Id': deviceId,
    },
    body: JSON.stringify({
      userId,
      deviceId,
    }),
  });
  const responseJson = (await response.json().catch(() => null)) as any;
  logSosDiagnostic('relay:token_response', {
    method: 'POST',
    url: summarizeUrl(requestUrl),
    status: response.status,
    ok: response.ok,
    body: summarizeResponseBody(responseJson),
  });

  if (!response.ok) {
    throw new Error(`relay_token_http_${response.status}`);
  }

  const token = String(responseJson?.token || '');
  const expiresAt = String(responseJson?.expiresAt || '');
  const expiresAtMs = new Date(expiresAt).getTime();

  if (!token || !Number.isFinite(expiresAtMs)) {
    throw new Error('relay_token_invalid');
  }

  await storeAuth({ token, expiresAtMs });
  return token;
};

const callRelay = async <T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<RelayResult<T>> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    logSosDiagnostic('relay:request_blocked', {
      path,
      reason: 'missing_base_url',
    });
    return {
      ok: false,
      status: 0,
      data: null,
      retriesUsed: 0,
      latencyMs: 0,
    };
  }

  const [transport, netSnapshot, tunnelEnabled, exclusiveModeEnabled, deviceId] = await Promise.all([
    StarlinkConnectService.getTransportProfile(),
    StarlinkConnectService.getConnectivitySnapshot(),
    StarlinkConnectService.isTunnelEnabled(),
    StarlinkConnectService.isExclusiveModeEnabled(),
    UserIdentityService.getDeviceId(),
  ]);

  const authToken = await ensureRelayToken();
  const compactPayload = buildCompactPayload(payload);

  let lastStatus = 0;
  let lastData: T | null = null;
  let retriesUsed = 0;
  const startedAt = nowMs();

  for (let attempt = 0; attempt <= transport.maxRetries; attempt += 1) {
    if (attempt > 0) {
      retriesUsed = attempt;
    }

    const timeoutMs = transport.timeoutMs + attempt * 550;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const nonce = `${nowMs()}-${Math.random().toString(36).slice(2, 10)}`;
      const requestUrl = `${baseUrl}${path}`;
      logSosDiagnostic('relay:request_start', {
        method: 'POST',
        url: summarizeUrl(requestUrl),
        attempt,
        timeoutMs,
      });
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Alert-Device-Id': deviceId,
          'X-Alert-Nonce': nonce,
          'X-Alert-Ts': String(nowMs()),
        },
        body: JSON.stringify({
          ...compactPayload,
          metadata: {
            networkType: netSnapshot.networkType,
            starlinkDetected: netSnapshot.starlinkDetected,
            starlinkSsidHash: netSnapshot.starlinkSsidHash,
            transportProfile: transport.name,
            tunnelEnabled,
            exclusiveModeEnabled,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      lastStatus = response.status;
      const parsed = (await response.json().catch(() => null)) as T | null;
      lastData = parsed;
      logSosDiagnostic('relay:response', {
        method: 'POST',
        url: summarizeUrl(requestUrl),
        attempt,
        status: response.status,
        ok: response.ok,
        body: summarizeResponseBody(parsed),
      });

      if (response.ok) {
        const latencyMs = nowMs() - startedAt;
        await StarlinkConnectService.recordRelaySample({
          ok: true,
          retriesUsed,
          latencyMs,
        });
        return {
          ok: true,
          status: response.status,
          data: parsed,
          retriesUsed,
          latencyMs,
        };
      }

      if (response.status === 401 && attempt === 0) {
        await clearAuth();
        await ensureRelayToken(true);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      logSosDiagnostic('relay:request_error', {
        method: 'POST',
        url: summarizeUrl(`${baseUrl}${path}`),
        attempt,
        timeoutMs,
        error: summarizeError(error),
      });
    }

    if (attempt < transport.maxRetries) {
      const backoffMs = transport.initialBackoffMs * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }

  const latencyMs = nowMs() - startedAt;
  await StarlinkConnectService.recordRelaySample({
    ok: false,
    retriesUsed,
    latencyMs,
  });

  return {
    ok: false,
    status: lastStatus,
    data: lastData,
    retriesUsed,
    latencyMs,
  };
};

const callRelayGet = async <T>(
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<RelayResult<T>> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    logSosDiagnostic('relay:get_blocked', {
      path,
      reason: 'missing_base_url',
    });
    return {
      ok: false,
      status: 0,
      data: null,
      retriesUsed: 0,
      latencyMs: 0,
    };
  }

  const [transport, deviceId] = await Promise.all([
    StarlinkConnectService.getTransportProfile(),
    UserIdentityService.getDeviceId(),
  ]);

  const authToken = await ensureRelayToken();
  let lastStatus = 0;
  let lastData: T | null = null;
  let retriesUsed = 0;
  const startedAt = nowMs();

  const searchParams = toUrlEncodedString(query);

  for (let attempt = 0; attempt <= transport.maxRetries; attempt += 1) {
    if (attempt > 0) {
      retriesUsed = attempt;
    }

    const timeoutMs = transport.timeoutMs + attempt * 550;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const nonce = `${nowMs()}-${Math.random().toString(36).slice(2, 10)}`;
      const url = searchParams
        ? `${baseUrl}${path}?${searchParams}`
        : `${baseUrl}${path}`;
      logSosDiagnostic('relay:get_start', {
        method: 'GET',
        url: summarizeUrl(url),
        attempt,
        timeoutMs,
      });
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
          'X-Alert-Device-Id': deviceId,
          'X-Alert-Nonce': nonce,
          'X-Alert-Ts': String(nowMs()),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;
      const parsed = (await response.json().catch(() => null)) as T | null;
      lastData = parsed;
      logSosDiagnostic('relay:get_response', {
        method: 'GET',
        url: summarizeUrl(url),
        attempt,
        status: response.status,
        ok: response.ok,
        body: summarizeResponseBody(parsed),
      });

      if (response.ok) {
        const latencyMs = nowMs() - startedAt;
        await StarlinkConnectService.recordRelaySample({
          ok: true,
          retriesUsed,
          latencyMs,
        });
        return {
          ok: true,
          status: response.status,
          data: parsed,
          retriesUsed,
          latencyMs,
        };
      }

      if (response.status === 401 && attempt === 0) {
        await clearAuth();
        await ensureRelayToken(true);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      logSosDiagnostic('relay:get_error', {
        method: 'GET',
        url: summarizeUrl(
          searchParams.toString() ? `${baseUrl}${path}?${searchParams.toString()}` : `${baseUrl}${path}`,
        ),
        attempt,
        timeoutMs,
        error: summarizeError(error),
      });
    }

    if (attempt < transport.maxRetries) {
      const backoffMs = transport.initialBackoffMs * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }

  const latencyMs = nowMs() - startedAt;
  await StarlinkConnectService.recordRelaySample({
    ok: false,
    retriesUsed,
    latencyMs,
  });

  return {
    ok: false,
    status: lastStatus,
    data: lastData,
    retriesUsed,
    latencyMs,
  };
};

export const AlertRelayService = {
  async sendSos(payload: {
    id: string;
    location: { latitude: number; longitude: number };
    contacts: Array<{
      id?: string;
      phone?: string;
      name?: string;
      channel?: 'guardian' | 'contact';
    }>;
    userName?: string;
    createdAt: string;
    priority: 'high';
    integrity?: {
      version: 1;
      alg: 'sha256';
      digest: string;
    };
  }): Promise<RelayResult<{ relayId?: string }>> {
    return callRelay('/api/relay/sos', payload);
  },

  async pullAlerts(payload: { cursor?: string; limit?: number } = {}): Promise<
    RelayResult<{ items: unknown[]; nextCursor: string | null }>
  > {
    return callRelay('/api/relay/alerts/pull', payload);
  },

  async sendChat(payload: {
    conversationId: string;
    text: string;
    type?: 'text' | 'location';
    createdAt: string;
  }): Promise<RelayResult<{ messageId?: string }>> {
    return callRelay('/api/relay/chat/send', payload);
  },

  async pullChatMessages(payload: { cursor?: string; limit?: number } = {}): Promise<
    RelayResult<{ items: unknown[]; nextCursor: string | null }>
  > {
    return callRelayGet('/api/relay/chat/messages', {
      cursor: payload.cursor,
      limit: payload.limit,
    });
  },
};
