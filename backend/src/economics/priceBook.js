'use strict';

const fs = require('node:fs');

const TRUSTED_STRICT_ORIGINS = new Set(['real', 'estimated_reliable']);

const COST_DEFINITIONS = [
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
    key: 'weatherProviderMissCostUsd',
    label: 'weather_miss',
    defaultValue: 0.0009,
    required: true,
  },
  {
    key: 'mapSessionCostUsd',
    label: 'maps',
    defaultValue: 0.00003,
    required: true,
  },
  {
    key: 'sosRelayCostUsd',
    label: 'sos_relay',
    defaultValue: 0.0002,
    required: true,
  },
  {
    key: 'pushCostUsd',
    label: 'push',
    defaultValue: 0.00001,
    required: true,
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
    key: 'storageGbMonthCostUsd',
    label: 'storage',
    defaultValue: 0.026,
    required: true,
  },
  {
    key: 'backendRequestCostUsd',
    label: 'backend_serving',
    defaultValue: 0.000004,
    required: true,
  },
  {
    key: 'paymentProcessorPercent',
    label: 'payment_processor_percent',
    defaultValue: 0.029,
    required: true,
  },
  {
    key: 'paymentProcessorFixedUsd',
    label: 'payment_processor_fixed',
    defaultValue: 0.3,
    required: true,
  },
  {
    key: 'appStoreFeePercent',
    label: 'store_fee_percent',
    defaultValue: 0.15,
    required: true,
  },
];

const COST_KEYS = COST_DEFINITIONS.map(definition => definition.key);
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

const parseCostEntry = ({ definition, raw, source, path }) => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return {
      key: definition.key,
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

  const value = Number(raw.value ?? raw.amountUsd ?? raw.costUsd ?? raw.rate);
  if (!Number.isFinite(value) || value < 0) return null;

  const fallbackOrigin =
    source === 'model_defaults' ? 'modeled' : 'estimated_reliable';

  return {
    key: definition.key,
    label: definition.label,
    value,
    origin: normalizeOrigin(
      raw.origin || raw.classification || raw.sourceType,
      fallbackOrigin,
    ),
    source: raw.source || source,
    path: path || null,
    evidence: raw.evidence || raw.invoice || raw.note || null,
    required: definition.required,
    status: 'provided',
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
      if (!(definition.key in container)) return acc;
      const parsed = parseCostEntry({
        definition,
        raw: container[definition.key],
        source,
        path,
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
  const untrustedCostKeys = REQUIRED_COST_KEYS.filter(
    key =>
      key in providedEntries &&
      !TRUSTED_STRICT_ORIGINS.has(providedEntries[key].origin),
  );
  const strictBlockers = [
    ...(missingCostKeys.length > 0 ? ['missing_required_cost_inputs'] : []),
    ...(invalidCostKeys.length > 0 ? ['invalid_cost_inputs'] : []),
    ...(untrustedCostKeys.length > 0 ? ['untrusted_cost_inputs'] : []),
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
    operationalGaps: {
      missingCostKeys,
      invalidCostKeys,
      untrustedCostKeys,
    },
    strict: {
      enabled: Boolean(strict),
      ok: !strict || strictOk,
      blockers: strict ? strictBlockers : [],
      trustedOrigins: Array.from(TRUSTED_STRICT_ORIGINS),
    },
    values: Object.fromEntries(
      Object.entries(classifications).map(([key, entry]) => [key, entry.value]),
    ),
    providedValues: Object.fromEntries(
      Object.entries(providedEntries).map(([key, entry]) => [key, entry.value]),
    ),
    classifications,
    costsByClassification: summarizeByOrigin(classifications),
    missingCostKeys,
    invalidCostKeys,
    untrustedCostKeys,
    requiredCostKeys: REQUIRED_COST_KEYS,
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

const applyPriceBookToUsage = (usage = {}, priceBook = {}) => ({
  ...usage,
  ...(priceBook.values || {}),
});

module.exports = {
  COST_DEFINITIONS,
  COST_KEYS,
  REQUIRED_COST_KEYS,
  applyPriceBookToUsage,
  loadOperationalPriceBook,
  normalizeOrigin,
};
