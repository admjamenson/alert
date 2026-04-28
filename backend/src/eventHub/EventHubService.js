const {
  EVENT_TYPE_TO_PROVIDER_IDS,
  PROVIDER_REGISTRY,
} = require('./providerRegistry');
const {
  bboxContainsPoint,
  bboxIntersects,
  dedupeUnifiedEvents,
  parseBbox,
  sanitizeTypesFilter,
  sortByRiskAndFreshness,
  toMillis,
  nowIso,
} = require('./utils');
const { fetchGeophysicalEvents } = require('./adapters/geophysicalAdapter');
const { fetchMeteoGdacsEvents, fetchMeteoNowcastEvents } = require('./adapters/meteoAdapter');
const { fetchHealthEvents } = require('./adapters/healthAdapter');
const { fetchCommunityEvents } = require('./adapters/communityAdapter');
const { fetchInfrastructureEvents } = require('./adapters/infrastructureAdapter');
const { createCacheStore } = require('../platform/cache/createCacheStore');

const EVENTS_CACHE = new Map();
const INFLIGHT_EVENTS = new Map();
const LAST_PROVIDER_STATUS = new Map();
let CONFIGURED_EVENTS_CACHE = null;
let CONFIGURED_EVENTS_CACHE_ERROR = null;

const cacheKeyForEvents = params =>
  JSON.stringify({
    bbox: params.bbox || null,
    types: [...(params.types || [])].sort(),
    since: params.since || '',
    country: params.country || '',
    sosPublicOptIn: Boolean(params.sosPublicOptIn),
    limit: Number(params.limit || 120),
  });

const getConfiguredEventsCache = () => {
  if (CONFIGURED_EVENTS_CACHE || CONFIGURED_EVENTS_CACHE_ERROR) {
    return CONFIGURED_EVENTS_CACHE;
  }
  try {
    CONFIGURED_EVENTS_CACHE = createCacheStore({
      name: 'event-hub',
      prefix: process.env.ALERT_EVENT_CACHE_KEY_PREFIX || 'alert:event-hub',
    });
  } catch (error) {
    CONFIGURED_EVENTS_CACHE_ERROR = error;
    if (process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true') {
      throw error;
    }
  }
  return CONFIGURED_EVENTS_CACHE;
};

const readMemoryEventsCache = key => {
  const row = EVENTS_CACHE.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    EVENTS_CACHE.delete(key);
    return null;
  }
  return row.value;
};

const writeMemoryEventsCache = (key, ttlMs, value) => {
  EVENTS_CACHE.set(key, {
    value,
    expiresAt: Date.now() + Math.max(5000, Number(ttlMs || 15_000)),
  });
};

const snapshotCacheStore = cacheStore => {
  try {
    return typeof cacheStore?.snapshot === 'function' ? cacheStore.snapshot() : null;
  } catch (_error) {
    return null;
  }
};

const readEventsCache = async (key, deps = {}) => {
  const cacheStore = deps.cacheStore || getConfiguredEventsCache();
  if (cacheStore && typeof cacheStore.getJson === 'function') {
    try {
      const cached = await cacheStore.getJson(key);
      if (cached) {
        return {
          value: cached,
          source: snapshotCacheStore(cacheStore)?.driver || 'external',
        };
      }
    } catch (error) {
      if (deps.logger?.warn) {
        deps.logger.warn('[event-hub/cache] external cache read failed', {
          error: error?.message || String(error),
        });
      }
    }
  }

  const cached = readMemoryEventsCache(key);
  return cached ? { value: cached, source: 'memory' } : null;
};

const writeEventsCache = async (key, ttlMs, value, deps = {}) => {
  const cacheStore = deps.cacheStore || getConfiguredEventsCache();
  if (cacheStore && typeof cacheStore.setJson === 'function') {
    try {
      await cacheStore.setJson(key, value, ttlMs);
      return snapshotCacheStore(cacheStore)?.driver || 'external';
    } catch (error) {
      if (deps.logger?.warn) {
        deps.logger.warn('[event-hub/cache] external cache write failed', {
          error: error?.message || String(error),
        });
      }
    }
  }

  writeMemoryEventsCache(key, ttlMs, value);
  return 'memory';
};

const providerForId = id => PROVIDER_REGISTRY[id] || null;

const resolveProviderIds = types => {
  if (!types || types.length === 0) {
    return Object.keys(PROVIDER_REGISTRY);
  }
  const ids = new Set();
  types.forEach(type => {
    const providerIds = EVENT_TYPE_TO_PROVIDER_IDS[type];
    if (Array.isArray(providerIds)) {
      providerIds.forEach(id => ids.add(id));
    }
  });
  return Array.from(ids);
};

const normalizeProviderIdsOverride = value =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map(item => String(item || '').trim())
            .filter(item => item && providerForId(item)),
        ),
      )
    : null;

const updateProviderStatus = status => {
  if (!status?.providerId) return;
  LAST_PROVIDER_STATUS.set(status.providerId, {
    ...status,
    updatedAt: nowIso(),
  });
};

const filterEvents = ({ events, bbox, types, since }) => {
  const sinceMs = since ? toMillis(since) : 0;
  return events.filter(event => {
    if (!event || typeof event !== 'object') return false;
    if (types && types.length > 0 && !types.includes(String(event.type || '').toLowerCase())) {
      return false;
    }
    if (sinceMs > 0) {
      const updatedAtMs = toMillis(event.updatedAt || event.startTime);
      if (updatedAtMs <= 0 || updatedAtMs < sinceMs) return false;
    }
    if (!bbox) return true;

    const lon = Number(event?.geometry?.coordinates?.[0]);
    const lat = Number(event?.geometry?.coordinates?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return bboxContainsPoint(bbox, lat, lon);
    }
    const eventBbox = event?.bbox && typeof event.bbox === 'object' ? event.bbox : null;
    return bboxIntersects(bbox, eventBbox);
  });
};

const selectAdapterCalls = ({ providerIds, bbox, since, country, db, sosPublicOptIn }) =>
  providerIds
    .map(providerId => {
      const provider = providerForId(providerId);
      if (!provider) return null;
      if (provider.adapterName === 'geophysicalAdapter') {
        return fetchGeophysicalEvents({ bbox, since, provider });
      }
      if (provider.adapterName === 'meteoGdacsAdapter') {
        return fetchMeteoGdacsEvents({ bbox, provider });
      }
      if (provider.adapterName === 'meteoNowcastAdapter') {
        return fetchMeteoNowcastEvents({ bbox, provider });
      }
      if (provider.adapterName === 'healthAdapter') {
        return fetchHealthEvents({ bbox, country, provider });
      }
      if (provider.adapterName === 'communityAdapter') {
        return fetchCommunityEvents({ bbox, provider, db, sosPublicOptIn });
      }
      if (provider.adapterName === 'infrastructureAdapter') {
        return fetchInfrastructureEvents({ provider });
      }
      return null;
    })
    .filter(Boolean);

const normalizeStatusOutput = status => {
  const provider = providerForId(status.providerId) || {};
  return {
    providerId: status.providerId,
    adapterName: status.adapterName || provider.adapterName || null,
    primaryProvider: status.primaryProvider || provider.primaryProvider || null,
    fallbackProvider: status.fallbackProvider || provider.fallbackProvider || null,
    sourceClass: status.sourceClass || provider.sourceClass || 'reference',
    sourceAuthority: Number(status.sourceAuthority || provider.sourceAuthority || 0),
    coverage: status.coverage || provider.coverage || null,
    updateCadence: status.updateCadence || provider.updateCadence || null,
    latencyBudgetMs: Number(status.latencyBudgetMs || provider.latencyBudgetMs || 0),
    trustTier: status.trustTier || provider.trustTier || 'C',
    cacheTTLms: Number(status.cacheTTLms || provider.cacheTTLms || 0),
    licenseNotes: provider.licenseNotes || null,
    rateLimitPolicy: provider.rateLimitPolicy || null,
    supportedEventTypes: Array.isArray(provider.supportedEventTypes)
      ? provider.supportedEventTypes
      : [],
    status: status.status,
    ok: Boolean(status.ok),
    stale: Boolean(status.stale),
    reason: status.reason || null,
    latencyMs: Number(status.latencyMs || 0),
    eventCount: Number(status.eventCount || 0),
    lastFetchAt: status.lastFetchAt || nowIso(),
  };
};

const buildDefaultProviderStatus = provider => ({
  providerId: provider.id,
  adapterName: provider.adapterName,
  primaryProvider: provider.primaryProvider,
  fallbackProvider: provider.fallbackProvider,
  sourceClass: provider.sourceClass || 'reference',
  sourceAuthority: Number(provider.sourceAuthority || 0),
  coverage: provider.coverage,
  updateCadence: provider.updateCadence,
  latencyBudgetMs: provider.latencyBudgetMs,
  trustTier: provider.trustTier,
  cacheTTLms: provider.cacheTTLms,
  status: 'unknown',
  ok: false,
  stale: true,
  reason: 'provider_not_called_yet',
  latencyMs: 0,
  eventCount: 0,
  lastFetchAt: nowIso(),
});

const EventHubService = {
  async getEvents(query, deps = {}) {
    const startedAt = Date.now();
    const bbox = parseBbox(query.bbox);
    const types = sanitizeTypesFilter(query.types);
    const since = query.since || '';
    const country = String(query.country || '').toUpperCase() || '';
    const sosPublicOptIn =
      query.sosPublicOptIn === true ||
      query.sosPublicOptIn === 'true' ||
      String(query.sosPublicOptIn || '') === '1';
    const limit = Math.max(1, Math.min(250, Number(query.limit || 120)));
    const providerIds =
      normalizeProviderIdsOverride(deps.providerIdsOverride) ||
      resolveProviderIds(types);

    const cacheKey = cacheKeyForEvents({
      bbox,
      types,
      since,
      country,
      sosPublicOptIn,
      limit,
    });
    const cached = await readEventsCache(cacheKey, deps);
    if (cached) {
      return {
        ...cached.value,
        meta: {
          ...cached.value.meta,
          cacheHit: true,
          cacheDriver: cached.source,
          coalesced: false,
          generatedAt: nowIso(),
        },
      };
    }

    const existing = INFLIGHT_EVENTS.get(cacheKey);
    if (existing) {
      const payload = await existing;
      return {
        ...payload,
        meta: {
          ...payload.meta,
          cacheHit: false,
          cacheDriver: null,
          coalesced: true,
          generatedAt: nowIso(),
        },
      };
    }

    const request = (async () => {
      const calls = selectAdapterCalls({
        providerIds,
        bbox,
        since,
        country,
        db: deps.db,
        sosPublicOptIn,
      });

      const settled = await Promise.allSettled(calls);
      const events = [];
      const providerStatuses = [];
      let healthTop = [];
      let resolvedCountry = country || null;

      settled.forEach(item => {
        if (item.status !== 'fulfilled') return;
        const value = item.value || {};
        if (Array.isArray(value.events)) {
          events.push(...value.events);
        }
        if (Array.isArray(value.top3)) {
          healthTop = value.top3;
        }
        if (value.countryCode && !resolvedCountry) {
          resolvedCountry = value.countryCode;
        }
        if (value.status) {
          providerStatuses.push(normalizeStatusOutput(value.status));
          updateProviderStatus(value.status);
        }
      });

      const filtered = filterEvents({ events, bbox, types, since });
      const deduped = dedupeUnifiedEvents(filtered);
      const sorted = sortByRiskAndFreshness(deduped).slice(0, limit);
      const payload = {
        events: sorted,
        healthTop,
        meta: {
          generatedAt: nowIso(),
          latencyMs: Date.now() - startedAt,
          count: sorted.length,
          cacheHit: false,
          cacheDriver: null,
          coalesced: false,
          failClosed: true,
          bbox: bbox || null,
          types,
          since: since || null,
          country: resolvedCountry,
        },
        providers: providerStatuses,
      };

      const maxTtlMs = providerStatuses
        .map(status => Number(status.cacheTTLms || 0))
        .filter(value => value > 0)
        .sort((a, b) => a - b)[0] || 12_000;
      const cacheDriver = await writeEventsCache(cacheKey, maxTtlMs, payload, deps);
      payload.meta.cacheDriver = cacheDriver;
      return payload;
    })();

    INFLIGHT_EVENTS.set(cacheKey, request);
    try {
      return await request;
    } finally {
      INFLIGHT_EVENTS.delete(cacheKey);
    }
  },

  async getHealthTop(query, deps = {}) {
    const response = await this.getEvents(
      {
        ...query,
        types: 'pandemic,epidemic',
        limit: 20,
      },
      deps,
    );

    const top = Array.isArray(response.healthTop) ? response.healthTop : [];
    return {
      items: top,
      meta: {
        generatedAt: nowIso(),
        count: top.length,
        bbox: parseBbox(query.bbox),
        country: String(query.country || '').toUpperCase() || response.meta?.country || null,
      },
      providers: response.providers,
    };
  },

  getProvidersStatus() {
    const providers = Object.values(PROVIDER_REGISTRY).map(provider => {
      const last = LAST_PROVIDER_STATUS.get(provider.id);
      if (!last) return buildDefaultProviderStatus(provider);
      return normalizeStatusOutput(last);
    });
    return {
      providers,
      generatedAt: nowIso(),
    };
  },
};

module.exports = {
  EventHubService,
};
