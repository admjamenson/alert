const { nowIso } = require('../utils');

const fetchInfrastructureEvents = async ({ provider }) => {
  // Fail-closed by design: no synthetic outage events when official data is unavailable.
  return {
    events: [],
    status: {
      providerId: provider.id,
      adapterName: provider.adapterName,
      primaryProvider: provider.primaryProvider,
      fallbackProvider: provider.fallbackProvider,
      trustTier: provider.trustTier,
      coverage: provider.coverage,
      latencyBudgetMs: provider.latencyBudgetMs,
      updateCadence: provider.updateCadence,
      cacheTTLms: provider.cacheTTLms,
      lastFetchAt: nowIso(),
      latencyMs: 0,
      ok: false,
      stale: true,
      status: 'unavailable',
      reason: 'official_provider_not_configured',
    },
  };
};

module.exports = {
  fetchInfrastructureEvents,
};
