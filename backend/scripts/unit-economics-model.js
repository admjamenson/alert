const {
  evaluateUnitEconomics,
  estimateMonthlyVariableCost,
} = require('../src/economics/unitEconomics');
const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
} = require('../src/economics/priceBook');

const numberEnv = (key, fallback) => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const freemiumRevenue = numberEnv('ALERT_FREEMIUM_NET_AD_ARPU_USD', 0.6);
const premiumRevenue = numberEnv('ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD', 5.0);
const premiumGrossRevenue = numberEnv(
  'ALERT_PREMIUM_GROSS_BILLING_ARPU_USD',
  premiumRevenue,
);
const priceBook = loadOperationalPriceBook();

const scenarios = [
  {
    name: 'free_normal',
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 5,
      providerMissRate: 0.04,
      weatherRefreshesPerDay: 2,
      weatherProviderMissRate: 0.04,
      mapSessionsPerMonth: 4,
      sosPerMonth: 0.02,
      pushPerMonth: 0.2,
      queueJobsPerMonth: 1,
      cacheOperationsPerMonth: 170,
      backendRequestsPerMonth: 170,
      telemetryEventsPerMonth: 35,
    },
  },
  {
    name: 'free_heavy_city_peak',
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: {
      feedRefreshesPerDay: 14,
      providerMissRate: 0.08,
      weatherRefreshesPerDay: 5,
      weatherProviderMissRate: 0.08,
      mapSessionsPerMonth: 20,
      sosPerMonth: 0.04,
      pushPerMonth: 0.6,
      queueJobsPerMonth: 2,
      cacheOperationsPerMonth: 520,
      backendRequestsPerMonth: 520,
      telemetryEventsPerMonth: 70,
    },
  },
  {
    name: 'premium_normal',
    tier: 'premium',
    monthlyNetRevenueUsd: premiumRevenue,
    usage: {
      feedRefreshesPerDay: 10,
      providerMissRate: 0.06,
      weatherRefreshesPerDay: 5,
      weatherProviderMissRate: 0.06,
      mapSessionsPerMonth: 30,
      sosPerMonth: 0.08,
      pushPerMonth: 1.2,
      queueJobsPerMonth: 4,
      cacheOperationsPerMonth: 520,
      backendRequestsPerMonth: 520,
      telemetryEventsPerMonth: 80,
      paymentTransactionsPerMonth: 1,
      paymentGrossRevenueUsd: premiumGrossRevenue,
    },
  },
  {
    name: 'premium_power_user',
    tier: 'premium',
    monthlyNetRevenueUsd: premiumRevenue,
    usage: {
      feedRefreshesPerDay: 30,
      providerMissRate: 0.1,
      weatherRefreshesPerDay: 14,
      weatherProviderMissRate: 0.1,
      mapSessionsPerMonth: 90,
      sosPerMonth: 0.12,
      pushPerMonth: 2.5,
      queueJobsPerMonth: 9,
      cacheOperationsPerMonth: 1500,
      backendRequestsPerMonth: 1500,
      telemetryEventsPerMonth: 140,
      storageMbMonth: 20,
      paymentTransactionsPerMonth: 1,
      paymentGrossRevenueUsd: premiumGrossRevenue,
    },
  },
];

const results = scenarios.map(scenario => {
  const usage = applyPriceBookToUsage(scenario.usage, priceBook);
  const cost = estimateMonthlyVariableCost(usage);
  return {
    name: scenario.name,
    usage,
    cost,
    guardrail: evaluateUnitEconomics({
      tier: scenario.tier,
      monthlyNetRevenueUsd: scenario.monthlyNetRevenueUsd,
      monthlyVariableCostUsd: cost.totalUsd,
    }),
  };
});

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      status: 'modeled_not_billed',
      revenueAssumptions: {
        freemiumNetAdsArpuUsd: freemiumRevenue,
        premiumNetSubscriptionArpuUsd: premiumRevenue,
        premiumGrossBillingArpuUsd: premiumGrossRevenue,
      },
      priceBook,
      scenarios: results,
    },
    null,
    2,
  ),
);
