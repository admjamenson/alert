const { evaluateFlowBudget } = require('../src/economics/unitEconomics');
const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
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

const scenarios = [
  {
    name: 'free_hot_path_cached',
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 8,
      providerMissRate: 0.04,
      weatherRefreshesPerDay: 3,
      weatherProviderMissRate: 0.04,
      mapSessionsPerMonth: 8,
      sosPerMonth: 0.03,
      pushPerMonth: 0.3,
      queueJobsPerMonth: 1,
      cacheOperationsPerMonth: 260,
      backendRequestsPerMonth: 260,
      telemetryEventsPerMonth: 45,
    },
  },
  {
    name: 'free_provider_miss_regression',
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 16,
      providerMissRate: 0.35,
      weatherRefreshesPerDay: 12,
      weatherProviderMissRate: 0.35,
      mapSessionsPerMonth: 40,
      sosPerMonth: 0.05,
      pushPerMonth: 0.8,
      queueJobsPerMonth: 4,
      cacheOperationsPerMonth: 900,
      backendRequestsPerMonth: 900,
      telemetryEventsPerMonth: 90,
    },
    expectedDecision: 'block_or_degrade',
  },
  {
    name: 'free_uncached_provider_and_map_spike',
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 120,
      providerMissRate: 0.9,
      weatherRefreshesPerDay: 80,
      weatherProviderMissRate: 0.9,
      mapSessionsPerMonth: 1000,
      sosPerMonth: 0.08,
      pushPerMonth: 2,
      queueJobsPerMonth: 12,
      cacheOperationsPerMonth: 9000,
      backendRequestsPerMonth: 9000,
      telemetryEventsPerMonth: 600,
    },
    expectedDecision: 'requires_cheaper_path',
  },
  {
    name: 'premium_power_user_cached',
    tier: 'premium',
    monthlyNetRevenueUsd: premiumRevenue,
    usage: {
      feedRefreshesPerDay: 28,
      providerMissRate: 0.08,
      weatherRefreshesPerDay: 8,
      weatherProviderMissRate: 0.08,
      mapSessionsPerMonth: 80,
      sosPerMonth: 0.15,
      pushPerMonth: 3,
      queueJobsPerMonth: 10,
      cacheOperationsPerMonth: 1200,
      backendRequestsPerMonth: 1200,
      telemetryEventsPerMonth: 160,
      storageMbMonth: 20,
      paymentTransactionsPerMonth: 1,
      paymentGrossRevenueUsd: premiumGrossRevenue,
    },
  },
];

const results = scenarios.map(scenario => ({
  name: scenario.name,
  expectedDecision: scenario.expectedDecision || 'allow',
  ...evaluateFlowBudget({
    tier: scenario.tier,
    monthlyNetRevenueUsd: scenario.monthlyNetRevenueUsd,
    usage: applyPriceBookToUsage(scaleUsage(scenario.usage), priceBook),
  }),
}));

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
