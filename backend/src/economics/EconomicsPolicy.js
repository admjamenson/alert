'use strict';

const DEFAULT_ECONOMICS_POLICY = Object.freeze({
  freeRevenueUsdMonthly: 2.0,
  premiumRevenueUsdMonthly: 4.0,
  freeMaxCostRatio: 0.2,
  premiumMaxCostRatio: 0.3,
});

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampRatio = (value, fallback) => {
  const parsed = numberOr(value, fallback);
  return Math.max(0, Math.min(1, parsed));
};

const nonNegative = (value, fallback) => Math.max(0, numberOr(value, fallback));

const normalizeTier = tier => {
  const normalized = String(tier || '')
    .trim()
    .toLowerCase();
  return normalized === 'premium' ? 'premium' : 'free';
};

const readEconomicsPolicy = (env = process.env) => {
  const freeRevenueUsdMonthly = nonNegative(
    env.ALERT_FREE_REVENUE_USD_MONTHLY,
    DEFAULT_ECONOMICS_POLICY.freeRevenueUsdMonthly,
  );
  const premiumRevenueUsdMonthly = nonNegative(
    env.ALERT_PREMIUM_REVENUE_USD_MONTHLY,
    DEFAULT_ECONOMICS_POLICY.premiumRevenueUsdMonthly,
  );
  const freeMaxCostRatio = clampRatio(
    env.ALERT_FREE_MAX_COST_RATIO,
    DEFAULT_ECONOMICS_POLICY.freeMaxCostRatio,
  );
  const premiumMaxCostRatio = clampRatio(
    env.ALERT_PREMIUM_MAX_COST_RATIO,
    DEFAULT_ECONOMICS_POLICY.premiumMaxCostRatio,
  );

  return {
    freeRevenueUsdMonthly,
    premiumRevenueUsdMonthly,
    freeMaxCostRatio,
    premiumMaxCostRatio,
    freeBudgetUsdMonthly: freeRevenueUsdMonthly * freeMaxCostRatio,
    premiumBudgetUsdMonthly:
      premiumRevenueUsdMonthly * premiumMaxCostRatio,
  };
};

const getTierRevenueUsd = (tier, env = process.env) => {
  const policy = readEconomicsPolicy(env);
  return normalizeTier(tier) === 'premium'
    ? policy.premiumRevenueUsdMonthly
    : policy.freeRevenueUsdMonthly;
};

const getTierBudgetUsd = (tier, env = process.env) => {
  const policy = readEconomicsPolicy(env);
  return normalizeTier(tier) === 'premium'
    ? policy.premiumBudgetUsdMonthly
    : policy.freeBudgetUsdMonthly;
};

module.exports = {
  DEFAULT_ECONOMICS_POLICY,
  readEconomicsPolicy,
  getTierBudgetUsd,
  getTierRevenueUsd,
  normalizeTier,
};
