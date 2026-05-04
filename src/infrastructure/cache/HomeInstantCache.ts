/**
 * HOME INSTANT CACHE - Cache Local para Abertura Rápida (FAANG Fase 2)
 *
 * Sistema de cache local para a Home Screen com:
 * - Schema versioning para migrações
 * - TTLs diferenciados por tipo de dado
 * - Armazenamento seguro (sem PII, sem localização precisa)
 * - Serialização eficiente
 *
 * SEGURANÇA:
 * - Sem PII armazenado
 * - Sem localização precisa em plaintext (apenas cidade aproximada)
 * - Sem tokens ou secrets
 * - Sem coordenadas exatas
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Schema version - incrementar ao mudar estrutura
const SCHEMA_VERSION = 1;
const CACHE_KEY = '@Alert:HomeInstantCache:v' + SCHEMA_VERSION;
const METRICS_KEY = '@Alert:HomeCacheMetrics';

// TTLs em milissegundos
export const TTL_CONFIG = {
  weatherCurrent: 5 * 60 * 1000, // 5 minutos
  weatherForecast: 5 * 60 * 1000, // 5 minutos
  riskCritical: 30 * 1000, // 30 segundos
  riskIncidents: 60 * 1000, // 1 minuto
  city: 2 * 60 * 60 * 1000, // 2 horas
  operational: 2 * 60 * 1000, // 2 minutos
  briefing: 3 * 60 * 1000, // 3 minutos
} as const;

// Tipos de cache
export type WeatherCacheData = {
  temp: string;
  icon: string;
  label: string;
  city: string;
  forecast?: Array<{
    dayLabel: string;
    icon: string;
    maxTemp: string;
    minTemp: string;
    rainChance?: number;
  }>;
  isDay: boolean;
  sunrise: string;
  sunset: string;
  timeZone: string;
  fetchedAt: string;
};

export type RiskCacheData = {
  level: 'low' | 'medium' | 'high';
  alerts: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    timestamp: string;
  }>;
  prioritizedRisks: Array<{
    categoryId: string;
    nature: string;
    score: number;
    title: string;
    summary?: string;
    timestamp: string;
  }>;
  fetchedAt: string;
};

export type OperationalCacheData = {
  state: 'loading' | 'fresh' | 'stale' | 'error';
  riskLevel: 'low' | 'medium' | 'high';
  freshnessSec: number;
  errorCode?: string;
  fetchedAt: string;
};

export type BriefingCacheData = {
  headline: string;
  summary: string;
  recommendedCategory: string;
  signalCount: number;
  fetchedAt: string;
};

// Estrutura principal do cache
export type HomeInstantCacheData = {
  schemaVersion: number;
  cachedAt: number; // timestamp em ms
  weather: WeatherCacheData | null;
  risk: RiskCacheData | null;
  operational: OperationalCacheData | null;
  briefing: BriefingCacheData | null;
  cityApproximation: string; // Apenas cidade aproximada, sem coords exatas
  locationCountryCode?: string;
};

// Métricas de cache
export type HomeCacheMetrics = {
  totalHits: number;
  totalMisses: number;
  lastHitAt?: number;
  lastMissAt?: number;
  avgTimeToFirstContentMs?: number;
  backendCallsOnHomeOpen: number;
  forecastFailureRate: number;
};

// Estado de frescor
export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'missing';

class HomeInstantCacheManager {
  private cache: HomeInstantCacheData | null = null;
  private loaded = false;
  private metrics: HomeCacheMetrics = {
    totalHits: 0,
    totalMisses: 0,
    backendCallsOnHomeOpen: 0,
    forecastFailureRate: 0,
  };

  async initialize(): Promise<void> {
    if (this.loaded) return;

    try {
      const [cacheJson, metricsJson] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(METRICS_KEY),
      ]);

      if (cacheJson) {
        const parsed = JSON.parse(cacheJson) as HomeInstantCacheData;
        if (parsed.schemaVersion === SCHEMA_VERSION) {
          this.cache = parsed;
        } else {
          console.log('[HomeCache] Schema mismatch, clearing old cache');
          await this.clear();
        }
      }

      if (metricsJson) {
        this.metrics = JSON.parse(metricsJson) as HomeCacheMetrics;
      }
    } catch (error) {
      console.warn('[HomeCache] Failed to initialize:', error);
      await this.clear();
    }

    this.loaded = true;
  }

  async save(data: Partial<HomeInstantCacheData>): Promise<void> {
    try {
      const now = Date.now();
      this.cache = {
        schemaVersion: SCHEMA_VERSION,
        cachedAt: now,
        weather: data.weather ?? this.cache?.weather ?? null,
        risk: data.risk ?? this.cache?.risk ?? null,
        operational: data.operational ?? this.cache?.operational ?? null,
        briefing: data.briefing ?? this.cache?.briefing ?? null,
        cityApproximation:
          data.cityApproximation ?? this.cache?.cityApproximation ?? '',
        locationCountryCode:
          data.locationCountryCode ?? this.cache?.locationCountryCode,
      };

      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
    } catch (error) {
      console.warn('[HomeCache] Failed to save:', error);
    }
  }

  async saveMetrics(metrics: Partial<HomeCacheMetrics>): Promise<void> {
    Object.assign(this.metrics, metrics);
    try {
      await AsyncStorage.setItem(METRICS_KEY, JSON.stringify(this.metrics));
    } catch (error) {
      console.warn('[HomeCache] Failed to save metrics:', error);
    }
  }

  getFreshness(
    key: keyof Omit<
      HomeInstantCacheData,
      'schemaVersion' | 'cachedAt' | 'cityApproximation' | 'locationCountryCode'
    >,
  ): FreshnessState {
    if (!this.cache) return 'missing';

    const data = this.cache[key];
    if (!data || typeof data !== 'object' || !('fetchedAt' in data))
      return 'missing';

    const fetchedAt = new Date(data.fetchedAt).getTime();
    const now = Date.now();
    const age = now - fetchedAt;

    // Determinar TTL baseado no type
    let ttl: number;
    switch (key) {
      case 'weather':
        ttl = TTL_CONFIG.weatherCurrent;
        break;
      case 'risk': {
        // Type assertion segura pois sabemos que risk tem level
        const riskData = data as RiskCacheData;
        ttl =
          riskData.level === 'high'
            ? TTL_CONFIG.riskCritical
            : TTL_CONFIG.riskIncidents;
        break;
      }
      case 'operational':
        ttl = TTL_CONFIG.operational;
        break;
      case 'briefing':
        ttl = TTL_CONFIG.briefing;
        break;
      default:
        ttl = 5 * 60 * 1000; // 5 minutos default
    }

    if (age < ttl * 0.5) return 'fresh';
    if (age < ttl) return 'stale';
    return 'expired';
  }

  getWeather(): {data: WeatherCacheData | null; freshness: FreshnessState} {
    if (!this.cache) return {data: null, freshness: 'missing'};
    return {
      data: this.cache.weather,
      freshness: this.getFreshness('weather'),
    };
  }

  getRisk(): {data: RiskCacheData | null; freshness: FreshnessState} {
    if (!this.cache) return {data: null, freshness: 'missing'};
    return {
      data: this.cache.risk,
      freshness: this.getFreshness('risk'),
    };
  }

  getOperational(): {
    data: OperationalCacheData | null;
    freshness: FreshnessState;
  } {
    if (!this.cache) return {data: null, freshness: 'missing'};
    return {
      data: this.cache.operational,
      freshness: this.getFreshness('operational'),
    };
  }

  getBriefing(): {data: BriefingCacheData | null; freshness: FreshnessState} {
    if (!this.cache) return {data: null, freshness: 'missing'};
    return {
      data: this.cache.briefing,
      freshness: this.getFreshness('briefing'),
    };
  }

  getCityApproximation(): string {
    return this.cache?.cityApproximation ?? '';
  }

  getCachedAt(): number {
    return this.cache?.cachedAt ?? 0;
  }

  hasUsableCache(): boolean {
    if (!this.cache) return false;
    // Pelo menos um dado deve estar disponível
    return !!(
      this.cache.weather ||
      this.cache.risk ||
      this.cache.operational ||
      this.cache.briefing
    );
  }

  getMetrics(): HomeCacheMetrics {
    return {...this.metrics};
  }

  recordHit(timeToFirstContentMs?: number): void {
    this.metrics.totalHits++;
    this.metrics.lastHitAt = Date.now();
    if (timeToFirstContentMs !== undefined) {
      const current = this.metrics.avgTimeToFirstContentMs || 0;
      const count = this.metrics.totalHits;
      this.metrics.avgTimeToFirstContentMs =
        (current * (count - 1) + timeToFirstContentMs) / count;
    }
    this.saveMetrics({
      totalHits: this.metrics.totalHits,
      avgTimeToFirstContentMs: this.metrics.avgTimeToFirstContentMs,
    });
  }

  recordMiss(): void {
    this.metrics.totalMisses++;
    this.metrics.lastMissAt = Date.now();
    this.saveMetrics({totalMisses: this.metrics.totalMisses});
  }

  recordBackendCall(): void {
    this.metrics.backendCallsOnHomeOpen++;
    this.saveMetrics({
      backendCallsOnHomeOpen: this.metrics.backendCallsOnHomeOpen,
    });
  }

  recordForecastFailure(): void {
    const total = this.metrics.backendCallsOnHomeOpen + 1;
    const failures =
      Math.round(this.metrics.forecastFailureRate * (total - 1)) + 1;
    this.metrics.forecastFailureRate = failures / total;
    this.metrics.backendCallsOnHomeOpen = total;
    this.saveMetrics({
      forecastFailureRate: this.metrics.forecastFailureRate,
      backendCallsOnHomeOpen: total,
    });
  }

  async clear(): Promise<void> {
    this.cache = null;
    try {
      await AsyncStorage.multiRemove([CACHE_KEY, METRICS_KEY]);
    } catch (error) {
      console.warn('[HomeCache] Failed to clear:', error);
    }
  }

  // Para debugging
  debug(): {cache: HomeInstantCacheData | null; metrics: HomeCacheMetrics} {
    return {
      cache: this.cache,
      metrics: {...this.metrics},
    };
  }
}

export const HomeInstantCache = new HomeInstantCacheManager();

// Helper para formatar tempo de atualização
export const formatFreshnessLabel = (
  freshness: FreshnessState,
  cachedAt?: number,
): string => {
  if (freshness === 'missing') return 'Indisponível';
  if (freshness === 'expired') return 'Dados temporariamente limitados';
  if (freshness === 'stale') return 'Atualizando previsão…';

  if (cachedAt) {
    const minutes = Math.floor((Date.now() - cachedAt) / 60000);
    if (minutes < 1) return 'Atualizado agora';
    if (minutes === 1) return 'Atualizado há 1 min';
    if (minutes < 5) return `Atualizado há ${minutes} min`;
  }

  return 'Atualizado';
};

// Helper para verificar se deve mostrar fallback
export const shouldShowFallback = (
  freshness: FreshnessState,
  hasCache: boolean,
): boolean => {
  // Só mostra "Indisponível" se não tiver cache E estiver expired/missing
  return !hasCache && (freshness === 'expired' || freshness === 'missing');
};
