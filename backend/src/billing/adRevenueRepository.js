'use strict';

const {buildRevenueSnapshot} = require('./costEngine');

const getAdRevenueSnapshot = userId => {
  // TODO: Implement real ad revenue aggregation from telemetry events
  // For now, use estimated reliable based on guardrail ARPU
  const estimatedArpuUsd = Number(
    process.env.ALERT_FREEMIUM_NET_AD_ARPU_USD || 0.6,
  );
  return buildRevenueSnapshot({
    amount: estimatedArpuUsd,
    currency: 'USD',
    classification: 'estimated_reliable',
    evidence: 'guardrail_arpu_estimate',
  });
};

module.exports = {
  getAdRevenueSnapshot,
};
