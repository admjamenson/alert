'use strict';

const CLASSIFICATION_ORDER = [
  'absent',
  'modeled',
  'estimated_reliable',
  'real',
];

const normalizeClassification = (value, fallback = 'absent') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'real') return 'real';
  if (
    normalized === 'estimated_reliable' ||
    normalized === 'estimated-reliable' ||
    normalized === 'estimated' ||
    normalized === 'reliable_estimate'
  ) {
    return 'estimated_reliable';
  }
  if (normalized === 'modeled' || normalized === 'modelled') return 'modeled';
  if (normalized === 'absent' || normalized === 'missing') return 'absent';
  return fallback;
};

const weakestClassification = (...classifications) => {
  const present = classifications.filter(Boolean);
  if (present.length === 0) return 'absent';

  return present.reduce((weakest, current) =>
    CLASSIFICATION_ORDER.indexOf(current) <
    CLASSIFICATION_ORDER.indexOf(weakest)
      ? current
      : weakest,
  );
};

const normalizeAmount = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const toCurrencyCode = value =>
  String(value || '')
    .trim()
    .toUpperCase() || null;

const normalizeDateLike = value => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const unique = values => Array.from(new Set(values.filter(Boolean)));

const joinEvidence = (...values) => {
  const normalized = unique(
    values.map(value => String(value || '').trim() || null),
  );
  return normalized.length > 0 ? normalized.join(' | ') : undefined;
};

const classifyModeledInput = (blockers, classification, blocker) => {
  if (classification === 'modeled') {
    blockers.push(blocker);
  }
};

const readStructuredNode = (value, path) => {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return null;
    if (!(segment in current)) return null;
    current = current[segment];
  }
  return current;
};

const hasStructuredPriceBookPath = (priceBook, path) =>
  readStructuredNode(priceBook?.document, path) !== null;

const readStructuredPriceBookValue = (priceBook, path) => {
  const rawNode = readStructuredNode(priceBook?.document, path);
  if (!rawNode || typeof rawNode !== 'object') return null;

  const classification = normalizeClassification(
    rawNode.origin || rawNode.classification,
    'absent',
  );
  const value = normalizeAmount(
    rawNode.value ?? rawNode.amountUsd ?? rawNode.costUsd ?? rawNode.rate,
  );
  if (value === null && classification !== 'absent') {
    return null;
  }

  const sourcePath = path.join('.');
  return {
    value: classification === 'absent' ? null : value,
    classification,
    currency: toCurrencyCode(rawNode.currency),
    sourcePath,
    source:
      typeof rawNode.source === 'string'
        ? String(rawNode.source).trim() || null
        : null,
    asOf: normalizeDateLike(rawNode.asOf || rawNode.effectiveDate),
    evidence: joinEvidence(
      typeof rawNode.evidence === 'string' ? rawNode.evidence : null,
      typeof rawNode.source === 'string'
        ? `pricebook_entry_source=${rawNode.source}`
        : null,
      typeof rawNode.sourceKey === 'string'
        ? `pricebook_source_key=${rawNode.sourceKey}`
        : null,
      normalizeDateLike(rawNode.asOf || rawNode.effectiveDate)
        ? `pricebook_as_of=${normalizeDateLike(rawNode.asOf || rawNode.effectiveDate)}`
        : null,
      priceBook?.source ? `pricebook_source=${priceBook.source}` : null,
      priceBook?.status ? `pricebook_status=${priceBook.status}` : null,
      priceBook?.path ? `pricebook_path=${priceBook.path}` : null,
      `pricebook_structured_path=${sourcePath}`,
    ),
  };
};

const buildLegacyCurrencyNormalizationKey = (fromCurrency, toCurrency) => {
  const from = fromCurrency.trim().toLowerCase();
  const normalizedTo = toCurrency.trim().toLowerCase();
  return `${from}To${normalizedTo.slice(0, 1).toUpperCase()}${normalizedTo.slice(1)}`;
};

const buildMissingCurrencyRateBlocker = (fromCurrency, toCurrency) =>
  `missing_currency_conversion_rate_${fromCurrency.toLowerCase()}_to_${toCurrency.toLowerCase()}`;

const buildModeledCurrencyRateBlocker = (fromCurrency, toCurrency) =>
  `currency_conversion_rate_modeled_${fromCurrency.toLowerCase()}_to_${toCurrency.toLowerCase()}`;

const currencyNormalizationCandidatePathsFor = (fromCurrency, toCurrency) => {
  const from = toCurrencyCode(fromCurrency);
  const to = toCurrencyCode(toCurrency);
  if (!from || !to) return [];

  const pairKeys = unique([
    `${from}_${to}`,
    `${from.toLowerCase()}_${to.toLowerCase()}`,
  ]);

  return [
    ['fxRates', from, to],
    ['fxRates', from.toLowerCase(), to.toLowerCase()],
    ...pairKeys.map(pair => ['fxRates', 'rates', pair]),
    ['currencyNormalization', buildLegacyCurrencyNormalizationKey(from, to)],
    ...pairKeys.map(pair => ['currencyNormalization', 'rates', pair]),
  ];
};

const readFirstStructuredPriceBookValue = (priceBook, paths) => {
  for (const path of paths) {
    const resolved = readStructuredPriceBookValue(priceBook, path);
    if (resolved) return resolved;
  }
  return null;
};

const resolveFxRate = ({priceBook, fromCurrency, toCurrency}) => {
  const from = toCurrencyCode(fromCurrency);
  const to = toCurrencyCode(toCurrency);

  if (!from || !to) {
    return {
      rate: null,
      classification: 'absent',
      baseCurrency: from,
      targetCurrency: to,
    };
  }

  if (from === to) {
    return {
      rate: 1,
      classification: 'real',
      evidence: `identity_currency_conversion:${from}`,
      baseCurrency: from,
      targetCurrency: to,
      source: 'identity_currency_conversion',
      asOf: null,
    };
  }

  const direct = readFirstStructuredPriceBookValue(
    priceBook,
    currencyNormalizationCandidatePathsFor(from, to),
  );
  if (direct && direct.value !== null && direct.classification !== 'absent') {
    return {
      rate: direct.value,
      classification: direct.classification,
      evidence: direct.evidence,
      baseCurrency: from,
      targetCurrency: to,
      sourcePath: direct.sourcePath || null,
      source: direct.source || null,
      asOf: direct.asOf || null,
    };
  }

  const inverse = readFirstStructuredPriceBookValue(
    priceBook,
    currencyNormalizationCandidatePathsFor(to, from),
  );
  if (
    inverse &&
    inverse.value !== null &&
    inverse.classification !== 'absent' &&
    inverse.value > 0
  ) {
    return {
      rate: 1 / inverse.value,
      classification: inverse.classification,
      evidence: joinEvidence(
        inverse.evidence,
        `derived_inverse_currency_rate=${to}_${from}`,
      ),
      baseCurrency: from,
      targetCurrency: to,
      sourcePath: inverse.sourcePath || null,
      source: inverse.source || null,
      asOf: inverse.asOf || null,
    };
  }

  return {
    rate: null,
    classification: 'absent',
    baseCurrency: from,
    targetCurrency: to,
  };
};

const readCurrencyConversionRate = resolveFxRate;

const readPriceBookValue = (priceBook, key) => {
  const entry = priceBook?.classifications?.[key];
  const fallbackEvidence = joinEvidence(
    priceBook?.source ? `pricebook_source=${priceBook.source}` : null,
    priceBook?.status ? `pricebook_status=${priceBook.status}` : null,
    priceBook?.path ? `pricebook_path=${priceBook.path}` : null,
    `pricebook_key=${key}`,
  );

  if (entry && typeof entry === 'object') {
    const classification = normalizeClassification(
      entry.origin || entry.classification,
      'absent',
    );
    if (classification === 'absent') {
      return {
        value: null,
        classification,
        evidence: joinEvidence(
          entry.evidence,
          entry.source ? `pricebook_entry_source=${entry.source}` : null,
          entry.sourceKey ? `pricebook_source_key=${entry.sourceKey}` : null,
          fallbackEvidence,
        ),
      };
    }

    return {
      value: normalizeAmount(entry.value),
      classification,
      evidence: joinEvidence(
        entry.evidence,
        entry.source ? `pricebook_entry_source=${entry.source}` : null,
        entry.sourceKey ? `pricebook_source_key=${entry.sourceKey}` : null,
        fallbackEvidence,
      ),
    };
  }

  const fallbackValue = normalizeAmount(priceBook?.values?.[key]);
  if (fallbackValue === null) {
    return {
      value: null,
      classification: 'absent',
      evidence: fallbackEvidence,
    };
  }

  return {
    value: fallbackValue,
    classification: 'estimated_reliable',
    evidence: fallbackEvidence,
  };
};

const buildRevenueSnapshot = ({
  amount,
  currency,
  classification = 'absent',
  evidence,
}) => {
  const normalizedAmount = normalizeAmount(amount);
  const normalizedCurrency = toCurrencyCode(currency);
  if (normalizedAmount === null || !normalizedCurrency) {
    return {
      amount: normalizedAmount,
      currency: normalizedCurrency,
      classification: 'absent',
      evidence,
    };
  }

  return {
    amount: normalizedAmount,
    currency: normalizedCurrency,
    classification: normalizeClassification(classification, 'real'),
    evidence,
  };
};

const buildUsageMetrics = ({
  routingCalls,
  weatherCalls,
  classification = 'absent',
}) => {
  const normalizedRoutingCalls = normalizeAmount(routingCalls);
  const normalizedWeatherCalls = normalizeAmount(weatherCalls);
  if (normalizedRoutingCalls === null || normalizedWeatherCalls === null) {
    return {
      routingCalls: normalizedRoutingCalls,
      weatherCalls: normalizedWeatherCalls,
      classification: 'absent',
    };
  }

  return {
    routingCalls: normalizedRoutingCalls,
    weatherCalls: normalizedWeatherCalls,
    classification: normalizeClassification(classification, 'real'),
  };
};

const buildCommercialTermsFromPriceBook = ({
  provider,
  priceBook,
  revenueCurrency,
}) => {
  const normalizedRevenueCurrency = toCurrencyCode(revenueCurrency);

  if (provider === null) {
    // Freemium: no payment processor fees
    return {
      provider: 'stripe',
      percentFee: 0,
      fixedFee: 0,
      fixedFeeCurrency: normalizedRevenueCurrency || 'USD',
      classification: 'estimated_reliable',
      evidence: 'freemium_no_payment_processor_fees',
      percentFeeClassification: 'estimated_reliable',
      fixedFeeClassification: 'estimated_reliable',
    };
  }

  if (provider === 'stripe') {
    const percent =
      readStructuredPriceBookValue(priceBook, [
        'commercialTerms',
        'stripe',
        'percentFee',
      ]) || readPriceBookValue(priceBook, 'paymentProcessorPercent');
    const fixed =
      readStructuredPriceBookValue(priceBook, [
        'commercialTerms',
        'stripe',
        'fixedFee',
      ]) || readPriceBookValue(priceBook, 'paymentProcessorFixedFeeUsd');

    return {
      provider,
      percentFee: percent.value ?? 0,
      fixedFee: fixed.value ?? 0,
      fixedFeeCurrency: fixed.currency || 'USD',
      classification: weakestClassification(
        percent.classification,
        fixed.classification,
      ),
      evidence: joinEvidence(percent.evidence, fixed.evidence),
      percentFeeClassification: percent.classification,
      fixedFeeClassification: fixed.classification,
    };
  }

  const percentKey =
    provider === 'app_store' ? 'appStoreFeePercent' : 'playStoreFeePercent';
  const percent =
    (provider === 'app_store'
      ? readStructuredPriceBookValue(priceBook, [
          'commercialTerms',
          'app_store',
          'chosenPercentFee',
        ])
      : readStructuredPriceBookValue(priceBook, [
          'commercialTerms',
          'play_store',
          'percentFee',
        ])) || readPriceBookValue(priceBook, percentKey);

  return {
    provider,
    percentFee: percent.value ?? 0,
    fixedFee: 0,
    fixedFeeCurrency: normalizedRevenueCurrency || 'USD',
    classification: percent.classification,
    evidence: joinEvidence(
      percent.evidence,
      'provider_fixed_fee=0_for_store_billing',
    ),
    percentFeeClassification: percent.classification,
    fixedFeeClassification: 'real',
  };
};

const buildOperationalCostsFromPriceBook = ({
  priceBook,
  platformAllocationCostUsd,
  routingUnitCostUsd,
  weatherUnitCostUsd,
}) => {
  const explicitRoutingAmount = normalizeAmount(routingUnitCostUsd?.amountUsd);
  const explicitRoutingClassification = normalizeClassification(
    routingUnitCostUsd?.classification,
    'absent',
  );
  const routing =
    explicitRoutingAmount !== null
      ? {
          value: explicitRoutingAmount,
          classification: explicitRoutingClassification,
          evidence: routingUnitCostUsd?.evidence,
        }
      : readStructuredPriceBookValue(priceBook, [
          'variableUnitCosts',
          'routingCostUsdPerCall',
        ]) || readPriceBookValue(priceBook, 'routingCostUsd');
  const explicitWeatherAmount = normalizeAmount(weatherUnitCostUsd?.amountUsd);
  const explicitWeatherClassification = normalizeClassification(
    weatherUnitCostUsd?.classification,
    'absent',
  );
  const weather =
    explicitWeatherAmount !== null
      ? {
          value: explicitWeatherAmount,
          classification: explicitWeatherClassification,
          evidence: weatherUnitCostUsd?.evidence,
        }
      : hasStructuredPriceBookPath(priceBook, [
            'variableUnitCosts',
            'weatherCostUsdPerCall',
          ])
        ? readStructuredPriceBookValue(priceBook, [
            'variableUnitCosts',
            'weatherCostUsdPerCall',
          ]) || readPriceBookValue(priceBook, 'weatherMissCostUsd')
        : readPriceBookValue(priceBook, 'weatherMissCostUsd');
  const structuredPlatformAllocation = readStructuredPriceBookValue(priceBook, [
    'userLevelDefaults',
    'infraCostPerUserUsd',
  ]);
  const explicitPlatformAmount = normalizeAmount(
    platformAllocationCostUsd?.amountUsd,
  );
  const explicitPlatformClassification = normalizeClassification(
    platformAllocationCostUsd?.classification,
    'absent',
  );
  const platformAmountUsd =
    explicitPlatformAmount !== null ||
    explicitPlatformClassification !== 'absent'
      ? explicitPlatformAmount
      : (structuredPlatformAllocation?.value ?? null);
  const platformClassification =
    explicitPlatformAmount !== null ||
    explicitPlatformClassification !== 'absent'
      ? explicitPlatformClassification
      : structuredPlatformAllocation?.classification || 'absent';
  const platformEvidence =
    explicitPlatformAmount !== null ||
    explicitPlatformClassification !== 'absent'
      ? platformAllocationCostUsd?.evidence
      : structuredPlatformAllocation?.evidence ||
        platformAllocationCostUsd?.evidence;
  const blockers = [];

  if (routing.classification === 'absent')
    blockers.push('missing_routing_unit_cost');
  classifyModeledInput(
    blockers,
    routing.classification,
    'routing_unit_cost_modeled',
  );

  if (weather.classification === 'absent')
    blockers.push('missing_weather_unit_cost');
  classifyModeledInput(
    blockers,
    weather.classification,
    'weather_unit_cost_modeled',
  );

  if (platformClassification === 'absent')
    blockers.push('missing_platform_allocation_cost');
  classifyModeledInput(
    blockers,
    platformClassification,
    'platform_allocation_cost_modeled',
  );

  return {
    routingUnitCostUsd: routing.value,
    weatherUnitCostUsd: weather.value,
    platformAllocationCostUsd: platformAmountUsd,
    classification: weakestClassification(
      routing.classification,
      weather.classification,
      platformClassification,
    ),
    blockers: unique(blockers),
    priceBookStatus: priceBook?.status || null,
    routingUnitCostClassification: routing.classification,
    weatherUnitCostClassification: weather.classification,
    platformAllocationCostClassification: platformClassification,
    evidence: {
      routingUnitCostUsd: routing.evidence,
      weatherUnitCostUsd: weather.evidence,
      platformAllocationCostUsd: platformEvidence,
    },
  };
};

const calculateUsageCost = ({
  count,
  usageClassification,
  unitCost,
  unitCostClassification,
  missingUsageBlocker,
  missingUnitCostBlocker,
  modeledUnitCostBlocker,
}) => {
  const blockers = [];

  if (count === null) {
    blockers.push(missingUsageBlocker);
    return {
      amount: null,
      currency: 'USD',
      classification: 'absent',
      blockers,
    };
  }

  if (count === 0) {
    return {
      amount: 0,
      currency: 'USD',
      classification: usageClassification,
      blockers,
    };
  }

  if (unitCost === null || unitCostClassification === 'absent') {
    blockers.push(missingUnitCostBlocker);
    return {
      amount: null,
      currency: 'USD',
      classification: 'absent',
      blockers,
    };
  }

  classifyModeledInput(
    blockers,
    unitCostClassification,
    modeledUnitCostBlocker,
  );

  return {
    amount: count * unitCost,
    currency: 'USD',
    classification: weakestClassification(
      usageClassification,
      unitCostClassification,
    ),
    blockers,
  };
};

const buildPaymentPercentComponent = (revenue, commercialTerms) => {
  const blockers = [];

  if (revenue.amount === null) blockers.push('missing_revenue_amount');
  if (!revenue.currency) blockers.push('missing_revenue_currency');
  if (commercialTerms.percentFeeClassification === 'absent') {
    blockers.push('missing_payment_processor_percent');
  }
  classifyModeledInput(
    blockers,
    commercialTerms.percentFeeClassification,
    'payment_processor_percent_modeled',
  );

  if (revenue.amount === null || !revenue.currency) {
    return {
      amount: null,
      currency: revenue.currency,
      classification: 'absent',
      blockers: unique(blockers),
    };
  }

  if (revenue.amount === 0) {
    return {
      amount: 0,
      currency: revenue.currency,
      classification: weakestClassification(
        revenue.classification,
        commercialTerms.percentFeeClassification ||
          commercialTerms.classification,
      ),
      blockers: unique(
        blockers.filter(
          blocker => blocker !== 'missing_payment_processor_percent',
        ),
      ),
    };
  }

  if (commercialTerms.percentFeeClassification === 'absent') {
    return {
      amount: null,
      currency: revenue.currency,
      classification: 'absent',
      blockers: unique(blockers),
    };
  }

  return {
    amount: revenue.amount * commercialTerms.percentFee,
    currency: revenue.currency,
    classification: weakestClassification(
      revenue.classification,
      commercialTerms.percentFeeClassification ||
        commercialTerms.classification,
    ),
    blockers: unique(blockers),
  };
};

const buildPaymentFixedComponent = (revenue, commercialTerms) => {
  const blockers = [];
  const fixedFeeClassification =
    commercialTerms.fixedFeeClassification || commercialTerms.classification;

  if (fixedFeeClassification === 'absent') {
    blockers.push('missing_payment_processor_fixed_fee');
  }
  classifyModeledInput(
    blockers,
    fixedFeeClassification,
    'payment_processor_fixed_fee_modeled',
  );

  if (commercialTerms.fixedFee === 0) {
    return {
      amount: 0,
      currency: commercialTerms.fixedFeeCurrency,
      classification: weakestClassification(fixedFeeClassification),
      blockers: unique(
        blockers.filter(
          blocker => blocker !== 'missing_payment_processor_fixed_fee',
        ),
      ),
    };
  }

  if (fixedFeeClassification === 'absent') {
    return {
      amount: null,
      currency: commercialTerms.fixedFeeCurrency,
      classification: 'absent',
      blockers: unique(blockers),
    };
  }

  return {
    amount: commercialTerms.fixedFee,
    currency: commercialTerms.fixedFeeCurrency,
    classification: weakestClassification(fixedFeeClassification),
    blockers: unique(blockers),
  };
};

const normalizeMoneyToCurrency = ({
  component,
  targetCurrency,
  priceBook,
  appliedTo,
  missingRateBlocker,
  modeledRateBlocker,
}) => {
  const normalizedTargetCurrency = toCurrencyCode(targetCurrency);
  const normalizedSourceCurrency = toCurrencyCode(component.currency);

  if (component.amount === null) {
    return component;
  }

  if (!normalizedTargetCurrency || !normalizedSourceCurrency) {
    return component;
  }

  if (normalizedTargetCurrency === normalizedSourceCurrency) {
    return {
      ...component,
      currency: normalizedTargetCurrency,
      fxNormalization: null,
    };
  }

  const conversion = readCurrencyConversionRate({
    priceBook,
    fromCurrency: normalizedSourceCurrency,
    toCurrency: normalizedTargetCurrency,
  });
  const blockers = component.blockers.slice();
  const fxBlockers = [];
  if (conversion.rate === null || conversion.classification === 'absent') {
    fxBlockers.push(
      missingRateBlocker ||
        buildMissingCurrencyRateBlocker(
          normalizedSourceCurrency,
          normalizedTargetCurrency,
        ),
    );
    blockers.push(...fxBlockers);
    return {
      amount: null,
      currency: normalizedTargetCurrency,
      classification: 'absent',
      blockers: unique(blockers),
      fxNormalization: {
        baseCurrency: normalizedSourceCurrency,
        targetCurrency: normalizedTargetCurrency,
        rate: null,
        classification: 'absent',
        evidence: conversion.evidence,
        asOf: conversion.asOf || null,
        source: conversion.source || null,
        sourcePath: conversion.sourcePath || null,
        appliedTo: [appliedTo],
        blockers: unique(fxBlockers),
      },
    };
  }

  classifyModeledInput(
    blockers,
    conversion.classification,
    modeledRateBlocker ||
      buildModeledCurrencyRateBlocker(
        normalizedSourceCurrency,
        normalizedTargetCurrency,
      ),
  );
  classifyModeledInput(
    fxBlockers,
    conversion.classification,
    modeledRateBlocker ||
      buildModeledCurrencyRateBlocker(
        normalizedSourceCurrency,
        normalizedTargetCurrency,
      ),
  );

  return {
    amount: component.amount * conversion.rate,
    currency: normalizedTargetCurrency,
    classification: weakestClassification(
      component.classification,
      conversion.classification,
    ),
    blockers: unique(blockers),
    fxNormalization: {
      baseCurrency: normalizedSourceCurrency,
      targetCurrency: normalizedTargetCurrency,
      rate: conversion.rate,
      classification: conversion.classification,
      evidence: conversion.evidence,
      asOf: conversion.asOf || null,
      source: conversion.source || null,
      sourcePath: conversion.sourcePath || null,
      appliedTo: [appliedTo],
      blockers: unique(fxBlockers),
    },
  };
};

const convertMoney = normalizeMoneyToCurrency;
const convertMonetaryComponent = normalizeMoneyToCurrency;

const combineMonetaryComponents = (components, modeledBlockers = []) => {
  const blockers = unique(
    components.flatMap(component => component.blockers).concat(modeledBlockers),
  );
  const missingComponent = components.some(
    component => component.amount === null,
  );
  if (missingComponent) {
    return {
      amount: null,
      currency: null,
      classification: 'absent',
      blockers,
    };
  }

  const meaningfulCurrencies = unique(
    components
      .filter(component => component.amount !== null && component.amount !== 0)
      .map(component => component.currency),
  );

  if (meaningfulCurrencies.length > 1) {
    return {
      amount: null,
      currency: null,
      classification: 'absent',
      blockers: unique(blockers.concat('cost_components_use_mixed_currencies')),
    };
  }

  return {
    amount: components.reduce(
      (total, component) => total + (component.amount || 0),
      0,
    ),
    currency:
      meaningfulCurrencies[0] ||
      components.find(component => component.currency)?.currency ||
      null,
    classification: weakestClassification(
      ...components.map(component => component.classification),
    ),
    blockers,
  };
};

const summarizeFxNormalization = ({calculationCurrency, components}) => {
  const entries = components
    .map(component => component.fxNormalization || null)
    .filter(Boolean);

  const mergedEntries = Array.from(
    entries.reduce((map, entry) => {
      const key = [
        entry.baseCurrency,
        entry.targetCurrency,
        String(entry.rate),
        entry.classification,
        entry.sourcePath || '',
        entry.source || '',
        entry.asOf || '',
      ].join('::');
      const current = map.get(key);
      if (!current) {
        map.set(key, {
          ...entry,
          appliedTo: unique(entry.appliedTo).sort(),
          blockers: unique(entry.blockers),
        });
        return map;
      }
      map.set(key, {
        ...current,
        evidence: joinEvidence(current.evidence, entry.evidence),
        appliedTo: unique(current.appliedTo.concat(entry.appliedTo)).sort(),
        blockers: unique(current.blockers.concat(entry.blockers)),
      });
      return map;
    }, new Map()),
  )
    .map(([, entry]) => entry)
    .sort((left, right) =>
      `${left.baseCurrency}_${left.targetCurrency}`.localeCompare(
        `${right.baseCurrency}_${right.targetCurrency}`,
      ),
    );

  return {
    calculationCurrency: toCurrencyCode(calculationCurrency),
    classification:
      mergedEntries.length > 0
        ? weakestClassification(
            ...mergedEntries.map(entry => entry.classification),
          )
        : calculationCurrency
          ? 'real'
          : 'absent',
    blockers: unique(mergedEntries.flatMap(entry => entry.blockers)),
    entries: mergedEntries,
  };
};

const analyzeCostAndMargin = ({
  revenue,
  commercialTerms,
  operationalCosts,
  usageMetrics,
  priceBook,
}) => {
  const paymentPercentNative = buildPaymentPercentComponent(
    revenue,
    commercialTerms,
  );
  const paymentFixedNative = buildPaymentFixedComponent(
    revenue,
    commercialTerms,
  );
  const paymentPercent = convertMoney({
    component: paymentPercentNative,
    targetCurrency: revenue.currency,
    priceBook,
    appliedTo: 'paymentProcessorPercentCost',
  });
  const paymentFixed = convertMoney({
    component: paymentFixedNative,
    targetCurrency: revenue.currency,
    priceBook,
    appliedTo: 'paymentProcessorFixedCost',
    missingRateBlocker: 'payment_fixed_fee_currency_mismatch',
    modeledRateBlocker: 'payment_fixed_fee_currency_modeled',
  });
  const paymentProcessor = combineMonetaryComponents(
    [paymentPercent, paymentFixed],
    commercialTerms.classification === 'modeled'
      ? ['commercial_terms_modeled']
      : [],
  );

  const routingNative = calculateUsageCost({
    count: usageMetrics.routingCalls,
    usageClassification: usageMetrics.classification,
    unitCost: operationalCosts.routingUnitCostUsd,
    unitCostClassification: operationalCosts.routingUnitCostClassification,
    missingUsageBlocker: 'missing_routing_usage',
    missingUnitCostBlocker: 'missing_routing_unit_cost',
    modeledUnitCostBlocker: 'routing_unit_cost_modeled',
  });
  const routing = convertMoney({
    component: routingNative,
    targetCurrency: revenue.currency,
    priceBook,
    appliedTo: 'routingCost',
  });

  const weatherNative = calculateUsageCost({
    count: usageMetrics.weatherCalls,
    usageClassification: usageMetrics.classification,
    unitCost: operationalCosts.weatherUnitCostUsd,
    unitCostClassification: operationalCosts.weatherUnitCostClassification,
    missingUsageBlocker: 'missing_weather_usage',
    missingUnitCostBlocker: 'missing_weather_unit_cost',
    modeledUnitCostBlocker: 'weather_unit_cost_modeled',
  });
  const weather = convertMoney({
    component: weatherNative,
    targetCurrency: revenue.currency,
    priceBook,
    appliedTo: 'weatherCost',
  });

  const platformBlockers = [];
  if (operationalCosts.platformAllocationCostClassification === 'absent') {
    platformBlockers.push('missing_platform_allocation_cost');
  }
  classifyModeledInput(
    platformBlockers,
    operationalCosts.platformAllocationCostClassification,
    'platform_allocation_cost_modeled',
  );
  const platformNative = {
    amount:
      operationalCosts.platformAllocationCostClassification === 'absent'
        ? null
        : operationalCosts.platformAllocationCostUsd,
    currency: 'USD',
    classification:
      operationalCosts.platformAllocationCostClassification === 'absent'
        ? 'absent'
        : weakestClassification(
            operationalCosts.platformAllocationCostClassification,
          ),
    blockers: unique(platformBlockers),
  };
  const platform = convertMoney({
    component: platformNative,
    targetCurrency: revenue.currency,
    priceBook,
    appliedTo: 'platformAllocationCost',
  });

  const totalCost = combineMonetaryComponents(
    [paymentProcessor, routing, weather, platform],
    operationalCosts.classification === 'modeled'
      ? ['operational_costs_modeled']
      : [],
  );
  const fxNormalization = summarizeFxNormalization({
    calculationCurrency: revenue.currency,
    components: [paymentPercent, paymentFixed, routing, weather, platform],
  });

  const marginBlockers = unique(totalCost.blockers.slice());
  if (revenue.classification === 'modeled') {
    marginBlockers.push('revenue_modeled');
  }
  if (revenue.amount === null) marginBlockers.push('missing_revenue_amount');
  if (!revenue.currency) marginBlockers.push('missing_revenue_currency');

  let marginAnalysis = {
    totalCost: null,
    margin: null,
    marginPercent: null,
    classification: 'absent',
    blockers: unique(marginBlockers),
  };

  if (
    totalCost.amount !== null &&
    totalCost.currency &&
    revenue.amount !== null &&
    revenue.currency
  ) {
    if (totalCost.currency !== revenue.currency) {
      marginBlockers.push('margin_currency_mismatch');
      marginAnalysis = {
        ...marginAnalysis,
        blockers: unique(marginBlockers),
      };
    } else {
      const margin = revenue.amount - totalCost.amount;
      marginAnalysis = {
        totalCost: totalCost.amount,
        margin,
        marginPercent: revenue.amount > 0 ? margin / revenue.amount : 0,
        classification: weakestClassification(
          revenue.classification,
          totalCost.classification,
        ),
        blockers: unique(marginBlockers),
      };
    }
  }

  return {
    revenue,
    commercialTerms,
    operationalCosts,
    usageMetrics,
    costBreakdown: {
      paymentProcessorPercentCost: paymentPercent.amount,
      paymentProcessorPercentCostCurrency: paymentPercent.currency,
      paymentProcessorFixedCost: paymentFixed.amount,
      paymentProcessorFixedCostCurrency: paymentFixed.currency || null,
      paymentProcessorCost: paymentProcessor.amount,
      paymentProcessorCostCurrency: paymentProcessor.currency,
      routingCost: routing.amount,
      routingCostCurrency: routing.currency || null,
      weatherCost: weather.amount,
      weatherCostCurrency: weather.currency || null,
      platformAllocationCost: platform.amount,
      platformAllocationCostCurrency: platform.currency || null,
      totalCost: totalCost.amount,
      totalCostCurrency: totalCost.currency,
      classification: totalCost.classification,
      blockers: totalCost.blockers,
    },
    marginAnalysis: {
      ...marginAnalysis,
      blockers: unique(
        marginAnalysis.blockers.concat(
          usageMetrics.classification === 'modeled'
            ? ['usage_metrics_modeled']
            : [],
        ),
      ),
    },
    fxNormalization,
  };
};

module.exports = {
  analyzeCostAndMargin,
  buildCommercialTermsFromPriceBook,
  buildOperationalCostsFromPriceBook,
  buildRevenueSnapshot,
  buildUsageMetrics,
  normalizeClassification,
};
