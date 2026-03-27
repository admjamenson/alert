import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, {
  NetInfoState,
  NetInfoStateType,
  NetInfoSubscription,
} from '@react-native-community/netinfo';
import CryptoJS from 'crypto-js';
import { APP_CONFIG } from '../core/config';
import {
  RelayMetricsSample,
  RelayMetricsState,
  StarlinkTransportProfile,
  buildRelayMetricsState,
  computeConnectivityQuality,
  detectStarlinkFromSsid,
  selectTransportProfile,
} from './starlink/starlinkUtils';

const STARLINK_MODE_KEY = '@Alert:StarlinkModeEnabledV1';
const STARLINK_TUNNEL_KEY = '@Alert:StarlinkTunnelEnabledV1';
const STARLINK_EXCLUSIVE_KEY = '@Alert:StarlinkExclusiveModeEnabledV1';
const RELAY_METRICS_KEY = '@Alert:StarlinkRelayMetricsV1';

const RELAY_PING_TIMEOUT_MS = 3500;

const getApiBaseUrl = () => {
  const envOverride =
    typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  return String(envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const normalizeSsid = (ssid?: string | null) =>
  String(ssid || '')
    .replace(/^"|"$/g, '')
    .trim();

const mapNetworkType = (type: NetInfoStateType): 'offline' | 'wifi' | 'cellular' | 'unknown' => {
  if (type === 'wifi') return 'wifi';
  if (type === 'cellular') return 'cellular';
  if (type === 'none' || type === 'unknown') return 'offline';
  return 'unknown';
};

export type ConnectivitySnapshot = {
  networkType: 'offline' | 'wifi' | 'cellular' | 'unknown';
  starlinkDetected: boolean;
  starlinkSsidHash?: string;
  quality: 'good' | 'medium' | 'poor' | 'unknown';
  latencyMs: number | null;
  retryRate: number;
  successRate: number;
  modeEnabled: boolean;
};

const safeParseSamples = (raw: string | null): RelayMetricsSample[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sample => ({
        ok: Boolean(sample?.ok),
        retriesUsed: Number(sample?.retriesUsed || 0),
        latencyMs: Number(sample?.latencyMs || 0),
        at: String(sample?.at || ''),
      }))
      .filter(sample => Number.isFinite(sample.latencyMs));
  } catch {
    return [];
  }
};

const hashSsid = (ssid: string) => {
  if (!ssid) return undefined;
  return CryptoJS.SHA256(ssid.toLowerCase()).toString(CryptoJS.enc.Hex).slice(0, 16);
};

const measureGatewayLatency = async (): Promise<number | null> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RELAY_PING_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/relay/ping`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return Date.now() - startedAt;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const getMetrics = async (): Promise<RelayMetricsState> => {
  const raw = await AsyncStorage.getItem(RELAY_METRICS_KEY);
  return buildRelayMetricsState(safeParseSamples(raw));
};

export const StarlinkConnectService = {
  async isModeEnabled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(STARLINK_MODE_KEY);
    return raw === '1';
  },

  async setModeEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STARLINK_MODE_KEY, enabled ? '1' : '0');
  },

  async isTunnelEnabled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(STARLINK_TUNNEL_KEY);
    return raw === '1';
  },

  async setTunnelEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STARLINK_TUNNEL_KEY, enabled ? '1' : '0');
  },

  async isExclusiveModeEnabled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(STARLINK_EXCLUSIVE_KEY);
    return raw === '1';
  },

  async setExclusiveModeEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STARLINK_EXCLUSIVE_KEY, enabled ? '1' : '0');
  },

  subscribeConnectivityChanges(onChange: () => void): NetInfoSubscription {
    return NetInfo.addEventListener(() => onChange());
  },

  async getNetInfoState(): Promise<NetInfoState> {
    return NetInfo.fetch();
  },

  async getConnectivitySnapshot(): Promise<ConnectivitySnapshot> {
    const [netState, modeEnabled, metrics, latencyMs] = await Promise.all([
      this.getNetInfoState(),
      this.isModeEnabled(),
      getMetrics(),
      measureGatewayLatency(),
    ]);

    const networkType = netState.isConnected === false ? 'offline' : mapNetworkType(netState.type);
    const ssid = normalizeSsid((netState.details as any)?.ssid);
    const starlinkDetected = networkType === 'wifi' && detectStarlinkFromSsid(ssid);
    const starlinkSsidHash = starlinkDetected ? hashSsid(ssid) : undefined;

    const quality = computeConnectivityQuality({
      isOnline: networkType !== 'offline',
      latencyMs,
      retryRate: metrics.retryRate,
      successRate: metrics.successRate,
    });

    return {
      networkType,
      starlinkDetected,
      starlinkSsidHash,
      quality,
      latencyMs,
      retryRate: metrics.retryRate,
      successRate: metrics.successRate,
      modeEnabled,
    };
  },

  async getTransportProfile(): Promise<StarlinkTransportProfile> {
    const snapshot = await this.getConnectivitySnapshot();
    return selectTransportProfile({
      starlinkModeEnabled: snapshot.modeEnabled,
      starlinkDetected: snapshot.starlinkDetected,
    });
  },

  async recordRelaySample(sample: {
    ok: boolean;
    retriesUsed: number;
    latencyMs: number;
  }): Promise<void> {
    const raw = await AsyncStorage.getItem(RELAY_METRICS_KEY);
    const current = safeParseSamples(raw);
    const next: RelayMetricsSample[] = [
      ...current,
      {
        ok: sample.ok,
        retriesUsed: Math.max(0, sample.retriesUsed),
        latencyMs: Math.max(0, sample.latencyMs),
        at: new Date().toISOString(),
      },
    ].slice(-40);
    await AsyncStorage.setItem(RELAY_METRICS_KEY, JSON.stringify(next));
  },

  async getRelayMetrics(): Promise<RelayMetricsState> {
    return getMetrics();
  },
};
