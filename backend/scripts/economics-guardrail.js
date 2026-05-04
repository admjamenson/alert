const { evaluateFlowBudget } = require('../src/economics/unitEconomics');
const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
  readEconomicPolicyConfig,
} = require('../src/economics/priceBook');

const numberEnv = (key, fallback) => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const multiplier = numberEnv('ALERT_ECONOMICS_STRESS_MULTIPLIER', 1);
const freemiumRevenue = numberEnv('ALERT_FREEMIUM_NET_AD_ARPU_USD', 0.6);
const premiumRevenue = numberEnv('ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD', 5.0);
const requireRealPriceBook = process.env.ALERT_REQUIRE_REAL_PRICE_BOOK === 'true';
const strictPriceBook =
  requireRealPriceBook || process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK === 'true';
const priceBook = loadOperationalPriceBook({ strict: strictPriceBook });
const economicPolicyConfig = readEconomicPolicyConfig(priceBook);
const premiumGrossRevenue = numberEnv(
  'ALERT_PREMIUM_GROSS_BILLING_ARPU_USD',
  premiumRevenue,
);

const scaleUsage = usage =>
  Object.fromEntries(
    Object.entries(usage).map(([key, value]) => [
      key,
      typeof value === 'number' &&
      !key.endsWith('Rate') &&
      !key.endsWith('CostUsd')
        ? value * multiplier
        : value,
    ]),
  );

const applyScenarioBillingRoute = ({ usage, billingRoute }) => {
  const normalizedRoute = String(billingRoute || '').trim().toLowerCase();
  if (normalizedRoute === 'stripe') {
    return {
      ...usage,
      appStoreFeePercent: 0,
      playStoreFeePercent: 0,
    };
  }
  if (normalizedRoute === 'app_store') {
    return {
      ...usage,
      paymentProcessorPercent: 0,
      paymentProcessorFixedFeeUsd: 0,
      playStoreFeePercent: 0,
    };
  }
  if (normalizedRoute === 'play_store') {
    return {
      ...usage,
      paymentProcessorPercent: 0,
      paymentProcessorFixedFeeUsd: 0,
      appStoreFeePercent: 0,
    };
  }
  return usage;
};

const buildScenarioUsage = scenario =>
  applyScenarioBillingRoute({
    usage: applyPriceBookToUsage(scaleUsage(scenario.usage), priceBook, {
      useModeledDefaultsForAbsentCosts: true,
    }),
    billingRoute: scenario.billingRoute,
  });

const buildScenarioEconomicPolicy = ({ scenario, result, usage }) => ({
  tier: scenario.tier,
  targetCostCapPercent: result.guardrail.capRatio,
  actualCostRatio: result.guardrail.costRatio,
  withinTargetCostCap: result.guardrail.withinGuardrail,
  requiresCheaperPath: result.decision === 'requires_cheaper_path',
  blockOrDegrade: result.decision === 'block_or_degrade',
  sampleWindow: economicPolicyConfig.sampleWindow,
  sampleVolume: {
    costAllocationUsers: usage.costAllocationUsers ?? null,
    feedRefreshesPerDay: usage.feedRefreshesPerDay ?? null,
    weatherRefreshesPerDay: usage.weatherRefreshesPerDay ?? null,
    mapSessionsPerMonth: usage.mapSessionsPerMonth ?? null,
    routingRequestsPerMonth: usage.routingRequestsPerMonth ?? null,
    backendRequestsPerMonth: usage.backendRequestsPerMonth ?? null,
  },
  rateioFormula: {
    platformAllocation:
      economicPolicyConfig.sharedPlatformAllocation.rateioFormula,
    routingUnitCost:
      economicPolicyConfig.requestMarginalCostFallback.rateioFormula,
    weatherUnitCost:
      economicPolicyConfig.requestMarginalCostFallback.rateioFormula,
  },
  billingRoute: scenario.billingRoute || null,
  modeledFallbacksApplied: {
    routingCostUsd:
      priceBook.classifications?.routingCostUsd?.origin === 'absent',
    weatherMissCostUsd:
      priceBook.classifications?.weatherMissCostUsd?.origin === 'absent',
    providerMissCostUsd:
      priceBook.classifications?.providerMissCostUsd?.origin === 'absent',
    mapSessionCostUsd:
      priceBook.classifications?.mapSessionCostUsd?.origin === 'absent',
    webServingCostUsd:
      priceBook.classifications?.webServingCostUsd?.origin === 'absent',
  },
});

const scenarios = [
  {
    name: 'free_hot_path_cached',
    tier: 'free',
    billingRoute: 'ads',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 8,
      costAllocationUsers: 100_000,
      providerMissRate: 0.04,
      weatherRefreshesPerDay: 3,
      weatherProviderMissRate: 0.04,
      mapSessionsPerMonth: 8,
      routingRequestsPerMonth: 4,
      sosPerMonth: 0.03,
      pushPerMonth: 0.3,
      queueJobsPerMonth: 1,
      cacheOperationsPerMonth: 260,
      backendRequestsPerMonth: 260,
      backgroundWorkerExecutionsPerMonth: 1,
      telemetryEventsPerMonth: 45,
    },
  },
  {
    name: 'free_provider_miss_regression',
    tier: 'free',
    billingRoute: 'ads',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 16,
      costAllocationUsers: 100_000,
      providerMissRate: 0.35,
      weatherRefreshesPerDay: 12,
      weatherProviderMissRate: 0.35,
      mapSessionsPerMonth: 40,
      routingRequestsPerMonth: 16,
      sosPerMonth: 0.05,
      pushPerMonth: 0.8,
      queueJobsPerMonth: 4,
      cacheOperationsPerMonth: 900,
      backendRequestsPerMonth: 900,
      backgroundWorkerExecutionsPerMonth: 4,
      telemetryEventsPerMonth: 90,
    },
    expectedDecision: 'block_or_degrade',
  },
  {
    name: 'free_uncached_provider_and_map_spike',
    tier: 'free',
    billingRoute: 'ads',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 120,
      costAllocationUsers: 100_000,
      providerMissRate: 0.9,
      weatherRefreshesPerDay: 80,
      weatherProviderMissRate: 0.9,
      mapSessionsPerMonth: 1000,
      routingRequestsPerMonth: 240,
      sosPerMonth: 0.08,
      pushPerMonth: 2,
      queueJobsPerMonth: 12,
      cacheOperationsPerMonth: 9000,
      backendRequestsPerMonth: 9000,
      backgroundWorkerExecutionsPerMonth: 12,
      telemetryEventsPerMonth: 600,
    },
    expectedDecision: 'requires_cheaper_path',
  },
  {
    name: 'premium_power_user_cached',
    tier: 'premium',
    billingRoute: 'stripe',
    monthlyNetRevenueUsd: premiumRevenue,
    usage: {
      feedRefreshesPerDay: 28,
      costAllocationUsers: 100_000,
      providerMissRate: 0.08,
      weatherRefreshesPerDay: 8,
      weatherProviderMissRate: 0.08,
      mapSessionsPerMonth: 80,
      routingRequestsPerMonth: 40,
      sosPerMonth: 0.15,
      pushPerMonth: 3,
      queueJobsPerMonth: 10,
      cacheOperationsPerMonth: 1200,
      backendRequestsPerMonth: 1200,
      backgroundWorkerExecutionsPerMonth: 10,
      telemetryEventsPerMonth: 160,
      storageMbMonth: 20,
      paymentTransactionsPerMonth: 1,
      paymentGrossRevenueUsd: premiumGrossRevenue,
    },
  },
];

const results = scenarios.map(scenario => {
  const scenarioUsage = buildScenarioUsage(scenario);
  const evaluated = evaluateFlowBudget({
    tier: scenario.tier,
    monthlyNetRevenueUsd: scenario.monthlyNetRevenueUsd,
    usage: scenarioUsage,
  });

  return {
    name: scenario.name,
    billingRoute: scenario.billingRoute || null,
    expectedDecision: scenario.expectedDecision || 'allow',
    scenarioUsage,
    ...evaluated,
    economicPolicy: buildScenarioEconomicPolicy({
      scenario,
      result: evaluated,
      usage: scenarioUsage,
    }),
  };
});

const unexpected = results.filter(
  result => result.decision !== result.expectedDecision,
);
const missingRequiredRealPrices =
  strictPriceBook && !priceBook.strict.ok;
const status =
  unexpected.length === 0 && !missingRequiredRealPrices ? 'passed' : 'failed';

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      status,
      stressMultiplier: multiplier,
      requireRealPriceBook,
      strictPriceBookEnabled: strictPriceBook,
      revenueAssumptions: {
        freemiumNetAdsArpuUsd: freemiumRevenue,
        premiumNetSubscriptionArpuUsd: premiumRevenue,
        premiumGrossBillingArpuUsd: premiumGrossRevenue,
      },
      strictPriceBook: priceBook.strict,
      priceBook,
      results,
    },
    null,
    2,
  ),
);

if (status !== 'passed') {
  process.exitCode = 1;
}
