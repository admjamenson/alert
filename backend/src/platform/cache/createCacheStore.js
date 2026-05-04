const { createInMemoryCacheStore } = require('./InMemoryCacheStore');
const { createRedisCacheStore } = require('./RedisCacheStore');

const resolveCacheRedisUrl = (options = {}, env = process.env) => {
  if (options.url) {
    return { url: String(options.url).trim(), source: 'options.url' };
  }
  if (env.ALERT_CACHE_REDIS_URL) {
    return {
      url: String(env.ALERT_CACHE_REDIS_URL).trim(),
      source: 'ALERT_CACHE_REDIS_URL',
    };
  }
  if (env.ALERT_REDIS_URL) {
    return { url: String(env.ALERT_REDIS_URL).trim(), source: 'ALERT_REDIS_URL' };
  }
  return { url: '', source: null };
};

const createCacheStore = (options = {}) => {
  const driver = String(
    options.driver || process.env.ALERT_CACHE_DRIVER || 'memory',
  )
    .trim()
    .toLowerCase();

  if (driver === 'redis') {
    const resolved = resolveCacheRedisUrl(options);
    const url = resolved.url;
    if (!url && process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true') {
      throw new Error('redis_cache_url_required:ALERT_CACHE_REDIS_URL_or_ALERT_REDIS_URL');
    }
    return createRedisCacheStore({
      ...options,
      url,
      urlSource: resolved.source,
    });
  }

  if (driver !== 'memory') {
    throw new Error(`unsupported_cache_driver:${driver}`);
  }

  return createInMemoryCacheStore(options);
};

module.exports = {
  createCacheStore,
  resolveCacheRedisUrl,
};
