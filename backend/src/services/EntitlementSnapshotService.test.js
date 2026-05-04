const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __dangerousResetEntitlementSnapshotCacheForTests,
  fetchPremiumStatus,
} = require('./EntitlementSnapshotService');

test.beforeEach(() => {
  __dangerousResetEntitlementSnapshotCacheForTests();
  delete process.env.ALERT_ENTITLEMENT_LOOKUP_TIMEOUT_MS;
  delete process.env.ALERT_ENTITLEMENT_CACHE_TTL_MS;
});

test('entitlement lookup fails soft on firestore timeout', async () => {
  process.env.ALERT_ENTITLEMENT_LOOKUP_TIMEOUT_MS = '60';

  const startedAt = Date.now();
  const isPremium = await fetchPremiumStatus({
    userId: 'user-timeout',
    db: {
      collection: () => ({
        doc: () => ({
          get: () =>
            new Promise(resolve => {
              setTimeout(
                () =>
                  resolve({
                    exists: true,
                    data: () => ({ plan: 'premium' }),
                  }),
                250,
              );
            }),
        }),
      }),
    },
    config: {
      premium: {
        forcedUsers: new Set(),
        defaultPremium: false,
      },
    },
  });

  assert.equal(isPremium, false);
  assert.ok(Date.now() - startedAt < 220);
});

test('entitlement lookup caches successful firestore resolution', async () => {
  let lookups = 0;
  process.env.ALERT_ENTITLEMENT_CACHE_TTL_MS = '60000';

  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => {
          lookups += 1;
          return {
            exists: true,
            data: () => ({ plan: 'premium' }),
          };
        },
      }),
    }),
  };

  const first = await fetchPremiumStatus({
    userId: 'user-cache',
    db,
    config: {
      premium: {
        forcedUsers: new Set(),
        defaultPremium: false,
      },
    },
  });
  const second = await fetchPremiumStatus({
    userId: 'user-cache',
    db,
    config: {
      premium: {
        forcedUsers: new Set(),
        defaultPremium: false,
      },
    },
  });

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(lookups, 1);
});
