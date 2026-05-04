const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
  REQUIRED_COST_KEYS,
  readEconomicPolicyConfig,
} = require('./priceBook');

const runWithoutStrictPriceBookEnv = work => {
  const previousStrict = process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK;
  const previousRequireReal = process.env.ALERT_REQUIRE_REAL_PRICE_BOOK;
  delete process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK;
  delete process.env.ALERT_REQUIRE_REAL_PRICE_BOOK;
  try {
    return work();
  } finally {
    if (typeof previousStrict === 'undefined') {
      delete process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK;
    } else {
      process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK = previousStrict;
    }
    if (typeof previousRequireReal === 'undefined') {
      delete process.env.ALERT_REQUIRE_REAL_PRICE_BOOK;
    } else {
      process.env.ALERT_REQUIRE_REAL_PRICE_BOOK = previousRequireReal;
    }
  }
};

test('price book reports modeled defaults when operational inputs are absent', () => {
  const priceBook = runWithoutStrictPriceBookEnv(() =>
    loadOperationalPriceBook({ inlineJson: '', path: '' }),
  );

  assert.equal(priceBook.source, 'model_defaults');
  assert.equal(priceBook.status, 'modeled_no_real_price_inputs');
  assert.equal(priceBook.classifications.providerMissCostUsd.origin, 'modeled');
  assert.equal(priceBook.values.providerMissCostUsd, 0.0012);
  assert.ok(priceBook.missingCostKeys.includes('providerMissCostUsd'));
});

test('price book injects classified cost inputs without overriding usage volumes', () => {
  const priceBook = runWithoutStrictPriceBookEnv(() =>
    loadOperationalPriceBook({
      inlineJson: JSON.stringify({
        costs: {
          providerMissCostUsd: {
            value: 0.42,
            origin: 'real',
            source: 'provider_invoice',
          },
          queueJobCostUsd: {
            value: 0.01,
            origin: 'estimated_reliable',
            source: 'managed_queue_quote',
          },
          weatherProviderMissCostUsd: {
            value: 0.12,
            origin: 'estimated_reliable',
            source: 'legacy_weather_quote',
          },
        },
      }),
      path: '',
    }),
  );
  const usage = applyPriceBookToUsage(
    {
      feedRefreshesPerDay: 8,
      providerMissRate: 0.1,
    },
    priceBook,
  );

  assert.equal(priceBook.source, 'env');
  assert.equal(priceBook.status, 'partial_pricebook_with_modeled_defaults');
  assert.equal(priceBook.classifications.providerMissCostUsd.origin, 'real');
  assert.equal(priceBook.classifications.queueJobCostUsd.origin, 'estimated_reliable');
  assert.equal(priceBook.classifications.weatherMissCostUsd.sourceKey, 'weatherProviderMissCostUsd');
  assert.equal(usage.feedRefreshesPerDay, 8);
  assert.equal(usage.providerMissCostUsd, 0.42);
  assert.equal(usage.queueJobCostUsd, 0.01);
  assert.equal(usage.weatherMissCostUsd, 0.12);
  assert.equal(usage.weatherProviderMissCostUsd, 0.12);
});

test('bare numeric operator inputs are trusted estimates, not fake real prices', () => {
  const priceBook = runWithoutStrictPriceBookEnv(() =>
    loadOperationalPriceBook({
      inlineJson: JSON.stringify({
        costs: {
          providerMissCostUsd: 0.33,
        },
      }),
      path: '',
    }),
  );

  assert.equal(priceBook.classifications.providerMissCostUsd.origin, 'estimated_reliable');
  assert.notEqual(priceBook.classifications.providerMissCostUsd.origin, 'real');
});

test('strict mode fails when required operational costs are missing', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        providerMissCostUsd: {
          value: 0.42,
          origin: 'real',
        },
      },
    }),
    path: '',
    strict: true,
  });

  assert.equal(priceBook.status, 'strict_failed');
  assert.equal(priceBook.strict.ok, false);
  assert.ok(priceBook.strict.blockers.includes('missing_required_cost_inputs'));
  assert.ok(priceBook.missingCostKeys.length >= REQUIRED_COST_KEYS.length - 1);
});

test('strict mode passes with complete real or reliable-estimate pricebook', () => {
  const costs = Object.fromEntries(
    REQUIRED_COST_KEYS.map((key, index) => [
      key,
      {
        value: index === 0 ? 0 : 0.001,
        origin: index % 2 === 0 ? 'real' : 'estimated_reliable',
      },
    ]),
  );
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({ costs }),
    path: '',
    strict: true,
  });

  assert.equal(priceBook.status, 'operational_pricebook');
  assert.equal(priceBook.strict.ok, true);
  assert.equal(priceBook.missingCostKeys.length, 0);
});

test('strict mode rejects explicitly absent mandatory costs', () => {
  const costs = Object.fromEntries(
    REQUIRED_COST_KEYS.map(key => [
      key,
      {
        value: 0.001,
        origin: 'estimated_reliable',
      },
    ]),
  );
  costs.queueRedisMonthlyUsd = { origin: 'absent', notes: 'invoice missing' };

  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({ costs }),
    path: '',
    strict: true,
  });

  assert.equal(priceBook.status, 'strict_failed');
  assert.equal(priceBook.strict.ok, false);
  assert.ok(priceBook.absentCostKeys.includes('queueRedisMonthlyUsd'));
  assert.ok(priceBook.strict.blockers.includes('absent_required_cost_inputs'));
});

test('economic policy loader exposes explicit sample floors and marginal request fallbacks', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      economicPolicy: {
        sampleWindow: 'calendar_month_utc',
        lowSampleProtection: {
          minObservedActiveUsers: 120,
          minTotalSuccessfulCalls: 4000,
        },
        requestMarginalCostFallback: {
          routingCostUsdPerCall: {
            value: 0.00001,
            classification: 'modeled',
          },
        },
      },
    }),
    path: '',
  });

  const policy = readEconomicPolicyConfig(priceBook);

  assert.equal(policy.sampleWindow, 'calendar_month_utc');
  assert.equal(policy.lowSampleProtection.minObservedActiveUsers, 120);
  assert.equal(policy.lowSampleProtection.minTotalSuccessfulCalls, 4000);
  assert.equal(policy.requestMarginalCostFallback.routingCostUsdPerCall.value, 0.00001);
  assert.equal(
    policy.requestMarginalCostFallback.routingCostUsdPerCall.classification,
    'modeled',
  );
  assert.equal(policy.requestMarginalCostFallback.weatherCostUsdPerCall.value, 0.000004);
});

test('price book can apply modeled defaults for absent costs in scenario modeling only', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        providerMissCostUsd: {
          origin: 'absent',
          notes: 'invoice missing',
        },
      },
    }),
    path: '',
    strict: true,
  });

  const scenarioUsage = applyPriceBookToUsage(
    {
      providerMissRate: 0.5,
    },
    priceBook,
    { useModeledDefaultsForAbsentCosts: true },
  );
  const runtimeUsage = applyPriceBookToUsage(
    {
      providerMissRate: 0.5,
    },
    priceBook,
  );

  assert.equal(runtimeUsage.providerMissCostUsd, 0);
  assert.equal(scenarioUsage.providerMissCostUsd, 0.0012);
});
