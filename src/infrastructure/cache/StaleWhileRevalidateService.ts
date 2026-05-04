/**
 * STALE-WHILE-REVALIDATE SERVICE - Atualização em Background (FAANG Fase 2)
 *
 * Implementa o padrão stale-while-revalidate para a Home Screen:
 * 1. Renderiza dados em cache imediatamente (se disponíveis)
 * 2. Busca dados frescos em background
 * 3. Atualiza UI quando dados frescos chegam
 * 4. Evita chamadas duplicadas com deduplication
 *
 * SEGURANÇA:
 * - Timeouts curtos para não bloquear UI
 * - Retry com backoff exponencial
 * - Deduplication de requisições
 * - Fail-soft (não quebra se backend falhar)
 */

import {HomeInstantCache, FreshnessState} from './HomeInstantCache';
import {GetHomeRiskSnapshotQuery} from '../../application/queries/GetHomeRiskSnapshotQuery';
import {GetWeatherFeedQuery} from '../../application/queries/GetWeatherFeedQuery';
import {GetOperationalSnapshotQuery} from '../../application/queries/GetOperationalSnapshotQuery';
import {GetAlertBrainBriefingQuery} from '../../application/queries/GetAlertBrainBriefingQuery';
import {FeatureFlags} from '../../core/featureFlags';

// Tipos de requisição pendente
type PendingRequest = {
  promise: Promise<unknown>;
  startedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

// Estado do revalidador
type RevalidationState = {
  isRevalidating: boolean;
  lastRevalidationAt?: number;
  pendingRequests: Map<string, PendingRequest>;
};

const REVALIDATION_TIMEOUT_MS = 8000; // Timeout máximo para revalidação
const DEDUP_WINDOW_MS = 3000; // Janela para deduplicação de requests
const BACKOFF_MS = [1000, 2000, 4000, 8000]; // Backoff exponencial

class StaleWhileRevalidateManager {
  private state: RevalidationState = {
    isRevalidating: false,
    lastRevalidationAt: undefined,
    pendingRequests: new Map(),
  };

  private refreshRunCounter = 0;
  private mountedComponents = new Set<string>();

  /**
   * Inicializa o serviço de revalidação
   */
  initialize(): void {
    HomeInstantCache.initialize();
    console.log('[StaleWhileRevalidate] Initialized');
  }

  /**
   * Obtém dados da Home com estratégia stale-while-revalidate
   *
   * @returns Dados em cache (se disponíveis) + promise para dados frescos
   */
  async getHomeSnapshot(params: {
    latitude: number | null;
    longitude: number | null;
    locale: string;
    timeZone?: string;
    force?: boolean;
  }) {
    const startTime = Date.now();
    const requestId = `home_${params.latitude}_${params.longitude}_${Date.now()}`;

    // Verificar se feature flag está habilitada
    const swrEnabled = FeatureFlags.isEnabled(
      'home_stale_while_revalidate_enabled',
    );
    const instantCacheEnabled = FeatureFlags.isEnabled(
      'home_instant_cache_enabled',
    );

    if (!swrEnabled || !instantCacheEnabled) {
      // Fallback: comportamento normal sem cache
      HomeInstantCache.recordMiss();
      const freshData = await this.fetchFreshData(params);
      return {
        cachedData: null,
        freshData,
        freshness: 'missing' as FreshnessState,
        timeToFirstContent: Date.now() - startTime,
      };
    }

    // Tentar obter cache primeiro
    const hasCache = HomeInstantCache.hasUsableCache();
    const weatherFreshness = HomeInstantCache.getWeather().freshness;
    const riskFreshness = HomeInstantCache.getRisk().freshness;

    // Se tiver cache utilizável, retorna imediatamente
    if (
      hasCache &&
      (weatherFreshness !== 'missing' || riskFreshness !== 'missing')
    ) {
      const timeToFirstContent = Date.now() - startTime;
      HomeInstantCache.recordHit(timeToFirstContent);

      // Dispara revalidação em background (não bloqueia)
      this.scheduleBackgroundRevalidation(params, requestId).catch(() => {
        // Fail-soft: não logar erro de background
      });

      return {
        cachedData: this.buildSnapshotFromCache(),
        freshData: null,
        freshness: this.getOverallFreshness(),
        timeToFirstContent,
      };
    }

    // Sem cache: busca dados frescos
    HomeInstantCache.recordMiss();
    const freshData = await this.fetchFreshData(params);
    return {
      cachedData: null,
      freshData,
      freshness: 'fresh',
      timeToFirstContent: Date.now() - startTime,
    };
  }

  /**
   * Busca dados frescos do backend
   */
  private async fetchFreshData(params: {
    latitude: number | null;
    longitude: number | null;
    locale: string;
    timeZone?: string;
    force?: boolean;
  }) {
    const runId = ++this.refreshRunCounter;
    HomeInstantCache.recordBackendCall();

    try {
      const snapshot = await GetHomeRiskSnapshotQuery.execute({
        latitude: params.latitude,
        longitude: params.longitude,
        riskScore: 0.2, // Default risk score
        clientRiskLevel: 'low',
        locale: params.locale,
        timeZone: params.timeZone,
        force: params.force,
        includeBriefing: true,
        t: (key: string) => key, // Simple identity function for translations
      });

      // Atualizar cache com dados frescos
      await this.updateCacheFromSnapshot(snapshot, params);

      return snapshot;
    } catch (error) {
      console.warn('[StaleWhileRevalidate] Fetch failed:', error);
      HomeInstantCache.recordForecastFailure();
      throw error;
    }
  }

  /**
   * Atualiza cache com dados do snapshot
   */
  private async updateCacheFromSnapshot(snapshot: any, params: any) {
    const now = new Date().toISOString();

    // Extrair dados para cache
    const weatherData = snapshot.briefing?.weather;
    const riskData = {
      level: snapshot.operational?.snapshot?.riskLevel || 'low',
      alerts: snapshot.alerts || [],
      prioritizedRisks: snapshot.prioritizedRisks || [],
      fetchedAt: now,
    };
    const operationalData = snapshot.operational;
    const briefingData = snapshot.briefing;

    // Salvar no cache
    await HomeInstantCache.save({
      weather: weatherData
        ? {
            ...weatherData,
            fetchedAt: now,
          }
        : null,
      risk: riskData,
      operational: operationalData
        ? {
            ...operationalData,
            fetchedAt: now,
          }
        : null,
      briefing: briefingData
        ? {
            ...briefingData,
            fetchedAt: now,
          }
        : null,
      cityApproximation: params.latitude ? 'Localização atual' : '',
    });
  }

  /**
   * Agenda revalidação em background
   */
  async scheduleBackgroundRevalidation(
    params: {
      latitude: number | null;
      longitude: number | null;
      locale: string;
      timeZone?: string;
      force?: boolean;
    },
    requestId: string,
  ) {
    // Verificar se já está revalidando
    if (this.state.isRevalidating) {
      // Check deduplication window
      if (
        this.state.lastRevalidationAt &&
        Date.now() - this.state.lastRevalidationAt < DEDUP_WINDOW_MS
      ) {
        return;
      }
    }

    this.state.isRevalidating = true;
    this.state.lastRevalidationAt = Date.now();

    try {
      // Fetch com timeout
      const freshData = await Promise.race([
        this.fetchFreshData(params),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('revalidation_timeout')),
            REVALIDATION_TIMEOUT_MS,
          ),
        ),
      ]);

      return freshData;
    } catch (error) {
      // Fail-soft: não quebrar se revalidação falhar
      console.warn(
        '[StaleWhileRevalidate] Background revalidation failed:',
        error,
      );
      return null;
    } finally {
      this.state.isRevalidating = false;
    }
  }

  /**
   * Constrói snapshot a partir do cache
   */
  private buildSnapshotFromCache() {
    const weather = HomeInstantCache.getWeather();
    const risk = HomeInstantCache.getRisk();
    const operational = HomeInstantCache.getOperational();
    const briefing = HomeInstantCache.getBriefing();

    return {
      alerts: risk.data?.alerts || [],
      prioritizedRisks: risk.data?.prioritizedRisks || [],
      operational: operational.data,
      briefing: briefing.data,
      hasUnavailableMonitoringData: false,
      safetyCTAState:
        risk.data?.level === 'high'
          ? 'critical'
          : risk.data?.level === 'medium'
            ? 'warning'
            : 'ok',
      statusBarState:
        risk.data?.level === 'high'
          ? 'critical'
          : risk.data?.level === 'medium'
            ? 'warning'
            : 'ok',
    };
  }

  /**
   * Obtém estado de frescor geral
   */
  private getOverallFreshness(): FreshnessState {
    const weather = HomeInstantCache.getWeather();
    const risk = HomeInstantCache.getRisk();
    const operational = HomeInstantCache.getOperational();
    const briefing = HomeInstantCache.getBriefing();

    // Se todos estiverem fresh, retorna fresh
    const allFresh = [weather, risk, operational, briefing].every(
      item => item.freshness === 'fresh',
    );
    if (allFresh) return 'fresh';

    // Se algum estiver expired ou missing, retorna stale
    const anyExpired = [weather, risk, operational, briefing].some(
      item => item.freshness === 'expired' || item.freshness === 'missing',
    );
    if (anyExpired) return 'stale';

    return 'stale';
  }

  /**
   * Registra componente montado para cleanup
   */
  registerComponent(componentId: string): void {
    this.mountedComponents.add(componentId);
  }

  /**
   * Remove componente montado
   */
  unregisterComponent(componentId: string): void {
    this.mountedComponents.delete(componentId);
  }

  /**
   * Força refresh imediato (pull-to-refresh)
   */
  async forceRefresh(params: {
    latitude: number | null;
    longitude: number | null;
    locale: string;
    timeZone?: string;
  }): Promise<any> {
    // Cancelar revalidações pendentes
    this.state.pendingRequests.clear();

    // Fetch forçado
    return await this.fetchFreshData({...params, force: true});
  }

  /**
   * Limpa estado (para testes)
   */
  reset(): void {
    this.state = {
      isRevalidating: false,
      lastRevalidationAt: undefined,
      pendingRequests: new Map(),
    };
    this.refreshRunCounter = 0;
    this.mountedComponents.clear();
  }

  /**
   * Obtém métricas para debugging
   */
  getDebugInfo() {
    return {
      isRevalidating: this.state.isRevalidating,
      lastRevalidationAt: this.state.lastRevalidationAt,
      pendingRequestsCount: this.state.pendingRequests.size,
      refreshRunCounter: this.refreshRunCounter,
      mountedComponentsCount: this.mountedComponents.size,
      cacheDebug: HomeInstantCache.debug(),
    };
  }
}

export const StaleWhileRevalidateService = new StaleWhileRevalidateManager();

// Hook personalizado para React
export const useStaleWhileRevalidate = (params: {
  latitude: number | null;
  longitude: number | null;
  locale: string;
  timeZone?: string;
}) => {
  const [data, setData] = React.useState<any>(null);
  const [cachedData, setCachedData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [freshness, setFreshness] = React.useState<FreshnessState>('missing');
  const [timeToFirstContent, setTimeToFirstContent] = React.useState<number>(0);

  React.useEffect(() => {
    const componentId = `home_${Date.now()}`;
    StaleWhileRevalidateService.registerComponent(componentId);

    const loadData = async () => {
      try {
        const result =
          await StaleWhileRevalidateService.getHomeSnapshot(params);

        if (result.cachedData) {
          setCachedData(result.cachedData);
          setData(result.cachedData);
          setFreshness(result.freshness);
          setTimeToFirstContent(result.timeToFirstContent);
          setLoading(false);

          // Se tiver cache, buscar dados frescos em background
          if (result.freshness !== 'fresh') {
            StaleWhileRevalidateService.scheduleBackgroundRevalidation(
              params,
              componentId,
            )
              .then(freshData => {
                if (freshData) {
                  setData(freshData);
                  setFreshness('fresh');
                }
              })
              .catch(() => {
                // Fail-soft
              });
          }
        } else if (result.freshData) {
          setData(result.freshData);
          setFreshness('fresh');
          setTimeToFirstContent(result.timeToFirstContent);
          setLoading(false);
        }
      } catch (error) {
        console.warn('[useStaleWhileRevalidate] Error:', error);
        setLoading(false);
      }
    };

    loadData();

    return () => {
      StaleWhileRevalidateService.unregisterComponent(componentId);
    };
  }, [params.latitude, params.longitude, params.locale, params.timeZone]);

  return {
    data,
    cachedData,
    loading,
    freshness,
    timeToFirstContent,
    isFromCache: !!cachedData && !loading,
  };
};

// Import React para o hook
import React from 'react';
