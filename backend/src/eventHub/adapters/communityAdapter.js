const { createUnifiedEvent, nowIso, toIso } = require('../utils');

const SOS_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const CLUSTER_BUCKET_MS = 5 * 60 * 1000;
const MIN_CLUSTER_REPORTS = 2;
const GRID_DECIMALS = 2; // ~1.1km latitude blur

const toCell = (lat, lon) =>
  `${Number(lat).toFixed(GRID_DECIMALS)}:${Number(lon).toFixed(GRID_DECIMALS)}`;

const fetchCommunityEvents = async ({ bbox, provider, db, sosPublicOptIn }) => {
  const startedAt = Date.now();

  if (!sosPublicOptIn) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'unavailable',
        reason: 'sos_public_opt_in_disabled',
      },
    };
  }

  if (!db) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: 'firestore_unavailable',
      },
    };
  }

  try {
    const snapshot = await db
      .collection('relay_sos')
      .orderBy('createdAt', 'desc')
      .limit(250)
      .get();

    const nowMs = Date.now();
    const clusters = new Map();

    snapshot.docs.forEach(doc => {
      const row = doc.data() || {};
      const createdAt = toIso(row?.createdAt || row?.payload?.createdAt) || nowIso();
      const createdAtMs = new Date(createdAt).getTime();
      if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > SOS_LOOKBACK_MS) return;

      const lat = Number(row?.payload?.location?.latitude);
      const lon = Number(row?.payload?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      if (bbox) {
        if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLon || lon > bbox.maxLon) {
          return;
        }
      }

      const cell = toCell(lat, lon);
      const bucket = Math.floor(createdAtMs / CLUSTER_BUCKET_MS);
      const key = `${cell}:${bucket}`;
      const userId = String(row.userId || '');

      const prev = clusters.get(key);
      if (!prev) {
        clusters.set(key, {
          lat: Number(lat.toFixed(GRID_DECIMALS)),
          lon: Number(lon.toFixed(GRID_DECIMALS)),
          latestAt: createdAt,
          count: 1,
          users: new Set(userId ? [userId] : []),
        });
        return;
      }

      prev.count += 1;
      if (userId) prev.users.add(userId);
      if (new Date(createdAt).getTime() > new Date(prev.latestAt).getTime()) {
        prev.latestAt = createdAt;
      }
      clusters.set(key, prev);
    });

    const events = Array.from(clusters.entries())
      .filter(([, cluster]) => cluster.count >= MIN_CLUSTER_REPORTS && cluster.users.size >= 1)
      .map(([key, cluster]) => {
        const severity = cluster.count >= 4 ? 'Extreme' : 'Severe';
        return createUnifiedEvent({
          id: `sos:${key}`,
          type: 'sos',
          subtype: 'community_cluster',
          severity,
          urgency: 'Immediate',
          certainty: 'Observed',
          confidence: cluster.count >= 4 ? 0.92 : 0.78,
          startTime: cluster.latestAt,
          updatedAt: cluster.latestAt,
          geometry: {
            type: 'point',
            coordinates: [cluster.lon, cluster.lat],
          },
          source: {
            name: 'Alert SOS Network',
            trustTier: provider.trustTier,
            sourceClass: provider.sourceClass,
            sourceAuthority: provider.sourceAuthority,
          },
          recommendedActions: [
            'Avoid the area and choose an alternate route.',
            'Use SOS if you are in immediate danger.',
          ],
          privacyLevel: 'aggregated',
        });
      });

    return {
      events,
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: true,
        stale: false,
        status: 'online',
        eventCount: events.length,
      },
    };
  } catch (error) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: String(error?.message || 'community_fetch_error'),
      },
    };
  }
};

module.exports = {
  fetchCommunityEvents,
};
