'use strict';

const sanitizeUsd = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const buildDecision = ({
  allowed,
  degraded,
  reason,
  estimatedCostUsd,
  fallbackMode = null,
}) => ({
  allowed: Boolean(allowed),
  degraded: Boolean(degraded),
  blocked: !allowed && !degraded,
  reason: String(reason || 'unspecified'),
  estimatedCostUsd: sanitizeUsd(estimatedCostUsd),
  fallbackMode: fallbackMode ? String(fallbackMode) : null,
  generatedAt: new Date().toISOString(),
});

const allowDecision = (reason = 'allow', estimatedCostUsd = 0) =>
  buildDecision({
    allowed: true,
    degraded: false,
    reason,
    estimatedCostUsd,
  });

const degradeDecision = (
  reason = 'degrade',
  estimatedCostUsd = 0,
  fallbackMode = 'safe_response',
) =>
  buildDecision({
    allowed: false,
    degraded: true,
    reason,
    estimatedCostUsd,
    fallbackMode,
  });

const denyDecision = (reason = 'deny', estimatedCostUsd = 0) =>
  buildDecision({
    allowed: false,
    degraded: false,
    reason,
    estimatedCostUsd,
  });

module.exports = {
  allowDecision,
  degradeDecision,
  denyDecision,
  sanitizeUsd,
};
