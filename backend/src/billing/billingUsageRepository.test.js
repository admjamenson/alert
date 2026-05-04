const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recordRoutingUsage,
  recordWeatherUsage,
  readBillingUsageSnapshot,
  readOperationalUnitCostSnapshots,
  readPlatformAllocationSnapshot,
} = require('./billingUsageRepository');
const { loadOperationalPriceBook } = require('../economics/priceBook');

const clone = value => JSON.parse(JSON.stringify(value));

const mergeDocs = (current, next) => ({
  ...(current || {}),
  ...(next || {}),
});

const createDocSnapshot = (id, data) => ({
  id,
  exists: typeof data !== 'undefined',
  data: () => clone(data),
});

const createFakeDb = (seed = {}) => {
  const collections = new Map(
    Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(clone(docs)))]),
  );

  const ensureCollection = name => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  };

  const buildDocRef = (collectionName, docId) => ({
    id: docId,
    async get() {
      const collection = ensureCollection(collectionName);
      return createDocSnapshot(docId, collection.get(docId));
    },
    async set(value, options = {}) {
      const collection = ensureCollection(collectionName);
      const current = collection.get(docId);
      collection.set(
        docId,
        options?.merge ? mergeDocs(current, value) : clone(value),
      );
    },
  });

  return {
    collection(name) {
      return {
        doc(docId) {
          return buildDocRef(name, docId);
        },
        where(field, operator, expected) {
          return {
            async get() {
              if (operator !== '==') {
                throw new Error(`unsupported_operator:${operator}`);
              }
              const rows = Array.from(ensureCollection(name).entries())
                .filter(([, value]) => value && value[field] === expected)
                .map(([docId, value]) => createDocSnapshot(docId, value));
              return {
                docs: rows,
                size: rows.length,
                empty: rows.length === 0,
              };
            },
          };
        },
      };
    },
    async runTransaction(work) {
      const pending = [];
      const transaction = {
        async get(docRef) {
          return docRef.get();
        },
        set(docRef, value, options) {
          pending.push(() => docRef.set(value, options));
        },
      };
      const result = await work(transaction);
      for (const commit of pending) {
        await commit();
      }
      return result;
    },
  };
};

test('billing usage repository persists real routing/weather counts for a stable user id', async () => {
  const db = createFakeDb();
  const identity = {
    userId: 'alert-user-1',
    hasUserId: true,
    userIdSource: 'header.x-alert-user-id',
  };
  const occurredAt = new Date('2026-05-15T10:00:00.000Z');

  await recordRoutingUsage({ db, identity, occurredAt });
  await recordWeatherUsage({ db, identity, occurredAt });

  const snapshot = await readBillingUsageSnapshot({
    db,
    userId: 'alert-user-1',
    asOf: occurredAt,
  });

  assert.equal(snapshot.routingCalls, 1);
  assert.equal(snapshot.weatherCalls, 1);
  assert.equal(snapshot.classification, 'real');
  assert.equal(snapshot.periodKey, '2026-05');
});

test('platform allocation stabilizes shared monthly infrastructure with a low-sample active-user floor', async () => {
  const db = createFakeDb({
    billing_subscriptions: {
      'alert-user-1': {
        user_id: 'alert-user-1',
        premium_active: true,
      },
      'alert-user-2': {
        user_id: 'alert-user-2',
        premium_active: true,
      },
      'alert-user-3': {
        user_id: 'alert-user-3',
        premium_active: false,
      },
    },
  });
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      monthlyInfrastructure: {
        queueRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'queue_invoice',
        },
        cacheRedisMonthlyUsd: {
          value: 10,
          classification: 'estimated_reliable',
          evidence: 'cache_invoice',
        },
        workerComputeMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'worker_invoice',
        },
        webServingMonthlyUsd: {
          value: 7,
          classification: 'estimated_reliable',
          evidence: 'web_invoice',
        },
      },
    }),
    path: '',
  });

  const allocation = await readPlatformAllocationSnapshot({
    db,
    priceBook,
    asOf: new Date('2026-05-15T10:00:00.000Z'),
  });

  assert.equal(allocation.amountUsd, 0.34);
  assert.equal(allocation.classification, 'estimated_reliable');
  assert.equal(allocation.activeUsers, 2);
  assert.equal(allocation.observedActiveUsers, 2);
  assert.equal(allocation.effectiveAllocationUsers, 100);
  assert.equal(allocation.minSampleThreshold, 100);
  assert.equal(allocation.lowSampleProtectionApplied, true);
  assert.deepEqual(allocation.includedMonthlyInfrastructureKeys, [
    'queueRedisMonthlyUsd',
    'cacheRedisMonthlyUsd',
    'workerComputeMonthlyUsd',
    'webServingMonthlyUsd',
  ]);
});

test('operational route and weather unit costs use the modeled marginal proxy instead of reallocating fixed monthly serving cost', async () => {
  const db = createFakeDb({
    billing_usage_monthly: {
      '2026-05::alert-user-1': {
        period_key: '2026-05',
        routing_calls: 1,
        weather_calls: 1,
      },
      '2026-05::alert-user-2': {
        period_key: '2026-05',
        routing_calls: 2,
        weather_calls: 0,
      },
    },
  });
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      economicPolicy: {
        requestMarginalCostFallback: {
          routingCostUsdPerCall: {
            value: 0.000004,
            classification: 'modeled',
            evidence: 'routing_marginal_proxy',
          },
          weatherCostUsdPerCall: {
            value: 0.000004,
            classification: 'modeled',
            evidence: 'weather_marginal_proxy',
          },
        },
      },
    }),
    path: '',
  });

  const snapshot = await readOperationalUnitCostSnapshots({
    db,
    priceBook,
    asOf: new Date('2026-05-15T10:00:00.000Z'),
  });

  assert.equal(snapshot.routingUnitCostUsd.amountUsd, 0.000004);
  assert.equal(snapshot.weatherUnitCostUsd.amountUsd, 0.000004);
  assert.equal(snapshot.routingUnitCostUsd.classification, 'modeled');
  assert.equal(snapshot.weatherUnitCostUsd.classification, 'modeled');
  assert.ok(snapshot.routingUnitCostUsd.evidence.includes('billing_usage_monthly:2026-05'));
  assert.ok(
    snapshot.routingUnitCostUsd.evidence.includes(
      'fixed_platform_cost_not_reassigned_to_request_unit_cost',
    ),
  );
  assert.ok(
    snapshot.weatherUnitCostUsd.evidence.includes(
      'external_provider_cost_unproven_for_weather_stack',
    ),
  );
});
