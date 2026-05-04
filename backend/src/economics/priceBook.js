'use strict';

const fs = require('node:fs');

const TRUSTED_STRICT_ORIGINS = new Set(['real', 'estimated_reliable']);
const ORIGIN_PRIORITY = {
  absent: 0,
  modeled: 1,
  estimated_reliable: 2,
  real: 3,
};

const COST_DEFINITIONS = [
  {
    key: 'queueRedisMonthlyUsd',
    label: 'queue_redis_monthly',
    defaultValue: 0,
    required: true,
  },
  {
    key: 'cacheRedisMonthlyUsd',
    label: 'cache_redis_monthly',
    defaultValue: 0,
    required: true,
  },
  {
    key: 'workerComputeMonthlyUsd',
    label: 'worker_compute_monthly',
    defaultValue: 0,
    required: true,
  },
  {
    key: 'feedServingCostUsd',
    label: 'feed_serving',
    defaultValue: 0.000002,
    required: true,
  },
  {
    key: 'providerMissCostUsd',
    label: 'provider_miss',
    defaultValue: 0.0012,
    required: true,
  },
  {
    key: 'weatherMissCostUsd',
    label: 'weather_miss',
    defaultValue: 0.0009,
    required: true,
    aliases: ['weatherProviderMissCostUsd'],
  },
  {
    key: 'mapSessionCostUsd',
    label: 'maps',
    defaultValue: 0.00003,
    required: true,
  },
  {
    key: 'routingCostUsd',
    label: 'routing',
    defaultValue: 0.00004,
    required: true,
  },
  {
    key: 'sosRelayCostUsd',
    label: 'sos_relay',
    defaultValue: 0.0002,
    required: true,
  },
  {
    key: 'pushFanoutCostUsd',
    label: 'push_fanout',
    defaultValue: 0.00001,
    required: true,
    aliases: ['pushCostUsd'],
  },
  {
    key: 'queueJobCostUsd',
    label: 'queue_job',
    defaultValue: 0.000002,
    required: true,
  },
  {
    key: 'cacheOperationCostUsd',
    label: 'cache',
    defaultValue: 0.0000002,
    required: true,
  },
  {
    key: 'telemetryCostUsd',
    label: 'telemetry',
    defaultValue: 0.000001,
    required: true,
  },
  {
    key: 'storageCostUsd',
    label: 'storage',
    defaultValue: 0.026,
    required: true,
    aliases: ['storageGbMonthCostUsd'],
  },
  {
    key: 'webServingCostUsd',
    label: 'web_serving',
    defaultValue: 0.000004,
    required: true,
    aliases: ['backendRequestCostUsd'],
  },
  {
    key: 'backgroundWorkerExecutionCostUsd',
    label: 'background_worker_execution',
    defaultValue: 0.000003,
    required: true,
  },
  {
    key: 'paymentProcessorPercent',
    label: 'payment_processor_percent',
    defaultValue: 0.029,
    required: true,
  },
  {
    key: 'paymentProcessorFixedFeeUsd',
    label: 'payment_processor_fixed',
    defaultValue: 0.3,
    required: true,
    aliases: ['paymentProcessorFixedUsd'],
  },
  {
    key: 'appStoreFeePercent',
    label: 'app_store_fee_percent',
    defaultValue: 0.15,
    required: true,
  },
  {
    key: 'playStoreFeePercent',
    label: 'play_store_fee_percent',
    defaultValue: 0.15,
    required: true,
  },
];

const COST_KEYS = COST_DEFINITIONS.map(definition => definition.key);
const LEGACY_COST_ALIASES = Object.fromEntries(
  COST_DEFINITIONS.flatMap(definition =>
    (definition.aliases || []).map(alias => [alias, definition.key]),
  ),
);
const REQUIRED_COST_KEYS = COST_DEFINITIONS.filter(definition => definition.required).map(
  definition => definition.key,
);

const parseBoolean = value =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const parseJson = (raw, source) => {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `invalid_price_book_json:${source}:${error.message}`,
    };
  }
};

const normalizeOrigin = (value, fallback = 'modeled') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'real') return 'real';
  if (
    normalized === 'estimated_reliable' ||
    normalized === 'estimated-reliable' ||
    normalized === 'reliable_estimate' ||
    normalized === 'estimated'
  ) {
    return 'estimated_reliable';
  }
  if (normalized === 'modeled' || normalized === 'modelled') return 'modeled';
  if (normalized === 'absent' || normalized === 'missing') return 'absent';
  return fallback;
};

const readCostContainer = input =>
  input && typeof input === 'object' && input.costs ? input.costs : input;

const parseCostEntry = ({ definition, raw, source, path, sourceKey }) => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return {
      key: definition.key,
      sourceKey: sourceKey || definition.key,
      label: definition.label,
      value: raw,
      origin: source === 'model_defaults' ? 'modeled' : 'estimated_reliable',
      source,
      path: path || null,
      evidence: null,
      required: definition.required,
      status: 'provided',
    };
  }

  if (!raw || typeof raw !== 'object') return null;

  const origin = normalizeOrigin(
    raw.origin || raw.classification || raw.sourceType,
    source === 'model_defaults' ? 'modeled' : 'estimated_reliable',
  );
  const value = Number(raw.value ?? raw.amountUsd ?? raw.costUsd ?? raw.rate);
  if ((!Number.isFinite(value) || value < 0) && origin !== 'absent') return null;

  return {
    key: definition.key,
    sourceKey: sourceKey || definition.key,
    label: definition.label,
    value: Number.isFinite(value) && value >= 0 ? value : 0,
    origin,
    source: raw.source || source,
    path: path || null,
    evidence: raw.evidence || raw.invoice || raw.note || raw.notes || null,
    required: definition.required,
    status: origin === 'absent' ? 'absent' : 'provided',
  };
};

const buildModeledEntries = () =>
  Object.fromEntries(
    COST_DEFINITIONS.map(definition => [
      definition.key,
      parseCostEntry({
        definition,
        raw: {
          value: definition.defaultValue,
          origin: 'modeled',
          source: 'model_defaults',
          note: 'Built-in planning default; replace with real invoice or reliable provider quote before strict approval.',
        },
        source: 'model_defaults',
      }),
    ]),
  );

const parseProvidedEntries = ({ input, source, path }) => {
  const container = readCostContainer(input);
  if (!container || typeof container !== 'object') {
    return { entries: {}, invalidCostKeys: [] };
  }

  return COST_DEFINITIONS.reduce(
    (acc, definition) => {
      const candidateKeys = [definition.key, ...(definition.aliases || [])];
      const sourceKey = candidateKeys.find(key => key in container);
      if (!sourceKey) return acc;
      const parsed = parseCostEntry({
        definition,
        raw: container[sourceKey],
        source,
        path,
        sourceKey,
      });
      if (!parsed) {
        acc.invalidCostKeys.push(definition.key);
        return acc;
      }
      acc.entries[definition.key] = parsed;
      return acc;
    },
    { entries: {}, invalidCostKeys: [] },
  );
};

const summarizeByOrigin = classifications =>
  Object.values(classifications).reduce((acc, entry) => {
    const key = entry.origin || 'absent';
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry.key);
    return acc;
  }, {});

const addCompatibilityAliases = values => {
  const next = { ...values };
  Object.entries(LEGACY_COST_ALIASES).forEach(([alias, canonical]) => {
    if (canonical in next && !(alias in next)) {
      next[alias] = next[canonical];
    }
  });
  return next;
};

const weakestOrigin = (...values) =>
  values
    .map(value => normalizeOrigin(value, 'absent'))
    .reduce(
      (weakest, current) =>
        ORIGIN_PRIORITY[current] < ORIGIN_PRIORITY[weakest]
          ? current
          : weakest,
      'real',
    );

const getStructuredValue = (input, pathSegments) => {
  if (!input || typeof input !== 'object') return undefined;
  return pathSegments.reduce((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[segment];
  }, input);
};

const parseStructuredClassifiedNumber = ({
  raw,
  pathSegments,
}) => {
  const structuredPath = pathSegments.join('.');

  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0
      ? {
          value: raw,
          origin: 'estimated_reliable',
          evidence: null,
          path: structuredPath,
        }
      : {
          value: null,
          origin: 'absent',
          evidence: `invalid_numeric_value:${structuredPath}`,
          path: structuredPath,
        };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      value: null,
      origin: 'absent',
      evidence: `missing_structured_value:${structuredPath}`,
      path: structuredPath,
    };
  }

  const origin = normalizeOrigin(
    raw.origin || raw.classification || raw.sourceType,
    raw.value === null || typeof raw.value === 'undefined'
      ? 'absent'
      : 'estimated_reliable',
  );
  const value = Number(raw.value ?? raw.amountUsd ?? raw.costUsd ?? raw.rate);

  if ((!Number.isFinite(value) || value < 0) && origin !== 'absent') {
    return {
      value: null,
      origin: 'absent',
      evidence: `invalid_structured_value:${structuredPath}`,
      path: structuredPath,
    };
  }

  return {
    value: Number.isFinite(value) && value >= 0 ? value : null,
    origin,
    evidence: raw.evidence || raw.invoice || raw.note || raw.notes || null,
    path: structuredPath,
  };
};

const MONTHLY_INFRASTRUCTURE_DEFINITIONS = [
  {
    key: 'queueRedisMonthlyUsd',
    path: ['monthlyInfrastructure', 'queueRedisMonthlyUsd'],
  },
  {
    key: 'cacheRedisMonthlyUsd',
    path: ['monthlyInfrastructure', 'cacheRedisMonthlyUsd'],
  },
  {
    key: 'workerComputeMonthlyUsd',
    path: ['monthlyInfrastructure', 'workerComputeMonthlyUsd'],
  },
  {
    key: 'webServingMonthlyUsd',
    path: ['monthlyInfrastructure', 'webServingMonthlyUsd'],
  },
];

const DEFAULT_BILLING_ECONOMIC_POLICY = Object.freeze({
  sampleWindow: 'calendar_month_utc',
  tiers: {
    free: {
      targetCostCapPercent: 0.2,
    },
    premium: {
      targetCostCapPercent: 0.3,
    },
  },
  lowSampleProtection: {
    minObservedActiveUsers: 100,
    minTotalSuccessfulCalls: 1000,
  },
  sharedPlatformAllocation: {
    rateioFormula:
      'sharedMonthlyInfrastructureUsd / max(observedActiveUsers, minObservedActiveUsers)',
    classificationBelowThreshold: 'estimated_reliable',
  },
  requestMarginalCostFallback: {
    rateioFormula:
      'fixed_platform_cost_stays_in_platformAllocationCost; use_marginal_request_proxy_when_external_provider_unit_cost_is_absent',
    routingCostUsdPerCall: {
      value: 0.000004,
      classification: 'modeled',
      evidence:
        'Modeled marginal backend serving proxy for routing requests. Keep modeled until measured or invoice-backed per-request cost exists for the active routing path.',
      source: 'alert_unit_economics_marginal_proxy',
    },
    weatherCostUsdPerCall: {
      value: 0.000004,
      classification: 'modeled',
      evidence:
        'Modeled marginal backend serving proxy for weather requests. Keep modeled until measured or invoice-backed per-request cost exists for the active weather path.',
      source: 'alert_unit_economics_marginal_proxy',
    },
  },
});

const readMonthlyInfrastructureSnapshot = priceBook => {
  const document =
    priceBook && typeof priceBook === 'object' && priceBook.document
      ? priceBook.document
      : null;

  const entries = MONTHLY_INFRASTRUCTURE_DEFINITIONS.map(definition => {
    const raw = getStructuredValue(document, definition.path);
    const parsed = parseStructuredClassifiedNumber({
      raw,
      pathSegments: definition.path,
    });
    return {
      key: definition.key,
      ...parsed,
    };
  });

  const missingKeys = entries
    .filter(entry => entry.origin === 'absent' || entry.value === null)
    .map(entry => entry.key);
  const totalMonthlyUsd =
    missingKeys.length > 0
      ? null
      : entries.reduce((sum, entry) => sum + Number(entry.value || 0), 0);

  return {
    totalMonthlyUsd,
    classification:
      missingKeys.length > 0
        ? 'absent'
        : weakestOrigin(...entries.map(entry => entry.origin)),
    entries,
    missingKeys,
    evidence: entries
      .map(entry => entry.evidence)
      .filter(Boolean)
      .join(' | ') || null,
  };
};

const readEconomicPolicyConfig = priceBook => {
  const document =
    priceBook && typeof priceBook === 'object' && priceBook.document
      ? priceBook.document
      : null;
  const raw =
    document && typeof document.economicPolicy === 'object'
      ? document.economicPolicy
      : {};
  const freeTargetCostCapPercent = Number(
    raw?.tiers?.free?.targetCostCapPercent ??
      DEFAULT_BILLING_ECONOMIC_POLICY.tiers.free.targetCostCapPercent,
  );
  const premiumTargetCostCapPercent = Number(
    raw?.tiers?.premium?.targetCostCapPercent ??
      DEFAULT_BILLING_ECONOMIC_POLICY.tiers.premium.targetCostCapPercent,
  );
  const minObservedActiveUsers = Number(
    raw?.lowSampleProtection?.minObservedActiveUsers ??
      DEFAULT_BILLING_ECONOMIC_POLICY.lowSampleProtection.minObservedActiveUsers,
  );
  const minTotalSuccessfulCalls = Number(
    raw?.lowSampleProtection?.minTotalSuccessfulCalls ??
      DEFAULT_BILLING_ECONOMIC_POLICY.lowSampleProtection.minTotalSuccessfulCalls,
  );
  const normalizeFallbackEntry = (entry, fallback) => {
    const parsed = parseStructuredClassifiedNumber({
      raw: entry ?? fallback,
      pathSegments: ['economicPolicy'],
    });
    return {
      value: parsed.value,
      classification: parsed.origin,
      evidence:
        entry?.evidence ||
        entry?.note ||
        fallback.evidence ||
        parsed.evidence ||
        null,
      source:
        (entry && typeof entry.source === 'string' && entry.source.trim()) ||
        fallback.source ||
        null,
    };
  };

  return {
    sampleWindow:
      String(
        raw?.sampleWindow || DEFAULT_BILLING_ECONOMIC_POLICY.sampleWindow,
      ).trim() || DEFAULT_BILLING_ECONOMIC_POLICY.sampleWindow,
    tiers: {
      free: {
        targetCostCapPercent:
          Number.isFinite(freeTargetCostCapPercent) &&
          freeTargetCostCapPercent > 0
            ? freeTargetCostCapPercent
            : DEFAULT_BILLING_ECONOMIC_POLICY.tiers.free.targetCostCapPercent,
      },
      premium: {
        targetCostCapPercent:
          Number.isFinite(premiumTargetCostCapPercent) &&
          premiumTargetCostCapPercent > 0
            ? premiumTargetCostCapPercent
            : DEFAULT_BILLING_ECONOMIC_POLICY.tiers.premium.targetCostCapPercent,
      },
    },
    lowSampleProtection: {
      minObservedActiveUsers:
        Number.isFinite(minObservedActiveUsers) && minObservedActiveUsers > 0
          ? minObservedActiveUsers
          : DEFAULT_BILLING_ECONOMIC_POLICY.lowSampleProtection
              .minObservedActiveUsers,
      minTotalSuccessfulCalls:
        Number.isFinite(minTotalSuccessfulCalls) && minTotalSuccessfulCalls > 0
          ? minTotalSuccessfulCalls
          : DEFAULT_BILLING_ECONOMIC_POLICY.lowSampleProtection
              .minTotalSuccessfulCalls,
    },
    sharedPlatformAllocation: {
      rateioFormula:
        String(
          raw?.sharedPlatformAllocation?.rateioFormula ||
            DEFAULT_BILLING_ECONOMIC_POLICY.sharedPlatformAllocation
              .rateioFormula,
        ).trim() ||
        DEFAULT_BILLING_ECONOMIC_POLICY.sharedPlatformAllocation.rateioFormula,
      classificationBelowThreshold: normalizeOrigin(
        raw?.sharedPlatformAllocation?.classificationBelowThreshold,
        DEFAULT_BILLING_ECONOMIC_POLICY.sharedPlatformAllocation
          .classificationBelowThreshold,
      ),
    },
    requestMarginalCostFallback: {
      rateioFormula:
        String(
          raw?.requestMarginalCostFallback?.rateioFormula ||
            DEFAULT_BILLING_ECONOMIC_POLICY.requestMarginalCostFallback
              .rateioFormula,
        ).trim() ||
        DEFAULT_BILLING_ECONOMIC_POLICY.requestMarginalCostFallback
          .rateioFormula,
      routingCostUsdPerCall: normalizeFallbackEntry(
        raw?.requestMarginalCostFallback?.routingCostUsdPerCall,
        DEFAULT_BILLING_ECONOMIC_POLICY.requestMarginalCostFallback
          .routingCostUsdPerCall,
      ),
      weatherCostUsdPerCall: normalizeFallbackEntry(
        raw?.requestMarginalCostFallback?.weatherCostUsdPerCall,
        DEFAULT_BILLING_ECONOMIC_POLICY.requestMarginalCostFallback
          .weatherCostUsdPerCall,
      ),
    },
  };
};

const buildPriceBook = ({
  source,
  path,
  parsedInput = {},
  strict = false,
  error,
} = {}) => {
  if (error) {
    return {
      source,
      path: path || null,
      status: 'fail',
      schemaVersion: null,
      baseCurrency: null,
      displayCurrency: null,
      document: null,
      error,
      operationalGaps: {
        missingCostKeys: REQUIRED_COST_KEYS,
        invalidCostKeys: [],
        untrustedCostKeys: [],
      },
      strict: {
        enabled: Boolean(strict),
        ok: false,
        blockers: strict ? ['invalid_pricebook'] : [],
      },
      values: {},
      providedValues: {},
      classifications: {},
      costsByClassification: { absent: COST_KEYS },
      missingCostKeys: REQUIRED_COST_KEYS,
      invalidCostKeys: [],
      untrustedCostKeys: [],
    };
  }

  const modeledEntries = buildModeledEntries();
  const { entries: providedEntries, invalidCostKeys } = parseProvidedEntries({
    input: parsedInput,
    source,
    path,
  });
  const classifications = {
    ...modeledEntries,
    ...providedEntries,
  };
  const providedKeys = Object.keys(providedEntries);
  const missingCostKeys = REQUIRED_COST_KEYS.filter(key => !(key in providedEntries));
  const absentCostKeys = REQUIRED_COST_KEYS.filter(
    key => providedEntries[key]?.origin === 'absent',
  );
  const untrustedCostKeys = REQUIRED_COST_KEYS.filter(
    key =>
      key in providedEntries &&
      !TRUSTED_STRICT_ORIGINS.has(providedEntries[key].origin),
  );
  const strictBlockers = [
    ...(missingCostKeys.length > 0 ? ['missing_required_cost_inputs'] : []),
    ...(invalidCostKeys.length > 0 ? ['invalid_cost_inputs'] : []),
    ...(untrustedCostKeys.length > 0 ? ['untrusted_cost_inputs'] : []),
    ...(absentCostKeys.length > 0 ? ['absent_required_cost_inputs'] : []),
  ];
  const strictOk = strictBlockers.length === 0;

  let status = 'modeled_no_real_price_inputs';
  if (strict && !strictOk) {
    status = 'strict_failed';
  } else if (providedKeys.length === 0) {
    status = 'modeled_no_real_price_inputs';
  } else if (missingCostKeys.length > 0) {
    status = 'partial_pricebook_with_modeled_defaults';
  } else if (untrustedCostKeys.length > 0) {
    status = 'pricebook_contains_modeled_inputs';
  } else {
    status = 'operational_pricebook';
  }

  return {
    source,
    path: path || null,
    status,
    schemaVersion: Number.isFinite(Number(parsedInput?.schemaVersion))
      ? Number(parsedInput.schemaVersion)
      : null,
    baseCurrency:
      typeof parsedInput?.baseCurrency === 'string'
        ? parsedInput.baseCurrency
        : null,
    displayCurrency:
      typeof parsedInput?.displayCurrency === 'string'
        ? parsedInput.displayCurrency
        : null,
    document: parsedInput && typeof parsedInput === 'object' ? parsedInput : null,
    operationalGaps: {
      missingCostKeys,
      absentCostKeys,
      invalidCostKeys,
      untrustedCostKeys,
    },
    strict: {
      enabled: Boolean(strict),
      ok: !strict || strictOk,
      blockers: strict ? strictBlockers : [],
      trustedOrigins: Array.from(TRUSTED_STRICT_ORIGINS),
    },
    values: addCompatibilityAliases(
      Object.fromEntries(
        Object.entries(classifications).map(([key, entry]) => [key, entry.value]),
      ),
    ),
    providedValues: addCompatibilityAliases(
      Object.fromEntries(
        Object.entries(providedEntries).map(([key, entry]) => [key, entry.value]),
      ),
    ),
    classifications,
    costsByClassification: summarizeByOrigin(classifications),
    missingCostKeys,
    absentCostKeys,
    invalidCostKeys,
    untrustedCostKeys,
    requiredCostKeys: REQUIRED_COST_KEYS,
    aliases: LEGACY_COST_ALIASES,
    inputKeyMap: Object.fromEntries(
      Object.entries(providedEntries).map(([key, entry]) => [
        key,
        entry.sourceKey || key,
      ]),
    ),
  };
};

const loadOperationalPriceBook = ({
  inlineJson = process.env.ALERT_ECONOMICS_PRICE_BOOK_JSON,
  path = process.env.ALERT_ECONOMICS_PRICE_BOOK_PATH,
  strict =
    parseBoolean(process.env.ALERT_ECONOMICS_STRICT_PRICEBOOK) ||
    parseBoolean(process.env.ALERT_REQUIRE_REAL_PRICE_BOOK),
} = {}) => {
  if (inlineJson && inlineJson.trim()) {
    const parsed = parseJson(inlineJson, 'env');
    if (!parsed.ok) {
      return buildPriceBook({
        source: 'invalid_env',
        strict,
        error: parsed.error,
      });
    }

    return buildPriceBook({
      source: 'env',
      parsedInput: parsed.value,
      strict,
    });
  }

  if (path && path.trim()) {
    try {
      const parsed = parseJson(fs.readFileSync(path, 'utf8'), path);
      if (!parsed.ok) {
        return buildPriceBook({
          source: 'invalid_file',
          path,
          strict,
          error: parsed.error,
        });
      }

      return buildPriceBook({
        source: 'file',
        path,
        parsedInput: parsed.value,
        strict,
      });
    } catch (error) {
      return buildPriceBook({
        source: 'missing_file',
        path,
        strict,
        error: error.message,
      });
    }
  }

  return buildPriceBook({
    source: 'model_defaults',
    parsedInput: {},
    strict,
  });
};

const applyPriceBookToUsage = (
  usage = {},
  priceBook = {},
  options = {},
) => {
  const merged = {
    ...usage,
    ...(priceBook.values || {}),
  };

  if (!options.useModeledDefaultsForAbsentCosts) {
    return merged;
  }

  const classifications =
    priceBook && typeof priceBook === 'object' ? priceBook.classifications : {};

  COST_DEFINITIONS.forEach(definition => {
    const entry =
      classifications && typeof classifications === 'object'
        ? classifications[definition.key]
        : null;
    const origin = normalizeOrigin(
      entry?.origin || entry?.classification,
      'absent',
    );
    if (origin === 'absent') {
      merged[definition.key] = definition.defaultValue;
    }
  });

  return addCompatibilityAliases(merged);
};

module.exports = {
  COST_DEFINITIONS,
  COST_KEYS,
  LEGACY_COST_ALIASES,
  REQUIRED_COST_KEYS,
  applyPriceBookToUsage,
  loadOperationalPriceBook,
  normalizeOrigin,
  readEconomicPolicyConfig,
  readMonthlyInfrastructureSnapshot,
};
