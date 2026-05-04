import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAlertApiBaseUrl } from '../../core/config';
import {
  OperationalSnapshot,
  normalizeOperationalSnapshot,
  isSnapshotStale,
} from '../../domain/trust/OperationalSnapshot';
import { toUrlEncodedString } from '../../utils/urlEncoding';

const SNAPSHOT_CACHE_KEY = '@Alert:OperationalSnapshot:v1';
const NETWORK_TIMEOUT_MS = 2200;

type SnapshotCacheEnvelope = {
  snapshot: OperationalSnapshot;
  cachedAt: string;
};

type GetSnapshotParams = {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  force?: boolean;
};

type MemoryCacheValue = {
  snapshot: OperationalSnapshot;
  expiresAtMs: number;
};

let memoryCache: MemoryCacheValue | null = null;

const getApiBaseUrl = () => getAlertApiBaseUrl();

const fetchJsonWithTimeout = async (url: string): Promise<any> => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // fail-soft
        }
      }, NETWORK_TIMEOUT_MS)
    : null;
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      throw new Error(`snapshot_http_${response.status}`);
    }
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const asFiniteNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const clampRadiusKm = (value: unknown): number => {
  const parsed = asFiniteNumber(value);
  if (parsed <= 0) return 35;
  return Math.max(5, Math.min(120, Math.round(parsed)));
};

const getExpiresAtMs = (snapshot: OperationalSnapshot): number => {
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (Number.isFinite(expiresAtMs)) return expiresAtMs;
  return Date.now() + 45_000;
};

const parseEnvelope = (raw: string | null): SnapshotCacheEnvelope | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SnapshotCacheEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      snapshot: normalizeOperationalSnapshot((parsed as any).snapshot),
      cachedAt:
        typeof parsed.cachedAt === 'string' && parsed.cachedAt.trim()
          ? parsed.cachedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

export interface IOperationalSnapshotApiAdapter {
  getSnapshotByLocation(params: GetSnapshotParams): Promise<OperationalSnapshot>;
  getCachedSnapshot(): Promise<OperationalSnapshot | null>;
}

export class OperationalSnapshotApiAdapter implements IOperationalSnapshotApiAdapter {
  private async persistSnapshot(snapshot: OperationalSnapshot): Promise<void> {
    memoryCache = {
      snapshot,
      expiresAtMs: getExpiresAtMs(snapshot),
    };
    const envelope: SnapshotCacheEnvelope = {
      snapshot,
      cachedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(envelope));
  }

  async getCachedSnapshot(): Promise<OperationalSnapshot | null> {
    if (memoryCache?.snapshot) return memoryCache.snapshot;
    const envelope = parseEnvelope(await AsyncStorage.getItem(SNAPSHOT_CACHE_KEY));
    if (!envelope) return null;
    memoryCache = {
      snapshot: envelope.snapshot,
      expiresAtMs: getExpiresAtMs(envelope.snapshot),
    };
    return envelope.snapshot;
  }

  async getSnapshotByLocation(params: GetSnapshotParams): Promise<OperationalSnapshot> {
    if (!params.force && memoryCache?.snapshot && Date.now() < memoryCache.expiresAtMs) {
      return memoryCache.snapshot;
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      const cached = await this.getCachedSnapshot();
      if (cached) return cached;
      throw new Error('snapshot_base_url_missing');
    }

    const query = toUrlEncodedString({
      lat: asFiniteNumber(params.latitude).toFixed(5),
      lon: asFiniteNumber(params.longitude).toFixed(5),
      radiusKm: String(clampRadiusKm(params.radiusKm)),
    });
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${normalizedBase}/v1/operational/snapshot?${query}`;
    const payload = await fetchJsonWithTimeout(url);
    const snapshot = normalizeOperationalSnapshot(payload?.snapshot);
    await this.persistSnapshot(snapshot);
    return snapshot;
  }
}

export const operationalSnapshotApiAdapter = new OperationalSnapshotApiAdapter();

export const isOperationalSnapshotReadStale = (snapshot: OperationalSnapshot): boolean =>
  isSnapshotStale(snapshot);
