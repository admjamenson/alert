import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_CONFIG } from '../core/config';
import registryLocal from '../data/officialSourcesRegistry.json';
import { OfficialSourcesRegistry } from '../types/officialSources';

const REGISTRY_CACHE_KEY = '@Alert:OfficialSourcesRegistry:v1';
const REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type RegistryCachePayload = {
  savedAtMs: number;
  data: OfficialSourcesRegistry;
};

const getApiBaseUrl = () => {
  const envOverride =
    typeof process !== 'undefined' ? (process as any)?.env?.ALERT_API_URL : undefined;
  const runtimeOverride =
    (globalThis as any)?.ALERT_API_URL || (globalThis as any)?.__ALERT_API_URL__;
  return String(runtimeOverride || envOverride || APP_CONFIG.API_BASE_URL || '').trim();
};

const normalizeSource = (source: any) => {
  if (!source || typeof source !== 'object') return null;
  const required = [
    'id',
    'name',
    'jurisdictionLevel',
    'countryCode',
    'monitoringDomain',
    'type',
    'url',
    'officiality',
  ];
  const hasRequired = required.every(field => typeof source[field] === 'string');
  if (!hasRequired) return null;
  return {
    ...source,
    trustScore: Number(source.trustScore ?? 0),
    lastCheckedAt: String(source.lastCheckedAt || ''),
    updateFrequency: String(source.updateFrequency || ''),
  };
};

const toRegistry = (raw: any): OfficialSourcesRegistry | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.globalFallbacks)) return null;
  const sources = raw.sources.map(normalizeSource).filter(Boolean);
  const globalFallbacks = raw.globalFallbacks.map(normalizeSource).filter(Boolean);
  if (sources.length === 0 && globalFallbacks.length === 0) return null;
  return {
    version: Number(raw.version || 1),
    generatedAt: String(raw.generatedAt || new Date().toISOString()),
    sources: sources as OfficialSourcesRegistry['sources'],
    globalFallbacks: globalFallbacks as OfficialSourcesRegistry['globalFallbacks'],
  };
};

const readCachedRegistry = async (): Promise<OfficialSourcesRegistry | null> => {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegistryCachePayload;
    if (!parsed || typeof parsed.savedAtMs !== 'number' || !parsed.data) return null;
    if (Date.now() - parsed.savedAtMs > REGISTRY_CACHE_TTL_MS) return null;
    return toRegistry(parsed.data);
  } catch {
    return null;
  }
};

const writeCachedRegistry = async (data: OfficialSourcesRegistry) => {
  const payload: RegistryCachePayload = {
    savedAtMs: Date.now(),
    data,
  };
  await AsyncStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(payload));
};

const fetchRemoteRegistry = async (): Promise<OfficialSourcesRegistry | null> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;
  const response = await fetch(`${baseUrl}/config/official-sources-registry`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const json = await response.json();
  return toRegistry(json);
};

const localRegistry: OfficialSourcesRegistry = toRegistry(registryLocal) || {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: [],
  globalFallbacks: [],
};

export const OfficialSourcesRegistryService = {
  async getRegistry(options?: { forceRefresh?: boolean }): Promise<OfficialSourcesRegistry> {
    const forceRefresh = Boolean(options?.forceRefresh);

    if (!forceRefresh) {
      const cached = await readCachedRegistry();
      if (cached) return cached;
    }

    try {
      const remote = await fetchRemoteRegistry();
      if (remote) {
        await writeCachedRegistry(remote);
        return remote;
      }
    } catch {
      // keep local fallback
    }

    return localRegistry;
  },
};

export default OfficialSourcesRegistryService;
