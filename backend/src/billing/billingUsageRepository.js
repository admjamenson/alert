const {
  readEconomicPolicyConfig,
  readMonthlyInfrastructureSnapshot,
} = require('../economics/priceBook');
const {
  allocateMonthlyInfrastructureCostPerUser,
} = require('../economics/unitEconomics');

const BILLING_USAGE_COLLECTION = 'billing_usage_monthly';
const DEFAULT_USAGE_COVERAGE_STARTED_AT = '2026-04-30T00:00:00.000Z';
const CLASSIFICATION_PRIORITY = {
  absent: 0,
  modeled: 1,
  estimated_reliable: 2,
  real: 3,
};

const normalizeDate = value => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value && typeof value.toDate === 'function') {
    const next = value.toDate();
    return next instanceof Date && Number.isFinite(next.getTime()) ? next : null;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const nowIso = value => {
  const normalized = normalizeDate(value) || new Date();
  return normalized.toISOString();
};

const startOfUtcMonth = value => {
  const normalized = normalizeDate(value) || new Date();
  return new Date(
    Date.UTC(
      normalized.getUTCFullYear(),
      normalized.getUTCMonth(),
      1,
      0,
      0,
      0,
      0,
    ),
  );
};

const periodKeyForDate = value => {
  const normalized = normalizeDate(value) || new Date();
  const year = normalized.getUTCFullYear();
  const month = String(normalized.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const usageDocIdFor = ({ periodKey, userId }) =>
  `${String(periodKey || '').trim()}::${encodeURIComponent(
    String(userId || '').trim(),
  )}`;

const coverageStartDate = () =>
  normalizeDate(
    process.env.ALERT_BILLING_USAGE_COVERAGE_STARTED_AT ||
      DEFAULT_USAGE_COVERAGE_STARTED_AT,
  );

const weakestClassification = (...values) =>
  values
    .map(value => String(value || 'absent').trim().toLowerCase() || 'absent')
    .reduce(
      (weakest, current) =>
        CLASSIFICATION_PRIORITY[current] < CLASSIFICATION_PRIORITY[weakest]
          ? current
          : weakest,
      'real',
    );

const userIdForBillingUsage = identity => {
  const stableUserId = String(identity?.hasUserId ? identity.userId : '').trim();
  return stableUserId || null;
};

const runDocumentUpdate = async ({ db, docRef, buildNext }) => {
  if (typeof db?.runTransaction === 'function') {
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(docRef);
      const current = snapshot?.exists ? snapshot.data() || {} : {};
      const next = buildNext(current);
      transaction.set(docRef, next, { merge: true });
      return next;
    });
  }

  const snapshot = await docRef.get();
  const current = snapshot?.exists ? snapshot.data() || {} : {};
  const next = buildNext(current);
  await docRef.set(next, { merge: true });
  return next;
};

const recordUsage = async ({
  db,
  identity,
  kind,
  occurredAt = new Date(),
}) => {
  const userId = userIdForBillingUsage(identity);
  if (!db || typeof db.collection !== 'function') {
    return { recorded: false, reason: 'firestore_unavailable' };
  }
  if (!userId) {
    return { recorded: false, reason: 'missing_stable_user_id' };
  }
  if (kind !== 'routing' && kind !== 'weather') {
    return { recorded: false, reason: 'unsupported_usage_kind' };
  }

  const periodStart = startOfUtcMonth(occurredAt);
  const periodKey = periodKeyForDate(periodStart);
  const docRef = db
    .collection(BILLING_USAGE_COLLECTION)
    .doc(usageDocIdFor({ periodKey, userId }));
  const occurredAtIso = nowIso(occurredAt);
  const coverageStartedAtIso = nowIso(coverageStartDate());

  const next = await runDocumentUpdate({
    db,
    docRef,
    buildNext: current => {
      const routingCalls = Number(current?.routing_calls || 0);
      const weatherCalls = Number(current?.weather_calls || 0);
      return {
        period_key: periodKey,
        period_started_at: periodStart.toISOString(),
        aggregation_period: 'calendar_month_utc',
        coverage_started_at:
          String(current?.coverage_started_at || '').trim() ||
          coverageStartedAtIso,
        user_id: userId,
        routing_calls: kind === 'routing' ? routingCalls + 1 : routingCalls,
        weather_calls: kind === 'weather' ? weatherCalls + 1 : weatherCalls,
        total_useful_requests:
          Number(current?.total_useful_requests || 0) + 1,
        first_useful_request_at:
          String(current?.first_useful_request_at || '').trim() ||
          occurredAtIso,
        last_useful_request_at: occurredAtIso,
        last_request_kind: kind,
        last_user_id_source:
          String(identity?.userIdSource || '').trim() || null,
        updated_at: occurredAtIso,
      };
    },
  });

  return {
    recorded: true,
    userId,
    periodKey,
    routingCalls: Number(next?.routing_calls || 0),
    weatherCalls: Number(next?.weather_calls || 0),
  };
};

const buildAbsentUsageSnapshot = ({
  userId,
  periodKey,
  evidence,
}) => ({
  userId: userId || null,
  periodKey,
  periodStart: startOfUtcMonth(`${periodKey}-01T00:00:00.000Z`).toISOString(),
  routingCalls: null,
  weatherCalls: null,
  classification: 'absent',
  evidence,
});

const readBillingUsageSnapshot = async ({
  db,
  userId,
  asOf = new Date(),
}) => {
  const stableUserId = String(userId || '').trim();
  const periodStart = startOfUtcMonth(asOf);
  const periodKey = periodKeyForDate(periodStart);

  if (!stableUserId) {
    return buildAbsentUsageSnapshot({
      userId: null,
      periodKey,
      evidence: 'missing_billing_user_id_for_usage_lookup',
    });
  }
  if (!db || typeof db.collection !== 'function') {
    return buildAbsentUsageSnapshot({
      userId: stableUserId,
      periodKey,
      evidence: 'firestore_unavailable_for_usage_lookup',
    });
  }

  const snapshot = await db
    .collection(BILLING_USAGE_COLLECTION)
    .doc(usageDocIdFor({ periodKey, userId: stableUserId }))
    .get();

  if (!snapshot?.exists) {
    return buildAbsentUsageSnapshot({
      userId: stableUserId,
      periodKey,
      evidence: `usage_snapshot_not_found:${periodKey}`,
    });
  }

  const data = snapshot.data() || {};
  const routingCalls = Number.isFinite(Number(data.routing_calls))
    ? Number(data.routing_calls)
    : null;
  const weatherCalls = Number.isFinite(Number(data.weather_calls))
    ? Number(data.weather_calls)
    : null;
  if (routingCalls === null || weatherCalls === null) {
    return buildAbsentUsageSnapshot({
      userId: stableUserId,
      periodKey,
      evidence: `usage_snapshot_invalid:${periodKey}`,
    });
  }

  const coverageStartedAt = coverageStartDate();
  const classification =
    coverageStartedAt && coverageStartedAt.getTime() > periodStart.getTime()
      ? 'estimated_reliable'
      : 'real';

  return {
    userId: stableUserId,
    periodKey,
    periodStart: periodStart.toISOString(),
    routingCalls,
    weatherCalls,
    classification,
    evidence:
      classification === 'real'
        ? `backend_usage_ledger:${periodKey}`
        : `backend_usage_ledger_partial_month:${periodKey}:coverage_started_at=${nowIso(
            coverageStartedAt,
          )}`,
    lastUsefulRequestAt:
      String(data.last_useful_request_at || '').trim() || null,
  };
};

const readMonthlyUsageTotals = async ({
  db,
  asOf = new Date(),
}) => {
  const periodStart = startOfUtcMonth(asOf);
  const periodKey = periodKeyForDate(periodStart);

  if (!db || typeof db.collection !== 'function') {
    return {
      periodKey,
      periodStart: periodStart.toISOString(),
      routingCalls: 0,
      weatherCalls: 0,
      totalSuccessfulCalls: 0,
      classification: 'absent',
      evidence: 'firestore_unavailable_for_usage_totals',
    };
  }

  const snapshot = await db
    .collection(BILLING_USAGE_COLLECTION)
    .where('period_key', '==', periodKey)
    .get();
  const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
  if (docs.length === 0) {
    return {
      periodKey,
      periodStart: periodStart.toISOString(),
      routingCalls: 0,
      weatherCalls: 0,
      totalSuccessfulCalls: 0,
      docsCount: 0,
      classification: 'absent',
      evidence: `usage_totals_not_found:${periodKey}`,
    };
  }

  const totals = docs.reduce(
    (acc, doc) => {
      const data = doc?.data?.() || {};
      const routingCalls = Number(data.routing_calls || 0);
      const weatherCalls = Number(data.weather_calls || 0);
      return {
        routingCalls:
          acc.routingCalls +
          (Number.isFinite(routingCalls) && routingCalls > 0 ? routingCalls : 0),
        weatherCalls:
          acc.weatherCalls +
          (Number.isFinite(weatherCalls) && weatherCalls > 0 ? weatherCalls : 0),
      };
    },
    {
      routingCalls: 0,
      weatherCalls: 0,
    },
  );
  const totalSuccessfulCalls = totals.routingCalls + totals.weatherCalls;
  const coverageStartedAt = coverageStartDate();
  const classification =
    coverageStartedAt && coverageStartedAt.getTime() > periodStart.getTime()
      ? 'estimated_reliable'
      : 'real';

  return {
    periodKey,
    periodStart: periodStart.toISOString(),
    routingCalls: totals.routingCalls,
    weatherCalls: totals.weatherCalls,
    totalSuccessfulCalls,
    docsCount: docs.length,
    classification,
    evidence:
      classification === 'real'
        ? `billing_usage_monthly:${periodKey}:docs=${docs.length}`
        : `billing_usage_monthly_partial_month:${periodKey}:docs=${docs.length}:coverage_started_at=${nowIso(
            coverageStartedAt,
          )}`,
  };
};

const readActivePremiumUserCount = async db => {
  if (!db || typeof db.collection !== 'function') {
    return {
      activeUsers: null,
      evidence: 'firestore_unavailable_for_active_premium_count',
    };
  }

  const snapshot = await db
    .collection('billing_subscriptions')
    .where('premium_active', '==', true)
    .get();
  const activeUsers = Number.isFinite(Number(snapshot?.size))
    ? Number(snapshot.size)
    : Array.isArray(snapshot?.docs)
      ? snapshot.docs.length
      : null;

  return {
    activeUsers,
    evidence: `billing_subscriptions.premium_active:${activeUsers}`,
  };
};

const readPlatformAllocationSnapshot = async ({
  db,
  priceBook,
  asOf = new Date(),
}) => {
  const infrastructure = readMonthlyInfrastructureSnapshot(priceBook);
  const economicPolicy = readEconomicPolicyConfig(priceBook);
  const activePremiumUsers = await readActivePremiumUserCount(db);
  const observedActiveUsers = activePremiumUsers.activeUsers;
  const minObservedActiveUsers =
    economicPolicy.lowSampleProtection.minObservedActiveUsers;
  const effectiveAllocationUsers =
    Number.isFinite(Number(observedActiveUsers)) && observedActiveUsers > 0
      ? Math.max(observedActiveUsers, minObservedActiveUsers)
      : observedActiveUsers;
  const lowSampleProtectionApplied =
    Number.isFinite(Number(observedActiveUsers)) &&
    observedActiveUsers > 0 &&
    effectiveAllocationUsers > observedActiveUsers;
  const weakest = weakestClassification(
    infrastructure.classification,
    lowSampleProtectionApplied
      ? economicPolicy.sharedPlatformAllocation.classificationBelowThreshold
      : observedActiveUsers && observedActiveUsers > 0
        ? 'real'
        : 'absent',
  );
  const amountUsd = allocateMonthlyInfrastructureCostPerUser({
    totalMonthlyInfrastructureUsd: infrastructure.totalMonthlyUsd,
    activeUsers: effectiveAllocationUsers,
  });

  if (amountUsd === null || weakest === 'absent') {
    return {
      amountUsd: null,
      classification: 'absent',
      evidence: [
        infrastructure.missingKeys.length > 0
          ? `missing_monthly_infrastructure=${infrastructure.missingKeys.join(',')}`
          : null,
        activePremiumUsers.activeUsers === null
          ? activePremiumUsers.evidence
          : activePremiumUsers.activeUsers <= 0
            ? 'no_active_premium_users_for_allocation'
            : null,
      ]
        .filter(Boolean)
        .join(' | ') || 'platform_allocation_unavailable',
      periodKey: periodKeyForDate(asOf),
      includedMonthlyInfrastructureKeys: infrastructure.entries
        .filter(entry => entry.value !== null && entry.origin !== 'absent')
        .map(entry => entry.key),
      activeUsers: observedActiveUsers,
      observedActiveUsers,
      effectiveAllocationUsers,
      minSampleThreshold: minObservedActiveUsers,
      lowSampleProtectionApplied,
      sampleWindow: economicPolicy.sampleWindow,
      sharedMonthlyInfrastructureUsd: infrastructure.totalMonthlyUsd,
      rateioFormula: economicPolicy.sharedPlatformAllocation.rateioFormula,
    };
  }

  return {
    amountUsd,
    classification: weakest,
    evidence: `platform_allocation_formula=(${infrastructure.entries
      .filter(entry => entry.value !== null && entry.origin !== 'absent')
      .map(entry => `${entry.key}:${entry.value}`)
      .join('+')})/max(observed_active_users:${observedActiveUsers},min_observed_active_users:${minObservedActiveUsers}) | effective_allocation_users:${effectiveAllocationUsers} | ${activePremiumUsers.evidence}`,
    periodKey: periodKeyForDate(asOf),
    includedMonthlyInfrastructureKeys: infrastructure.entries
      .filter(entry => entry.value !== null && entry.origin !== 'absent')
      .map(entry => entry.key),
    activeUsers: observedActiveUsers,
    observedActiveUsers,
    effectiveAllocationUsers,
    minSampleThreshold: minObservedActiveUsers,
    lowSampleProtectionApplied,
    sampleWindow: economicPolicy.sampleWindow,
    sharedMonthlyInfrastructureUsd: infrastructure.totalMonthlyUsd,
    rateioFormula: economicPolicy.sharedPlatformAllocation.rateioFormula,
  };
};

const buildAbsentUnitCostSnapshot = ({
  evidence,
}) => ({
  amountUsd: null,
  classification: 'absent',
  evidence,
});

const readOperationalUnitCostSnapshots = async ({
  db,
  priceBook,
  asOf = new Date(),
}) => {
  const usageTotals = await readMonthlyUsageTotals({ db, asOf });
  const economicPolicy = readEconomicPolicyConfig(priceBook);
  const fallbackMinSuccessfulCalls =
    economicPolicy.lowSampleProtection.minTotalSuccessfulCalls;

  const buildSnapshot = (kind, observedCalls, fallback) => {
    if (observedCalls <= 0) {
      return buildAbsentUnitCostSnapshot({
        evidence: `${kind}_usage_totals_unavailable:${usageTotals.periodKey}`,
      });
    }
    if (
      !Number.isFinite(Number(fallback?.value)) ||
      Number(fallback?.value) < 0 ||
      fallback?.classification === 'absent'
    ) {
      return buildAbsentUnitCostSnapshot({
        evidence:
          `${kind}_marginal_request_fallback_unavailable:${usageTotals.periodKey}`,
      });
    }

    return {
      amountUsd: Number(fallback.value),
      classification: weakestClassification(
        fallback.classification,
        usageTotals.classification === 'absent'
          ? 'estimated_reliable'
          : usageTotals.classification,
      ),
      evidence: [
        `marginal_request_cost_formula=${kind}_cost_usd_per_call(${fallback.value})`,
        usageTotals.evidence,
        `sample_window=${economicPolicy.sampleWindow}`,
        `sample_docs=${usageTotals.docsCount}`,
        `observed_${kind}_calls=${observedCalls}`,
        `observed_total_successful_calls=${usageTotals.totalSuccessfulCalls}`,
        `min_total_successful_calls_threshold=${fallbackMinSuccessfulCalls}`,
        `low_sample_protection_applied=${
          usageTotals.totalSuccessfulCalls < fallbackMinSuccessfulCalls
        }`,
        `rateio_formula=${economicPolicy.requestMarginalCostFallback.rateioFormula}`,
        'fixed_platform_cost_not_reassigned_to_request_unit_cost',
        `external_provider_cost_unproven_for_${kind}_stack`,
        fallback.evidence || null,
        fallback.source ? `policy_source=${fallback.source}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
      sampleWindow: economicPolicy.sampleWindow,
      sampleVolume: {
        docsCount: usageTotals.docsCount,
        totalSuccessfulCalls: usageTotals.totalSuccessfulCalls,
        observedCalls,
      },
      minSampleThreshold: fallbackMinSuccessfulCalls,
      lowSampleProtectionApplied:
        usageTotals.totalSuccessfulCalls < fallbackMinSuccessfulCalls,
      rateioFormula: economicPolicy.requestMarginalCostFallback.rateioFormula,
    };
  };

  return {
    periodKey: usageTotals.periodKey,
    usageTotals,
    routingUnitCostUsd: buildSnapshot(
      'routing',
      usageTotals.routingCalls,
      economicPolicy.requestMarginalCostFallback.routingCostUsdPerCall,
    ),
    weatherUnitCostUsd: buildSnapshot(
      'weather',
      usageTotals.weatherCalls,
      economicPolicy.requestMarginalCostFallback.weatherCostUsdPerCall,
    ),
  };
};

module.exports = {
  BILLING_USAGE_COLLECTION,
  DEFAULT_USAGE_COVERAGE_STARTED_AT,
  periodKeyForDate,
  readBillingUsageSnapshot,
  readOperationalUnitCostSnapshots,
  readPlatformAllocationSnapshot,
  recordRoutingUsage: params =>
    recordUsage({
      ...params,
      kind: 'routing',
    }),
  recordWeatherUsage: params =>
    recordUsage({
      ...params,
      kind: 'weather',
    }),
};
