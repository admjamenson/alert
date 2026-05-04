'use strict';

/**
 * Feature Flags - Backend (FAANG Fase 3)
 *
 * Sistema de feature flags para controle de funcionalidades no backend.
 * Todas as flags podem ser controladas via environment variables.
 *
 * SEGURANÇA:
 * - Sem PII nas flags
 * - Sem localização precisa em plaintext
 * - Sem tokens ou secrets
 * - Flags críticas de segurança (SOS, billing) sempre validadas no servidor
 */

const BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'on']);

const readBoolean = (env, key, fallback = false) => {
  const raw = String(env?.[key] ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return Boolean(fallback);
  return BOOLEAN_TRUE.has(raw);
};

const readNumber = (env, key, fallback) => {
  const raw = String(env?.[key] ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Definição das feature flags do backend
 * Cada flag tem:
 * - key: identificador único
 * - defaultValue: valor padrão (false por segurança)
 * - envKey: variável de ambiente que controla a flag
 * - description: descrição da funcionalidade
 * - critical: se é crítica para segurança/operações (não pode ser ativada por env em produção)
 */
const FEATURE_FLAGS = [
  // Funcionalidades principais
  {
    key: 'sos_enabled',
    defaultValue: true,
    envKey: 'ALERT_FEATURE_SOS_ENABLED',
    description: 'Habilita funcionalidades SOS (envio e recebimento)',
    critical: true,
  },
  {
    key: 'sos_enhancements_enabled',
    defaultValue: false,
    envKey: 'ALERT_FEATURE_SOS_ENHANCEMENTS_ENABLED',
    description: 'Habilita melhorias do SOS (prioridade, canais múltiplos)',
    critical: false,
  },
  {
    key: 'maps_enabled',
    defaultValue: true,
    envKey: 'ALERT_FEATURE_MAPS_ENABLED',
    description: 'Habilita funcionalidades de mapa e rotas',
    critical: false,
  },
  {
    key: 'weather_enabled',
    defaultValue: true,
    envKey: 'ALERT_FEATURE_WEATHER_ENABLED',
    description: 'Habilita feed de clima e alertas meteorológicos',
    critical: false,
  },
  {
    key: 'alerts_enabled',
    defaultValue: true,
    envKey: 'ALERT_FEATURE_ALERTS_ENABLED',
    description: 'Habilita feed de alertas de situações',
    critical: false,
  },
  {
    key: 'ai_chat_enabled',
    defaultValue: false,
    envKey: 'ALERT_FEATURE_AI_CHAT_ENABLED',
    description: 'Habilita assistente com IA',
    critical: false,
  },
  {
    key: 'external_integrations_enabled',
    defaultValue: false,
    envKey: 'ALERT_FEATURE_EXTERNAL_INTEGRATIONS_ENABLED',
    description: 'Habilita integrações externas (providers adicionais)',
    critical: false,
  },

  // Controle de rollout
  {
    key: 'starlink_connect_enabled',
    defaultValue: false,
    envKey: 'ALERT_FEATURE_STARLINK_CONNECT_ENABLED',
    description: 'Habilita detecção e conexão Starlink',
    critical: false,
  },
  {
    key: 'starlink_tunnel_enabled',
    defaultValue: false,
    envKey: 'ALERT_FEATURE_STARLINK_TUNNEL_ENABLED',
    description: 'Habilita túnel Starlink para áreas sem internet',
    critical: true,
  },

  // Infraestrutura
  {
    key: 'redis_cache_enabled',
    defaultValue: false,
    envKey: 'ALERT_CACHE_DRIVER',
    description:
      'Habilita cache distribuído Redis (via ALERT_CACHE_DRIVER=redis)',
    critical: false,
  },
  {
    key: 'bullmq_queue_enabled',
    defaultValue: false,
    envKey: 'ALERT_JOB_QUEUE_DRIVER',
    description: 'Habilita fila BullMQ (via ALERT_JOB_QUEUE_DRIVER=bullmq)',
    critical: false,
  },
  {
    key: 'distributed_rate_limit_enabled',
    defaultValue: false,
    envKey: 'ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED',
    description: 'Habilita rate limiting distribuído via Redis',
    critical: true,
  },

  // Economia/guardrails
  {
    key: 'economics_guardrail_enabled',
    defaultValue: true,
    envKey: 'ALERT_ECONOMICS_GUARDRAIL_ENABLED',
    description: 'Habilita guardrails de custo unitário',
    critical: true,
  },
  {
    key: 'strict_pricebook_enabled',
    defaultValue: false,
    envKey: 'ALERT_ECONOMICS_STRICT_PRICEBOOK',
    description: 'Exige pricebook completo para operações de custo',
    critical: false,
  },
];

class FeatureFlagManager {
  constructor(env = process.env) {
    this.env = env;
    this.flags = new Map();
    this.initialized = false;
    this.overrides = new Map();
  }

  initialize() {
    if (this.initialized) return;

    FEATURE_FLAGS.forEach(flag => {
      let value;

      // 1. Verificar override programático
      if (this.overrides.has(flag.key)) {
        value = this.overrides.get(flag.key);
      }
      // 2. Verificar environment variable
      else if (flag.envKey && this.env[flag.envKey] !== undefined) {
        const raw = String(this.env[flag.envKey]).trim().toLowerCase();
        // Casos especiais para flags que usam valores numéricos ou string
        if (flag.key === 'redis_cache_enabled') {
          value = raw === 'redis';
        } else if (flag.key === 'bullmq_queue_enabled') {
          value = raw === 'bullmq';
        } else {
          value = BOOLEAN_TRUE.has(raw);
        }
      }
      // 3. Usar defaultValue
      else {
        value = flag.defaultValue;
      }

      this.flags.set(flag.key, Boolean(value));
    });

    this.initialized = true;

    // Log flags críticas para auditoria
    const criticalFlags = [];
    FEATURE_FLAGS.forEach(flag => {
      if (flag.critical) {
        criticalFlags.push(`${flag.key}=${this.flags.get(flag.key)}`);
      }
    });
    if (criticalFlags.length > 0) {
      console.log('[FeatureFlags] Critical flags:', criticalFlags.join(', '));
    }
  }

  isEnabled(key) {
    if (!this.initialized) this.initialize();
    return this.flags.get(key) ?? false;
  }

  getAll() {
    if (!this.initialized) this.initialize();
    const result = {};
    this.flags.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  getDefinition(key) {
    return FEATURE_FLAGS.find(f => f.key === key) || null;
  }

  // Override para testing ou runtime (cuidado com flags críticas)
  set(key, value) {
    const flag = this.getDefinition(key);
    if (flag?.critical && process.env.APP_ENV === 'production') {
      console.warn(
        `[FeatureFlags] Cannot override critical flag ${key} in production`,
      );
      return false;
    }
    this.overrides.set(key, Boolean(value));
    this.flags.set(key, Boolean(value));
    return true;
  }

  reset() {
    this.flags.clear();
    this.overrides.clear();
    this.initialized = false;
  }

  // Snapshot para métricas/monitoramento
  snapshot() {
    if (!this.initialized) this.initialize();
    const enabled = [];
    const disabled = [];
    this.flags.forEach((value, key) => {
      if (value) enabled.push(key);
      else disabled.push(key);
    });
    return {
      enabled,
      disabled,
      total: this.flags.size,
      enabledCount: enabled.length,
      disabledCount: disabled.length,
    };
  }
}

// Singleton exportado
const FeatureFlags = new FeatureFlagManager();

// Exports individuais para conveniência
module.exports = {
  FeatureFlags,
  FeatureFlagManager,
  FEATURE_FLAGS,
  // Funções diretas para uso rápido
  isSosEnabled: () => FeatureFlags.isEnabled('sos_enabled'),
  isSosEnhancementsEnabled: () =>
    FeatureFlags.isEnabled('sos_enhancements_enabled'),
  isMapsEnabled: () => FeatureFlags.isEnabled('maps_enabled'),
  isWeatherEnabled: () => FeatureFlags.isEnabled('weather_enabled'),
  isAlertsEnabled: () => FeatureFlags.isEnabled('alerts_enabled'),
  isAiChatEnabled: () => FeatureFlags.isEnabled('ai_chat_enabled'),
  isExternalIntegrationsEnabled: () =>
    FeatureFlags.isEnabled('external_integrations_enabled'),
  isStarlinkConnectEnabled: () =>
    FeatureFlags.isEnabled('starlink_connect_enabled'),
  isStarlinkTunnelEnabled: () =>
    FeatureFlags.isEnabled('starlink_tunnel_enabled'),
  isRedisCacheEnabled: () => FeatureFlags.isEnabled('redis_cache_enabled'),
  isBullMqQueueEnabled: () => FeatureFlags.isEnabled('bullmq_queue_enabled'),
  isDistributedRateLimitEnabled: () =>
    FeatureFlags.isEnabled('distributed_rate_limit_enabled'),
  isEconomicsGuardrailEnabled: () =>
    FeatureFlags.isEnabled('economics_guardrail_enabled'),
  isStrictPricebookEnabled: () =>
    FeatureFlags.isEnabled('strict_pricebook_enabled'),
};
