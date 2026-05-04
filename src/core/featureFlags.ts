/**
 * FEATURE FLAGS - Home Instantânea (FAANG Fase 2)
 *
 * Sistema de feature flags para controle da Home instantânea com cache local.
 * Todas as flags podem ser controladas via environment variables ou runtime config.
 *
 * SEGURANÇA:
 * - Sem PII nas flags
 * - Sem localização precisa em plaintext
 * - Sem tokens ou secrets
 */

import Config from 'react-native-config';

type FeatureFlagDefinition = {
  key: string;
  defaultValue: boolean;
  envKey: string;
  description: string;
};

const HOME_FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'home_instant_cache_enabled',
    defaultValue: true,
    envKey: 'ALERT_HOME_INSTANT_CACHE_ENABLED',
    description: 'Habilita cache local para abertura instantânea da Home',
  },
  {
    key: 'home_stale_while_revalidate_enabled',
    defaultValue: true,
    envKey: 'ALERT_HOME_STALE_WHILE_REVALIDATE_ENABLED',
    description: 'Renderiza cache primeiro, busca dados frescos em paralelo',
  },
  {
    key: 'home_background_refresh_enabled',
    defaultValue: true,
    envKey: 'ALERT_HOME_BACKGROUND_REFRESH_ENABLED',
    description: 'Atualiza dados em background após exibir cache',
  },
  {
    key: 'home_metrics_enabled',
    defaultValue: true,
    envKey: 'ALERT_HOME_METRICS_ENABLED',
    description: 'Coleta métricas de performance da Home',
  },
];

const readBooleanFlag = (envKey: string, defaultValue: boolean): boolean => {
  // Tentar environment variable primeiro
  if (typeof process !== 'undefined' && process.env?.[envKey]) {
    const raw = String(process.env[envKey]).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  // Tentar react-native-config
  const configValue = (Config as Record<string, unknown>)?.[envKey];
  if (configValue !== undefined && configValue !== null) {
    if (typeof configValue === 'boolean') return configValue;
    const raw = String(configValue).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  return defaultValue;
};

class FeatureFlagManager {
  private flags: Map<string, boolean> = new Map();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;

    HOME_FEATURE_FLAGS.forEach(flag => {
      const value = readBooleanFlag(flag.envKey, flag.defaultValue);
      this.flags.set(flag.key, value);
    });

    this.initialized = true;
    console.log('[FeatureFlags] Initialized:', this.getAll());
  }

  isEnabled(key: string): boolean {
    if (!this.initialized) this.initialize();
    return this.flags.get(key) ?? false;
  }

  getAll(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    this.flags.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  // Override para debugging/testing
  set(key: string, value: boolean): void {
    this.flags.set(key, value);
  }

  reset(): void {
    this.flags.clear();
    this.initialized = false;
  }
}

export const FeatureFlags = new FeatureFlagManager();

// Export individual flags for convenience
export const isHomeInstantCacheEnabled = (): boolean =>
  FeatureFlags.isEnabled('home_instant_cache_enabled');

export const isHomeStaleWhileRevalidateEnabled = (): boolean =>
  FeatureFlags.isEnabled('home_stale_while_revalidate_enabled');

export const isHomeBackgroundRefreshEnabled = (): boolean =>
  FeatureFlags.isEnabled('home_background_refresh_enabled');

export const isHomeMetricsEnabled = (): boolean =>
  FeatureFlags.isEnabled('home_metrics_enabled');

// Export types
export type {FeatureFlagDefinition};
