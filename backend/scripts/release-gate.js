'use strict';

const { buildReleasePolicy } = require('../src/release/releasePolicy');

const policy = buildReleasePolicy({ env: process.env });

const status = policy.rollback.recommended
  ? 'rollback_required'
  : policy.canary.canAdvance
    ? 'canary_can_advance'
    : 'canary_hold';

console.log(
  JSON.stringify(
    {
      generatedAt: policy.generatedAt,
      status,
      release: policy.release,
      canary: policy.canary,
      slo: policy.slo,
      cost: policy.cost,
      rollback: policy.rollback,
      incident: policy.incident,
    },
    null,
    2,
  ),
);

if (policy.rollback.recommended) {
  process.exitCode = 2;
} else if (!policy.canary.canAdvance) {
  process.exitCode = 1;
}
