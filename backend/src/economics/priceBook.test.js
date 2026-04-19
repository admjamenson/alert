const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
  REQUIRED_COST_KEYS,
} = require('./priceBook');

test('price book reports modeled defaults when operational inputs are absent', () => {
  const priceBook = loadOperationalPriceBook({ inlineJson: '', path: '' });

  assert.equal(priceBook.source, 'model_defaults');
  assert.equal(priceBook.status, 'modeled_no_real_price_inputs');
  assert.equal(priceBook.classifications.providerMissCostUsd.origin, 'modeled');
  assert.equal(priceBook.values.providerMissCostUsd, 0.0012);
  assert.ok(priceBook.missingCostKeys.includes('providerMissCostUsd'));
});

test('price book injects classified cost inputs without overriding usage volumes', () => {
  const priceBook = loadOperationalPriceBook({
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
      },
    }),
    path: '',
  });
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
  assert.equal(usage.feedRefreshesPerDay, 8);
  assert.equal(usage.providerMissCostUsd, 0.42);
  assert.equal(usage.queueJobCostUsd, 0.01);
});

test('bare numeric operator inputs are trusted estimates, not fake real prices', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        providerMissCostUsd: 0.33,
      },
    }),
    path: '',
  });

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
