'use strict';

/**
 * RedisRateLimiter - Rate Limiter Distribuído (FAANG Fase 3)
 *
 * Implementa rate limiting distribuído via Redis para escalar horizontalmente.
 * Usa algoritmo sliding window log para precisão e eficiência.
 *
 * Fallback automático para InMemoryRateLimiter quando Redis não está disponível.
 *
 * SEGURANÇA:
 * - Previne abuso de APIs críticas (SOS, relay, billing)
 * - Funciona em cluster com consistência eventual aceitável
 * - Fallback seguro em memória quando Redis indisponível
 */

const loadRedis = () => {
  try {
    return require('redis');
  } catch (error) {
    const wrapped = new Error('redis_dependency_missing');
    wrapped.cause = error;
    throw wrapped;
  }
};

/**
 * Resolve Redis URL para rate limiter
 * Prioridade: ALERT_RATE_LIMIT_REDIS_URL > ALERT_REDIS_URL
 */
const resolveRedisUrl = (env = process.env) => {
  if (env.ALERT_RATE_LIMIT_REDIS_URL) {
    return {
      url: String(env.ALERT_RATE_LIMIT_REDIS_URL).trim(),
      source: 'ALERT_RATE_LIMIT_REDIS_URL',
    };
  }
  if (env.ALERT_REDIS_URL) {
    return {
      url: String(env.ALERT_REDIS_URL).trim(),
      source: 'ALERT_REDIS_URL',
    };
  }
  return {url: '', source: null};
};

/**
 * InMemoryRateLimiter - Fallback quando Redis não está disponível
 * NÃO escala horizontalmente, mas mantém funcionalidade básica
 */
class InMemoryRateLimiter {
  constructor({windowMs = 60000, maxRequests = 100, logger = console} = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.logger = logger;
    this.windows = new Map();
    this.metrics = {
      checks: 0,
      allowed: 0,
      rejected: 0,
      evictions: 0,
    };

    // Limpeza periódica de janelas expiradas
    this.cleanupInterval = setInterval(
      () => this._cleanup(),
      Math.min(windowMs, 60000),
    );
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref(); // Não impede shutdown do processo
    }
  }

  _cleanup() {
    const now = Date.now();
    let evicted = 0;
    for (const [key, window] of this.windows.entries()) {
      if (now - window.start > this.windowMs * 2) {
        this.windows.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.metrics.evictions += evicted;
    }
  }

  /**
   * Verifica se request é permitido
   * @param {string} key - Identificador único (ex: userId:endpoint)
   * @returns {boolean} true se permitido, false se rate limited
   */
  isAllowed(key) {
    this.metrics.checks++;
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || now - window.start > this.windowMs) {
      // Nova janela
      this.windows.set(key, {start: now, count: 1});
      this.metrics.allowed++;
      return true;
    }

    // Dentro da janela atual
    window.count++;
    if (window.count > this.maxRequests) {
      this.metrics.rejected++;
      return false;
    }

    this.metrics.allowed++;
    return true;
  }

  /**
   * Versão async para compatibilidade com RedisRateLimiter
   */
  async isAllowedAsync(key) {
    return this.isAllowed(key);
  }

  /**
   * Reseta contador para uma key
   */
  reset(key) {
    this.windows.delete(key);
  }

  /**
   * Snapshot de métricas
   */
  snapshot() {
    return {
      driver: 'memory',
      external: false,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      activeWindows: this.windows.size,
      ...this.metrics,
    };
  }

  /**
   * Limpa recursos
   */
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.windows.clear();
  }
}

/**
 * RedisRateLimiter - Rate limiter distribuído via Redis
 * Usa sliding window log com precisão de milissegundos
 */
class RedisRateLimiter {
  constructor({
    windowMs = 60000,
    maxRequests = 100,
    url,
    urlSource,
    client,
    createClient,
    prefix = 'alert:ratelimit',
    logger = console,
    connectTimeoutMs = 2500,
  } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.prefix = prefix;
    this.logger = logger;
    this.urlSource = urlSource;

    this.metrics = {
      checks: 0,
      allowed: 0,
      rejected: 0,
      errors: 0,
      fallbacks: 0,
    };

    // Fallback in-memory em caso de erro Redis
    this.fallback = new InMemoryRateLimiter({windowMs, maxRequests, logger});

    // Setup Redis client
    const redisReconnectStrategy = retries =>
      Math.min(250 + retries * 100, 2500);
    const redisFactory =
      createClient || (!client ? loadRedis().createClient : null);

    this.client =
      client ||
      redisFactory({
        url,
        socket: {
          connectTimeout: Math.max(500, Number(connectTimeoutMs || 2500)),
          reconnectStrategy: redisReconnectStrategy,
        },
      });

    this.connected = false;
    this.connectionPromise = null;
  }

  async _ensureConnected() {
    if (this.connected) return true;

    try {
      if (!this.connectionPromise) {
        this.connectionPromise = (async () => {
          if (typeof this.client.connect === 'function') {
            await this.client.connect();
          }
          this.connected = this.client.isOpen || this.client.connected || false;
          return this.connected;
        })();
      }
      await this.connectionPromise;
      return this.connected;
    } catch (error) {
      this.logger.warn?.(
        '[RedisRateLimiter] Connection failed, using fallback',
        {
          error: error?.message,
        },
      );
      return false;
    }
  }

  /**
   * Verifica se request é permitido (versão async)
   * @param {string} key - Identificador único
   * @returns {Promise<boolean>} true se permitido
   */
  async isAllowedAsync(key) {
    this.metrics.checks++;

    try {
      const connected = await this._ensureConnected();
      if (!connected) {
        this.metrics.fallbacks++;
        return this.fallback.isAllowed(key);
      }

      const redisKey = `${this.prefix}:${key}`;
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Remove entries fora da janela atual
      await this.client.zRemRangeByScore(redisKey, 0, windowStart);

      // Conta requests na janela atual
      const currentCount = await this.client.zCard(redisKey);

      if (currentCount >= this.maxRequests) {
        this.metrics.rejected++;
        return false;
      }

      // Adiciona novo request
      await this.client.zAdd(redisKey, {
        score: now,
        value: `${now}:${Math.random()}`,
      });

      // Define TTL para limpeza automática
      await this.client.expire(redisKey, Math.ceil(this.windowMs / 1000) + 1);

      this.metrics.allowed++;
      return true;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('[RedisRateLimiter] Error, using fallback', {
        error: error?.message,
      });
      this.metrics.fallbacks++;
      return this.fallback.isAllowed(key);
    }
  }

  /**
   * Versão síncrona (não recomendada, usa fallback)
   */
  isAllowed(key) {
    return this.fallback.isAllowed(key);
  }

  /**
   * Reseta contador para uma key
   */
  async reset(key) {
    try {
      const redisKey = `${this.prefix}:${key}`;
      await this.client.del(redisKey);
    } catch (error) {
      this.logger.warn?.('[RedisRateLimiter] Reset failed', {
        error: error?.message,
      });
    }
    this.fallback.reset(key);
  }

  /**
   * Snapshot de métricas
   */
  snapshot() {
    return {
      driver: 'redis',
      external: true,
      urlSource: this.urlSource,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      connected: this.connected,
      ...this.metrics,
      fallback: this.fallback.snapshot(),
    };
  }

  /**
   * Limpa recursos
   */
  async close() {
    this.fallback.close();
    if (typeof this.client.quit === 'function') {
      await this.client.quit();
    }
  }
}

/**
 * Factory para criar rate limiter apropriado
 * Retorna RedisRateLimiter se Redis disponível, senão InMemoryRateLimiter
 */
const createRateLimiter = (options = {}, env = process.env) => {
  const distributedEnabled = String(
    env.ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED || '',
  )
    .trim()
    .toLowerCase();

  if (distributedEnabled !== 'true' && distributedEnabled !== '1') {
    // Rate limiter em memória (default)
    return new InMemoryRateLimiter(options);
  }

  // Tentar Redis rate limiter
  const resolved = resolveRedisUrl(env);
  if (!resolved.url) {
    console.warn(
      '[RedisRateLimiter] ALERT_DISTRIBUTED_RATE_LIMIT_ENABLED=true but no Redis URL configured; falling back to memory',
    );
    return new InMemoryRateLimiter(options);
  }

  try {
    return new RedisRateLimiter({
      ...options,
      url: resolved.url,
      urlSource: resolved.source,
    });
  } catch (error) {
    console.warn(
      '[RedisRateLimiter] Failed to create Redis limiter, falling back to memory',
      {error: error?.message},
    );
    return new InMemoryRateLimiter(options);
  }
};

module.exports = {
  InMemoryRateLimiter,
  RedisRateLimiter,
  createRateLimiter,
  resolveRedisUrl,
};
