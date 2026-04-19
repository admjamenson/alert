const {
  evaluateFlowBudget,
  estimateMonthlyVariableCost,
} = require('../src/economics/unitEconomics');
const {
  applyPriceBookToUsage,
  loadOperationalPriceBook,
} = require('../src/economics/priceBook');

const TIERS = [
  {
    label: '100k',
    mau: 100_000,
    dauRatio: 0.25,
    peakCityShare: 0.08,
    peakHourDauShare: 0.18,
    sosPerDauPerDay: 0.0015,
    feedRefreshesPerDauPerDay: 8,
    pushFanoutPerSos: 6,
    readiness: 'implemented_not_proven_here',
    requiredControls: ['bounded_memory_cache', 'inflight_coalescing', 'idempotent_jobs'],
  },
  {
    label: '1M',
    mau: 1_000_000,
    dauRatio: 0.24,
    peakCityShare: 0.07,
    peakHourDauShare: 0.17,
    sosPerDauPerDay: 0.0014,
    feedRefreshesPerDauPerDay: 8,
    pushFanoutPerSos: 7,
    readiness: 'implemented_not_proven_here',
    requiredControls: ['external_cache_ready', 'external_queue_ready', 'provider_budgets'],
  },
  {
    label: '10M',
    mau: 10_000_000,
    dauRatio: 0.22,
    peakCityShare: 0.05,
    peakHourDauShare: 0.16,
    sosPerDauPerDay: 0.0012,
    feedRefreshesPerDauPerDay: 7,
    pushFanoutPerSos: 8,
    readiness: 'modeled_requires_external_infra',
    requiredControls: ['redis_cluster', 'bullmq_or_cloud_tasks', 'hot_path_materialization', 'regional_provider_budgets'],
  },
  {
    label: '100M',
    mau: 100_000_000,
    dauRatio: 0.2,
    peakCityShare: 0.035,
    peakHourDauShare: 0.14,
    sosPerDauPerDay: 0.001,
    feedRefreshesPerDauPerDay: 6,
    pushFanoutPerSos: 10,
    readiness: 'modeled_requires_multi_region',
    requiredControls: ['multi_region_serving', 'edge_cache', 'regional_queues', 'push_fanout_partitioning', 'provider_contracts'],
  },
  {
    label: '1B',
    mau: 1_000_000_000,
    dauRatio: 0.18,
    peakCityShare: 0.025,
    peakHourDauShare: 0.12,
    sosPerDauPerDay: 0.0008,
    feedRefreshesPerDauPerDay: 5,
    pushFanoutPerSos: 12,
    readiness: 'modeled_design_only',
    requiredControls: ['cell_based_architecture', 'global_traffic_management', 'multi_provider_contracts', 'distributed_load_tests'],
  },
];

const REGIONAL_BURST_SCENARIOS = [
  {
    id: 'single_city_peak',
    description: 'One wealthy city concentrates the hot-path read burst.',
    regions: 1,
    burstMultiplier: 2.8,
    providerMissMultiplier: 1.4,
  },
  {
    id: 'multi_region_burst',
    description: 'Five regions receive simultaneous alert/weather/feed demand.',
    regions: 5,
    burstMultiplier: 1.9,
    providerMissMultiplier: 1.15,
  },
  {
    id: 'provider_miss_pressure',
    description: 'Provider cache misses rise during weather/risk refresh pressure.',
    regions: 5,
    burstMultiplier: 1.35,
    providerMissMultiplier: 3.5,
  },
  {
    id: 'sos_push_fanout_burst',
    description: 'SOS events trigger regional push fan-out and queue pressure.',
    regions: 3,
    burstMultiplier: 1.2,
    providerMissMultiplier: 1,
  },
];

const round = value => Math.round(value * 100) / 100;
const freemiumRevenue = Number(process.env.ALERT_FREEMIUM_NET_AD_ARPU_USD || 0.6);
const premiumRevenue = Number(process.env.ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD || 5.0);
const priceBook = loadOperationalPriceBook();
const premiumGrossRevenue = Number(
  process.env.ALERT_PREMIUM_GROSS_BILLING_ARPU_USD || premiumRevenue,
);

const modelTier = tier => {
  const dau = tier.mau * tier.dauRatio;
  const peakCityDau = dau * tier.peakCityShare;
  const peakHourUsers = peakCityDau * tier.peakHourDauShare;
  const feedReqPerDay = dau * tier.feedRefreshesPerDauPerDay;
  const feedAvgRps = feedReqPerDay / 86_400;
  const feedPeakRps = (peakHourUsers * 1.8) / 3600;
  const sosPerDay = dau * tier.sosPerDauPerDay;
  const sosPeakRps = (sosPerDay * 0.18) / 3600;
  const pushPerDay = sosPerDay * tier.pushFanoutPerSos;
  const pushPeakRps = sosPeakRps * tier.pushFanoutPerSos;
  const providerMissRate = tier.mau >= 100_000_000 ? 0.03 : 0.06;
  const regionalScenarios = REGIONAL_BURST_SCENARIOS.map(scenario => {
    const regionalFeedPeakRps =
      (feedPeakRps * scenario.burstMultiplier) / scenario.regions;
    const providerMissPeakRps =
      regionalFeedPeakRps * providerMissRate * scenario.providerMissMultiplier;
    const queueJobsPeakRps =
      scenario.id === 'sos_push_fanout_burst'
        ? pushPeakRps * scenario.burstMultiplier
        : regionalFeedPeakRps * 0.04;

    return {
      id: scenario.id,
      description: scenario.description,
      regions: scenario.regions,
      regionalFeedPeakRps: round(regionalFeedPeakRps),
      aggregateFeedPeakRps: round(regionalFeedPeakRps * scenario.regions),
      providerMissPeakRps: round(providerMissPeakRps),
      queueJobsPeakRps: round(queueJobsPeakRps),
      pushFanoutPeakRps: round(pushPeakRps * scenario.burstMultiplier),
      requiredControls:
        scenario.id === 'provider_miss_pressure'
          ? ['regional_cache', 'provider_budget', 'coalescing', 'stale_while_revalidate']
          : scenario.id === 'sos_push_fanout_burst'
            ? ['regional_queue', 'dead_letter', 'push_partitioning', 'idempotency']
            : ['regional_serving', 'hot_path_materialization', 'rate_limit'],
    };
  });
  const freeUsage = {
    feedRefreshesPerDay: tier.feedRefreshesPerDauPerDay,
    providerMissRate,
    weatherRefreshesPerDay: Math.max(1, Math.round(tier.feedRefreshesPerDauPerDay * 0.35)),
    weatherProviderMissRate: tier.mau >= 100_000_000 ? 0.03 : 0.05,
    mapSessionsPerMonth: tier.mau >= 10_000_000 ? 8 : 12,
    sosPerMonth: tier.sosPerDauPerDay * 30,
    pushPerMonth: tier.sosPerDauPerDay * 30 * tier.pushFanoutPerSos,
    queueJobsPerMonth: tier.sosPerDauPerDay * 30 * (1 + tier.pushFanoutPerSos),
    cacheOperationsPerMonth: tier.feedRefreshesPerDauPerDay * 30 * 1.25,
    backendRequestsPerMonth:
      tier.feedRefreshesPerDauPerDay * 30 +
      Math.max(1, Math.round(tier.feedRefreshesPerDauPerDay * 0.35)) * 30 +
      12,
    telemetryEventsPerMonth: tier.mau >= 100_000_000 ? 30 : 50,
  };
  const premiumUsage = {
    feedRefreshesPerDay: tier.feedRefreshesPerDauPerDay * 1.6,
    providerMissRate: tier.mau >= 100_000_000 ? 0.04 : 0.08,
    weatherRefreshesPerDay: Math.max(2, Math.round(tier.feedRefreshesPerDauPerDay * 0.75)),
    weatherProviderMissRate: tier.mau >= 100_000_000 ? 0.04 : 0.08,
    mapSessionsPerMonth: tier.mau >= 10_000_000 ? 35 : 55,
    sosPerMonth: tier.sosPerDauPerDay * 30 * 2,
    pushPerMonth: tier.sosPerDauPerDay * 30 * tier.pushFanoutPerSos * 2,
    queueJobsPerMonth: tier.sosPerDauPerDay * 30 * tier.pushFanoutPerSos * 2,
    cacheOperationsPerMonth: tier.feedRefreshesPerDauPerDay * 30 * 2.2,
    backendRequestsPerMonth:
      tier.feedRefreshesPerDauPerDay * 1.6 * 30 +
      Math.max(2, Math.round(tier.feedRefreshesPerDauPerDay * 0.75)) * 30 +
      35,
    telemetryEventsPerMonth: 90,
    storageMbMonth: 15,
    paymentTransactionsPerMonth: 1,
    paymentGrossRevenueUsd: premiumGrossRevenue,
  };
  const freeBudget = evaluateFlowBudget({
    tier: 'free',
    monthlyNetRevenueUsd: freemiumRevenue,
    usage: applyPriceBookToUsage(freeUsage, priceBook),
  });
  const premiumBudget = evaluateFlowBudget({
    tier: 'premium',
    monthlyNetRevenueUsd: premiumRevenue,
    usage: applyPriceBookToUsage(premiumUsage, priceBook),
  });
  const freeCost = estimateMonthlyVariableCost(applyPriceBookToUsage(freeUsage, priceBook));
  const premiumCost = estimateMonthlyVariableCost(applyPriceBookToUsage(premiumUsage, priceBook));

  return {
    label: tier.label,
    mau: tier.mau,
    dau: Math.round(dau),
    peakCityDau: Math.round(peakCityDau),
    feedAvgRps: round(feedAvgRps),
    feedPeakCityRps: round(feedPeakRps),
    sosPerDay: Math.round(sosPerDay),
    sosPeakRps: round(sosPeakRps),
    pushPerDay: Math.round(pushPerDay),
    pushPeakRps: round(pushPeakRps),
    regionalScenarios,
    unitEconomics: {
      free: freeBudget.guardrail,
      premium: premiumBudget.guardrail,
      decisions: {
        free: freeBudget.decision,
        premium: premiumBudget.decision,
      },
      estimates: {
        freeMonthlyVariableCostUsd: round(freeCost.totalUsd),
        premiumMonthlyVariableCostUsd: round(premiumCost.totalUsd),
        largestFreeComponent: freeBudget.largestComponent,
        largestPremiumComponent: premiumBudget.largestComponent,
      },
    },
    readiness: tier.readiness,
    proofClassifications: {
      localLoadHarness: 'proven',
      externalCacheQueue:
        process.env.ALERT_REDIS_URL && process.env.ALERT_JOB_QUEUE_DRIVER === 'bullmq'
          ? 'implemented_not_proven_here'
          : 'modeled_requires_external_infra',
      multiInstanceServing:
        tier.mau <= 1_000_000
          ? 'implemented_not_proven_here'
          : 'modeled_requires_external_infra',
      multiRegion:
        tier.mau >= 100_000_000
          ? 'modeled_requires_multi_region'
          : tier.mau >= 10_000_000
            ? 'modeled_requires_external_infra'
            : 'implemented_not_proven_here',
    },
    requiredControls: tier.requiredControls,
    assumptions: {
      dauRatio: tier.dauRatio,
      peakCityShare: tier.peakCityShare,
      peakHourDauShare: tier.peakHourDauShare,
      feedRefreshesPerDauPerDay: tier.feedRefreshesPerDauPerDay,
      sosPerDauPerDay: tier.sosPerDauPerDay,
      pushFanoutPerSos: tier.pushFanoutPerSos,
    },
  };
};

const result = {
  generatedAt: new Date().toISOString(),
  status:
    priceBook.strict.enabled && !priceBook.strict.ok
      ? 'blocked_missing_operational_pricebook'
      : priceBook.status === 'operational_pricebook'
        ? 'modeled_with_operational_pricebook'
        : priceBook.status === 'partial_pricebook_with_modeled_defaults'
          ? 'modeled_with_partial_pricebook'
          : 'modeled_not_proven',
  revenueAssumptions: {
    freemiumNetAdsArpuUsd: freemiumRevenue,
    premiumNetSubscriptionArpuUsd: premiumRevenue,
    premiumGrossBillingArpuUsd: premiumGrossRevenue,
  },
  priceBook,
  regionalBurstScenarios: REGIONAL_BURST_SCENARIOS,
  tiers: TIERS.map(modelTier),
};

console.log(JSON.stringify(result, null, 2));
