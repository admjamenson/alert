const test = require('node:test');
const assert = require('node:assert/strict');

const { loadOperationalPriceBook } = require('../economics/priceBook');
const {
  analyzeCostAndMargin,
  buildCommercialTermsFromPriceBook,
  buildOperationalCostsFromPriceBook,
  buildRevenueSnapshot,
  buildUsageMetrics,
} = require('./costEngine');

test('stripe commercial terms preserve fixed fee currency from the pricebook route', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        paymentProcessorPercent: {
          value: 0.039,
          origin: 'estimated_reliable',
          evidence: 'stripe_quote_2026q2',
        },
        paymentProcessorFixedFeeUsd: {
          value: 0.3,
          origin: 'estimated_reliable',
          evidence: 'stripe_quote_2026q2',
        },
      },
    }),
    path: '',
  });

  const terms = buildCommercialTermsFromPriceBook({
    provider: 'stripe',
    priceBook,
    revenueCurrency: 'BRL',
  });

  assert.equal(terms.provider, 'stripe');
  assert.equal(terms.percentFee, 0.039);
  assert.equal(terms.fixedFee, 0.3);
  assert.equal(terms.fixedFeeCurrency, 'USD');
  assert.equal(terms.classification, 'estimated_reliable');
});

test('structured pricebook terms preserve BRL fixed fee and stay blocked without an explicit USD/BRL normalization rate', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        stripe: {
          percentFee: {
            value: 0.0399,
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_percent',
          },
          fixedFee: {
            value: 0.5,
            currency: 'BRL',
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_fixed_brl',
          },
        },
      },
      variableUnitCosts: {
        routingCostUsdPerCall: {
          value: 0.00004,
          classification: 'real',
          evidence: 'routing_contract',
        },
        weatherCostUsdPerCall: {
          value: 0.0009,
          classification: 'real',
          evidence: 'weather_contract',
        },
      },
      userLevelDefaults: {
        infraCostPerUserUsd: {
          value: 0.1,
          classification: 'estimated_reliable',
          evidence: 'infra_allocation_formula',
        },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 14.9,
      currency: 'BRL',
      classification: 'real',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'BRL',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: null,
        classification: 'absent',
        evidence: 'no persisted override',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: 12,
      weatherCalls: 3,
      classification: 'real',
    }),
    priceBook,
  });

  assert.equal(result.commercialTerms.fixedFee, 0.5);
  assert.equal(result.commercialTerms.fixedFeeCurrency, 'BRL');
  assert.equal(result.commercialTerms.fixedFeeClassification, 'estimated_reliable');
  assert.equal(result.costBreakdown.paymentProcessorFixedCost, 0.5);
  assert.equal(result.costBreakdown.paymentProcessorFixedCostCurrency, 'BRL');
  assert.equal(result.marginAnalysis.classification, 'absent');
  assert.equal(result.marginAnalysis.totalCost, null);
  assert.equal(result.fxNormalization.calculationCurrency, 'BRL');
  assert.equal(result.fxNormalization.classification, 'absent');
  assert.ok(
    result.costBreakdown.blockers.includes(
      'missing_currency_conversion_rate_usd_to_brl',
    ),
  );
  assert.ok(
    result.fxNormalization.blockers.includes(
      'missing_currency_conversion_rate_usd_to_brl',
    ),
  );
});

test('margin analysis is blocked when BRL revenue cannot be combined with USD-only costs', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        routingCostUsd: { value: 0.00004, origin: 'real' },
        weatherMissCostUsd: { value: 0.0009, origin: 'real' },
        paymentProcessorPercent: { value: 0.039, origin: 'real' },
        paymentProcessorFixedFeeUsd: { value: 0.3, origin: 'real' },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 14.9,
      currency: 'BRL',
      classification: 'real',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'BRL',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: 0.1,
        classification: 'real',
        evidence: 'allocated_premium_platform_cost',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: 12,
      weatherCalls: 3,
      classification: 'real',
    }),
    priceBook,
  });

  assert.equal(result.costBreakdown.paymentProcessorPercentCostCurrency, 'BRL');
  assert.equal(result.costBreakdown.routingCostCurrency, 'BRL');
  assert.equal(result.marginAnalysis.classification, 'absent');
  assert.equal(result.marginAnalysis.totalCost, null);
  assert.ok(
    result.marginAnalysis.blockers.includes(
      'missing_currency_conversion_rate_usd_to_brl',
    ),
  );
});

test('explicit USD/BRL normalization converts operational costs into BRL and computes margin honestly', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        stripe: {
          percentFee: {
            value: 0.0399,
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_percent',
          },
          fixedFee: {
            value: 0.5,
            currency: 'BRL',
            classification: 'estimated_reliable',
            evidence: 'structured_stripe_fixed_brl',
          },
        },
      },
      currencyNormalization: {
        usdToBrl: {
          value: 5,
          classification: 'estimated_reliable',
          evidence: 'bcb_ptax_reference',
        },
      },
      variableUnitCosts: {
        routingCostUsdPerCall: {
          value: 0.2,
          classification: 'estimated_reliable',
          evidence: 'routing_estimate',
        },
        weatherCostUsdPerCall: {
          value: 0.1,
          classification: 'estimated_reliable',
          evidence: 'weather_estimate',
        },
      },
      userLevelDefaults: {
        infraCostPerUserUsd: {
          value: 2,
          classification: 'estimated_reliable',
          evidence: 'infra_allocation_formula',
        },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 20,
      currency: 'BRL',
      classification: 'estimated_reliable',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'BRL',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: null,
        classification: 'absent',
        evidence: 'no persisted override',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: 1,
      weatherCalls: 2,
      classification: 'real',
    }),
    priceBook,
  });

  const expectedTotal = 20 * 0.0399 + 0.5 + (1 * 0.2 + 2 * 0.1 + 2) * 5;

  assert.equal(result.costBreakdown.routingCostCurrency, 'BRL');
  assert.equal(result.costBreakdown.weatherCostCurrency, 'BRL');
  assert.equal(result.costBreakdown.platformAllocationCostCurrency, 'BRL');
  assert.equal(result.fxNormalization.calculationCurrency, 'BRL');
  assert.equal(result.fxNormalization.classification, 'estimated_reliable');
  assert.equal(result.fxNormalization.entries.length, 1);
  assert.equal(result.fxNormalization.entries[0].baseCurrency, 'USD');
  assert.equal(result.fxNormalization.entries[0].targetCurrency, 'BRL');
  assert.equal(result.fxNormalization.entries[0].rate, 5);
  assert.equal(result.fxNormalization.entries[0].asOf, null);
  assert.equal(result.fxNormalization.entries[0].source, null);
  assert.deepEqual(
    result.fxNormalization.entries[0].appliedTo,
    ['platformAllocationCost', 'routingCost', 'weatherCost'],
  );
  assert.ok(Math.abs((result.marginAnalysis.totalCost || 0) - expectedTotal) < 0.00001);
  assert.equal(result.marginAnalysis.classification, 'estimated_reliable');
  assert.equal(result.marginAnalysis.margin, 20 - expectedTotal);
  assert.equal(result.marginAnalysis.marginPercent, (20 - expectedTotal) / 20);
});

test('explicit USD/EUR normalization converts USD costs into EUR and keeps FX audit metadata', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      schemaVersion: 2,
      commercialTerms: {
        stripe: {
          percentFee: {
            value: 0.04,
            classification: 'real',
            evidence: 'stripe_contract',
          },
          fixedFee: {
            value: 0.3,
            currency: 'USD',
            classification: 'real',
            evidence: 'stripe_contract',
          },
        },
      },
      fxRates: {
        USD: {
          EUR: {
            value: 0.92,
            classification: 'estimated_reliable',
            asOf: '2026-05-01',
            source: 'ecb_public_reference',
            evidence: 'ecb_fx_reference',
          },
        },
      },
      variableUnitCosts: {
        routingCostUsdPerCall: {
          value: 1,
          classification: 'real',
          evidence: 'routing_contract',
        },
        weatherCostUsdPerCall: {
          value: 0.5,
          classification: 'real',
          evidence: 'weather_contract',
        },
      },
      userLevelDefaults: {
        infraCostPerUserUsd: {
          value: 2,
          classification: 'real',
          evidence: 'infra_formula',
        },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 25,
      currency: 'EUR',
      classification: 'real',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'EUR',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: null,
        classification: 'absent',
        evidence: 'no persisted override',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: 1,
      weatherCalls: 2,
      classification: 'real',
    }),
    priceBook,
  });

  const expectedTotal = (25 * 0.04) + (0.3 * 0.92) + ((1 * 1 + 2 * 0.5 + 2) * 0.92);

  assert.equal(result.costBreakdown.totalCostCurrency, 'EUR');
  assert.ok(Math.abs((result.marginAnalysis.totalCost || 0) - expectedTotal) < 0.00001);
  assert.equal(result.fxNormalization.calculationCurrency, 'EUR');
  assert.equal(result.fxNormalization.classification, 'estimated_reliable');
  assert.equal(result.fxNormalization.entries.length, 1);
  assert.equal(result.fxNormalization.entries[0].baseCurrency, 'USD');
  assert.equal(result.fxNormalization.entries[0].targetCurrency, 'EUR');
  assert.equal(result.fxNormalization.entries[0].rate, 0.92);
  assert.equal(result.fxNormalization.entries[0].asOf, '2026-05-01');
  assert.equal(result.fxNormalization.entries[0].source, 'ecb_public_reference');
  assert.deepEqual(
    result.fxNormalization.entries[0].appliedTo,
    [
      'paymentProcessorFixedCost',
      'platformAllocationCost',
      'routingCost',
      'weatherCost',
    ],
  );
});

test('USD margin analysis computes when commercial terms, usage, and allocation are compatible', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        routingCostUsd: { value: 0.00004, origin: 'real' },
        weatherMissCostUsd: { value: 0.0009, origin: 'real' },
        paymentProcessorPercent: { value: 0.039, origin: 'real' },
        paymentProcessorFixedFeeUsd: { value: 0.3, origin: 'real' },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 10,
      currency: 'USD',
      classification: 'real',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'USD',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: 0.1,
        classification: 'estimated_reliable',
        evidence: 'allocated_hosting_share',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: 100,
      weatherCalls: 50,
      classification: 'real',
    }),
    priceBook,
  });

  const expectedTotal =
    10 * 0.039 + 0.3 + 100 * 0.00004 + 50 * 0.0009 + 0.1;

  assert.ok(Math.abs((result.marginAnalysis.totalCost || 0) - expectedTotal) < 0.00001);
  assert.equal(result.marginAnalysis.classification, 'estimated_reliable');
  assert.equal(result.marginAnalysis.margin, 10 - expectedTotal);
  assert.equal(result.marginAnalysis.marginPercent, (10 - expectedTotal) / 10);
  assert.equal(result.fxNormalization.calculationCurrency, 'USD');
  assert.equal(result.fxNormalization.classification, 'real');
  assert.deepEqual(result.fxNormalization.entries, []);
});

test('missing usage metrics stay absent instead of silently turning into zero usage', () => {
  const priceBook = loadOperationalPriceBook({
    inlineJson: JSON.stringify({
      costs: {
        routingCostUsd: { value: 0.00004, origin: 'real' },
        weatherMissCostUsd: { value: 0.0009, origin: 'real' },
        paymentProcessorPercent: { value: 0.039, origin: 'real' },
        paymentProcessorFixedFeeUsd: { value: 0.3, origin: 'real' },
      },
    }),
    path: '',
  });

  const result = analyzeCostAndMargin({
    revenue: buildRevenueSnapshot({
      amount: 10,
      currency: 'USD',
      classification: 'real',
    }),
    commercialTerms: buildCommercialTermsFromPriceBook({
      provider: 'stripe',
      priceBook,
      revenueCurrency: 'USD',
    }),
    operationalCosts: buildOperationalCostsFromPriceBook({
      priceBook,
      platformAllocationCostUsd: {
        amountUsd: null,
        classification: 'absent',
        evidence: 'no per-user allocation in billing account flow',
      },
    }),
    usageMetrics: buildUsageMetrics({
      routingCalls: null,
      weatherCalls: null,
      classification: 'absent',
    }),
    priceBook,
  });

  assert.equal(result.usageMetrics.routingCalls, null);
  assert.equal(result.usageMetrics.weatherCalls, null);
  assert.equal(result.marginAnalysis.classification, 'absent');
  assert.ok(result.marginAnalysis.blockers.includes('missing_routing_usage'));
  assert.ok(result.marginAnalysis.blockers.includes('missing_weather_usage'));
  assert.ok(
    result.marginAnalysis.blockers.includes('missing_platform_allocation_cost'),
  );
});
