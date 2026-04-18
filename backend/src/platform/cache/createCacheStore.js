const { createInMemoryCacheStore } = require('./InMemoryCacheStore');
const { createRedisCacheStore } = require('./RedisCacheStore');

const createCacheStore = (options = {}) => {
  const driver = String(
    options.driver || process.env.ALERT_CACHE_DRIVER || 'memory',
  )
    .trim()
    .toLowerCase();

  if (driver === 'redis') {
    const url = String(options.url || process.env.ALERT_REDIS_URL || '').trim();
    if (!url && process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true') {
      throw new Error('redis_cache_url_required');
    }
    return createRedisCacheStore(options);
  }

  if (driver !== 'memory') {
    throw new Error(`unsupported_cache_driver:${driver}`);
  }

  return createInMemoryCacheStore(options);
};

module.exports = {
  createCacheStore,
};
