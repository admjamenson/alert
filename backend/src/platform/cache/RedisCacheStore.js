const loadRedis = () => {
  try {
    return require('redis');
  } catch (error) {
    const wrapped = new Error('redis_dependency_missing');
    wrapped.cause = error;
    throw wrapped;
  }
};

const createRedisCacheStore = ({
  name = 'redis',
  url = process.env.ALERT_CACHE_REDIS_URL || process.env.ALERT_REDIS_URL,
  urlSource = process.env.ALERT_CACHE_REDIS_URL
    ? 'ALERT_CACHE_REDIS_URL'
    : 'ALERT_REDIS_URL',
  prefix = process.env.ALERT_CACHE_KEY_PREFIX || 'alert',
  client,
  createClient,
  connectTimeoutMs = Number(process.env.ALERT_REDIS_CONNECT_TIMEOUT_MS || 2500),
  reconnectStrategy,
} = {}) => {
  const redisReconnectStrategy =
    reconnectStrategy === undefined
      ? retries => Math.min(250 + retries * 100, 2500)
      : reconnectStrategy;
  const redisFactory = createClient || (!client ? loadRedis().createClient : null);
  const redisClient =
    client ||
    redisFactory({
      url,
      socket: {
        connectTimeout: Math.max(500, Number(connectTimeoutMs || 2500)),
        reconnectStrategy: redisReconnectStrategy,
      },
    });
  const metrics = {
    name,
    driver: 'redis',
    get: 0,
    hit: 0,
    miss: 0,
    set: 0,
    delete: 0,
    errors: 0,
  };

  const keyFor = key => `${prefix}:${String(key || '').trim()}`;

  const ensureConnected = async () => {
    if (redisClient.isOpen || redisClient.connected) return;
    if (typeof redisClient.connect === 'function') {
      await redisClient.connect();
    }
  };

  const getJson = async key => {
    metrics.get += 1;
    try {
      await ensureConnected();
      const raw = await redisClient.get(keyFor(key));
      if (!raw) {
        metrics.miss += 1;
        return null;
      }
      metrics.hit += 1;
      return JSON.parse(raw);
    } catch (error) {
      metrics.errors += 1;
      throw error;
    }
  };

  const setJson = async (key, value, ttlMs = 0) => {
    if (!Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) return false;
    try {
      await ensureConnected();
      await redisClient.set(keyFor(key), JSON.stringify(value), {
        PX: Math.max(1, Math.round(Number(ttlMs))),
      });
      metrics.set += 1;
      return true;
    } catch (error) {
      metrics.errors += 1;
      throw error;
    }
  };

  const deleteKey = async key => {
    try {
      await ensureConnected();
      await redisClient.del(keyFor(key));
      metrics.delete += 1;
      return true;
    } catch (error) {
      metrics.errors += 1;
      throw error;
    }
  };

  const snapshot = () => ({
    ...metrics,
    external: true,
    prefix,
    urlSource,
    connected: Boolean(redisClient.isOpen || redisClient.connected),
  });

  const close = async () => {
    if (typeof redisClient.quit === 'function') {
      await redisClient.quit();
    }
  };

  return {
    getJson,
    setJson,
    delete: deleteKey,
    snapshot,
    close,
  };
};

module.exports = {
  createRedisCacheStore,
};
