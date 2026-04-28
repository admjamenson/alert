const test = require('node:test');
const assert = require('node:assert/strict');

const { EventHubService } = require('../eventHub/EventHubService');
const {
  getRiskFeed,
  readRiskFeedTypes,
  __dangerousResetRiskFeedCacheForTests,
} = require('./RiskFeedService');

test.afterEach(() => {
  delete process.env.ALERT_RISK_FEED_TYPES;
  delete process.env.ALERT_RISK_FEED_TIMEOUT_MS;
  delete process.env.ALERT_RISK_FEED_CACHE_TTL_MS;
  delete process.env.ALERT_RISK_FEED_STALE_TTL_MS;
  __dangerousResetRiskFeedCacheForTests();
});

test('risk feed returns fail-soft payload for invalid location', async () => {
  const result = await getRiskFeed({
    latitude: 'not-a-number',
    longitude: 0,
  });

  assert.deepEqual(result.alerts, []);
  assert.equal(result.meta.hubAvailable, false);
  assert.equal(result.preAlert.reasonCodes[0], 'location_invalid');
});

test('risk feed times out provider fan-in instead of hanging the client', async () => {
  const original = EventHubService.getEvents;
  process.env.ALERT_RISK_FEED_TIMEOUT_MS = '500';
  EventHubService.getEvents = async () =>
    new Promise(resolve => {
      setTimeout(() => resolve({ events: [], providers: [], meta: {} }), 800);
    });

  try {
    const result = await getRiskFeed({
      latitude: -23.55,
      longitude: -46.63,
      radiusKm: 35,
      limit: 80,
    });

    assert.deepEqual(result.alerts, []);
    assert.equal(result.meta.degraded, true);
    assert.equal(result.meta.reason, 'risk_feed_timeout');
    assert.equal(result.preAlert.reasonCodes[0], 'risk_feed_timeout');
  } finally {
    EventHubService.getEvents = original;
    delete process.env.ALERT_RISK_FEED_TIMEOUT_MS;
  }
});

test('risk feed reuses a hot cached payload before re-entering provider fan-in', async () => {
  const original = EventHubService.getEvents;
  let calls = 0;
  EventHubService.getEvents = async () => {
    calls += 1;
    return {
      events: [
        {
          id: 'storm-1',
          type: 'storm',
          updatedAt: '2026-04-27T12:00:00.000Z',
          severity: 'Severe',
          source: { name: 'GDACS', trustTier: 'B' },
          geometry: { coordinates: [-46.63, -23.55] },
          recommendedActions: ['Fique atento'],
        },
      ],
      providers: [],
      meta: {},
    };
  };

  try {
    const first = await getRiskFeed({
      latitude: -23.55,
      longitude: -46.63,
      radiusKm: 35,
      limit: 80,
    });
    const second = await getRiskFeed({
      latitude: -23.55,
      longitude: -46.63,
      radiusKm: 35,
      limit: 80,
    });

    assert.equal(calls, 1);
    assert.equal(first.meta.cacheHit, false);
    assert.equal(second.meta.cacheHit, true);
    assert.equal(second.meta.cacheLayer, 'risk_feed');
    assert.equal(second.alerts.length, 1);
  } finally {
    EventHubService.getEvents = original;
  }
});

test('risk feed serves stale cached payload when provider fan-in times out after cache expiry', async () => {
  const original = EventHubService.getEvents;
  process.env.ALERT_RISK_FEED_TIMEOUT_MS = '80';
  process.env.ALERT_RISK_FEED_CACHE_TTL_MS = '250';
  process.env.ALERT_RISK_FEED_STALE_TTL_MS = '60000';
  let calls = 0;
  EventHubService.getEvents = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        events: [
          {
            id: 'flood-1',
            type: 'flood',
            updatedAt: '2026-04-27T12:00:00.000Z',
            severity: 'Severe',
            source: { name: 'GDACS', trustTier: 'B' },
            geometry: { coordinates: [-46.63, -23.55] },
            recommendedActions: ['Suba para uma area segura'],
          },
        ],
        providers: [],
        meta: {},
      };
    }
    return new Promise(resolve => {
      setTimeout(() => resolve({ events: [], providers: [], meta: {} }), 800);
    });
  };

  try {
    const first = await getRiskFeed({
      latitude: 48.8566,
      longitude: 2.3522,
      radiusKm: 35,
      limit: 80,
    });
    await new Promise(resolve => setTimeout(resolve, 550));
    const second = await getRiskFeed({
      latitude: 48.8566,
      longitude: 2.3522,
      radiusKm: 35,
      limit: 80,
    });

    assert.equal(first.alerts.length, 1);
    assert.equal(second.alerts.length, 1);
    assert.equal(second.meta.reason, 'risk_feed_stale_revalidate');
    assert.equal(second.meta.stale, true);
    assert.equal(second.meta.cacheHit, true);
    assert.deepEqual(second.preAlert.reasonCodes, ['risk_feed_stale_revalidate']);
  } finally {
    EventHubService.getEvents = original;
  }
});

test('risk feed returns stale payload immediately and refreshes in background after cache expiry', async () => {
  const original = EventHubService.getEvents;
  process.env.ALERT_RISK_FEED_TIMEOUT_MS = '500';
  process.env.ALERT_RISK_FEED_CACHE_TTL_MS = '250';
  process.env.ALERT_RISK_FEED_STALE_TTL_MS = '60000';
  let calls = 0;
  EventHubService.getEvents = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        events: [
          {
            id: 'storm-2',
            type: 'storm',
            updatedAt: '2026-04-27T12:00:00.000Z',
            severity: 'Severe',
            source: { name: 'GDACS', trustTier: 'B' },
            geometry: { coordinates: [-46.63, -23.55] },
            recommendedActions: ['Fique atento'],
          },
        ],
        providers: [],
        meta: {},
      };
    }
    return new Promise(resolve => {
      setTimeout(
        () =>
          resolve({
            events: [],
            providers: [],
            meta: {},
          }),
        800,
      );
    });
  };

  try {
    await getRiskFeed({
      latitude: -23.55,
      longitude: -46.63,
      radiusKm: 35,
      limit: 80,
    });
    await new Promise(resolve => setTimeout(resolve, 550));

    const startedAt = Date.now();
    const second = await getRiskFeed({
      latitude: -23.55,
      longitude: -46.63,
      radiusKm: 35,
      limit: 80,
    });
    const durationMs = Date.now() - startedAt;

    assert.equal(second.alerts.length, 1);
    assert.equal(second.meta.reason, 'risk_feed_stale_revalidate');
    assert.equal(second.meta.stale, true);
    assert.equal(second.meta.refreshing, true);
    assert.equal(durationMs < 300, true);
  } finally {
    EventHubService.getEvents = original;
  }
});

test('risk feed limits hot-path provider fan-in to immediate risk event types', async () => {
  const original = EventHubService.getEvents;
  let capturedTypes = null;
  EventHubService.getEvents = async query => {
    capturedTypes = String(query?.types || '');
    return {
      events: [],
      providers: [],
      meta: {},
    };
  };

  try {
    await getRiskFeed({
      latitude: 40.7128,
      longitude: -74.006,
      radiusKm: 35,
      limit: 80,
    });

    assert.equal(capturedTypes, readRiskFeedTypes().join(','));
    assert.equal(capturedTypes.includes('pandemic'), false);
    assert.equal(capturedTypes.includes('epidemic'), false);
  } finally {
    EventHubService.getEvents = original;
  }
});
