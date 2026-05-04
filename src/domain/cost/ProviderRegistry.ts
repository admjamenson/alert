import { CostClass, ProviderKey } from './CostTypes';

export type ProviderRegistryEntry = {
  key: ProviderKey;
  costClass: CostClass;
  regionsSupported: string[];
  fallbackOrder: ProviderKey[];
  timeoutMs: number;
  retryPolicy: { maxRetries: number; backoffMs: number };
};

const PROVIDERS: Record<ProviderKey, ProviderRegistryEntry> = {
  'open-meteo': {
    key: 'open-meteo',
    costClass: 'low',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: ['open-meteo-legacy'],
    timeoutMs: 6500,
    retryPolicy: { maxRetries: 1, backoffMs: 120 },
  },
  'open-meteo-legacy': {
    key: 'open-meteo-legacy',
    costClass: 'low',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: [],
    timeoutMs: 6500,
    retryPolicy: { maxRetries: 0, backoffMs: 0 },
  },
  nominatim: {
    key: 'nominatim',
    costClass: 'low',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: ['open-meteo-reverse'],
    timeoutMs: 2000,
    retryPolicy: { maxRetries: 1, backoffMs: 120 },
  },
  'open-meteo-reverse': {
    key: 'open-meteo-reverse',
    costClass: 'low',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: [],
    timeoutMs: 2000,
    retryPolicy: { maxRetries: 0, backoffMs: 0 },
  },
  eventhub: {
    key: 'eventhub',
    costClass: 'medium',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: ['eventhub-cache'],
    timeoutMs: 1800,
    retryPolicy: { maxRetries: 1, backoffMs: 200 },
  },
  'eventhub-cache': {
    key: 'eventhub-cache',
    costClass: 'free',
    regionsSupported: ['GLOBAL'],
    fallbackOrder: [],
    timeoutMs: 500,
    retryPolicy: { maxRetries: 0, backoffMs: 0 },
  },
};

export const ProviderRegistry = {
  get(provider: ProviderKey): ProviderRegistryEntry | null {
    return PROVIDERS[provider] || null;
  },

  list(): ProviderRegistryEntry[] {
    return Object.values(PROVIDERS);
  },
};

export default ProviderRegistry;
