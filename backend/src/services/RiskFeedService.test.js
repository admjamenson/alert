const test = require('node:test');
const assert = require('node:assert/strict');

const { EventHubService } = require('../eventHub/EventHubService');
const { getRiskFeed } = require('./RiskFeedService');

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
