'use strict';

const crypto = require('node:crypto');
const { loadOperationalPriceBook } = require('../economics/priceBook');

const CANARY_STAGES = [1, 5, 10, 25, 50, 100];
const CORE_FEATURES = ['sos', 'essentialLocation', 'minimalCommunication'];
const NON_CRITICAL_FEATURES = [
  {
    key: 'sosEnhancements',
    envPercentKey: 'ALERT_FEATURE_SOS_ENHANCEMENTS_PERCENT',
  },
  { key: 'maps', envPercentKey: 'ALERT_FEATURE_MAPS_PERCENT' },
  { key: 'weather', envPercentKey: 'ALERT_FEATURE_WEATHER_PERCENT' },
  { key: 'alerts', envPercentKey: 'ALERT_FEATURE_ALERTS_PERCENT' },
  { key: 'aiChat', envPercentKey: 'ALERT_FEATURE_AI_CHAT_PERCENT' },
  {
    key: 'externalIntegrations',
    envPercentKey: 'ALERT_FEATURE_EXTERNAL_INTEGRATIONS_PERCENT',
  },
];

const BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'on']);

const readString = (env, key, fallback = '') =>
  String(env?.[key] ?? fallback ?? '').trim();

const readBoolean = (env, key, fallback = false) => {
  const raw = readString(env, key);
  if (!raw) return Boolean(fallback);
  return BOOLEAN_TRUE.has(raw.toLowerCase());
};

const readNumber = (env, key, fallback) => {
  const raw = readString(env, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseObservedMetricCandidate = value => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (typeof value === 'boolean') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const clampPercent = value => Math.max(0, Math.min(100, Number(value || 0)));
const clampUnit = value => Math.max(0, Math.min(1, Number(value || 0)));

const normalizeCsv = value =>
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const normalizeStringList = value => {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return normalizeCsv(value);
};

const stableBucket = seed => {
  const hash = crypto.createHash('sha256').update(String(seed || '')).digest();
  return hash.readUInt32BE(0) % 100;
};

const parseJsonEnv = (env, key) => {
  const raw = readString(env, key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeOverride = override => {
  const source = override && typeof override === 'object' ? override : {};
  const killSwitchSource = source.killSwitch || {};
  const canarySource = source.canary || {};
  const rollbackSource = source.rollback || {};

  return {
    version: source.version || source.releaseVersion || null,
    previousVersion:
      source.previousVersion || source.previousReleaseVersion || null,
    canaryPercent:
      source.canaryPercent ?? canarySource.percent ?? canarySource.currentPercent,
    canaryEnabled: source.canaryEnabled ?? canarySource.enabled,
    disabledFeatures:
      source.disabledFeatures || source.disabledFeatureKeys || [],
    featurePercents:
      source.featurePercents || source.features || source.featureFlags || {},
    allowedRegions:
      source.allowedRegions || canarySource.allowedRegions || [],
    allowedSegments:
      source.allowedSegments || canarySource.allowedSegments || [],
    globalKillSwitch:
      source.globalKillSwitch ?? killSwitchSource.active ?? killSwitchSource.enabled,
    forceRollback:
      source.forceRollback ?? rollbackSource.force ?? rollbackSource.active,
    manualHalt:
      source.manualHalt ?? source.haltRollout ?? canarySource.halt,
    metrics: source.metrics || source.observedMetrics || {},
    notes: source.notes || null,
    updatedAt: source.updatedAt || null,
  };
};

const readControlBoolean = (env, overrideValue, envKey, fallback = false) => {
  if (typeof overrideValue === 'boolean') return overrideValue;
  if (overrideValue !== undefined && overrideValue !== null) {
    return BOOLEAN_TRUE.has(String(overrideValue).trim().toLowerCase());
  }
  return readBoolean(env, envKey, fallback);
};

const readControlNumber = (env, overrideValue, envKey, fallback) => {
  const parsedOverride = Number(overrideValue);
  if (Number.isFinite(parsedOverride)) return parsedOverride;
  return readNumber(env, envKey, fallback);
};

const buildThresholds = env => {
  const freeRevenue = readNumber(env, 'ALERT_FREEMIUM_NET_AD_ARPU_USD', 0.6);
  const premiumRevenue = readNumber(
    env,
    'ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD',
    5,
  );

  return {
    appCrashFreeRateMin: clampUnit(
      readNumber(env, 'ALERT_SLO_APP_CRASH_FREE_RATE_MIN', 0.995),
    ),
    sosSuccessRateMin: clampUnit(
      readNumber(env, 'ALERT_SLO_SOS_SUCCESS_RATE_MIN', 0.995),
    ),
    sosP95MsMax: readNumber(env, 'ALERT_SLO_SOS_P95_MS_MAX', 1500),
    criticalApiErrorRateMax: clampUnit(
      readNumber(env, 'ALERT_SLO_CRITICAL_API_ERROR_RATE_MAX', 0.01),
    ),
    criticalApiP95MsMax: readNumber(env, 'ALERT_SLO_CRITICAL_API_P95_MS_MAX', 900),
    providerErrorRateMax: clampUnit(
      readNumber(env, 'ALERT_SLO_PROVIDER_ERROR_RATE_MAX', 0.05),
    ),
    entitlementErrorRateMax: clampUnit(
      readNumber(env, 'ALERT_SLO_ENTITLEMENT_ERROR_RATE_MAX', 0.005),
    ),
    freeCostPerUserMaxUsd: readNumber(
      env,
      'ALERT_FREE_COST_PER_USER_MAX_USD',
      freeRevenue * 0.2,
    ),
    premiumCostPerUserMaxUsd: readNumber(
      env,
      'ALERT_PREMIUM_COST_PER_USER_MAX_USD',
      premiumRevenue * 0.3,
    ),
  };
};

const readObservedMetric = ({ key, envKey, env, overrideMetrics, observedMetrics }) => {
  const candidates = [
    observedMetrics?.[key],
    overrideMetrics?.[key],
    readNumber(env, envKey, undefined),
  ];
  return candidates
    .map(parseObservedMetricCandidate)
    .find(value => value !== undefined);
};

const buildObservedMetrics = ({ env, overrideMetrics = {}, observedMetrics = {} }) => ({
  appCrashFreeRate: readObservedMetric({
    key: 'appCrashFreeRate',
    envKey: 'ALERT_OBSERVED_APP_CRASH_FREE_RATE',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  sosSuccessRate: readObservedMetric({
    key: 'sosSuccessRate',
    envKey: 'ALERT_OBSERVED_SOS_SUCCESS_RATE',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  sosP95Ms: readObservedMetric({
    key: 'sosP95Ms',
    envKey: 'ALERT_OBSERVED_SOS_P95_MS',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  criticalApiErrorRate: readObservedMetric({
    key: 'criticalApiErrorRate',
    envKey: 'ALERT_OBSERVED_CRITICAL_API_ERROR_RATE',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  criticalApiP95Ms: readObservedMetric({
    key: 'criticalApiP95Ms',
    envKey: 'ALERT_OBSERVED_CRITICAL_API_P95_MS',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  providerErrorRate: readObservedMetric({
    key: 'providerErrorRate',
    envKey: 'ALERT_OBSERVED_PROVIDER_ERROR_RATE',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  entitlementErrorRate: readObservedMetric({
    key: 'entitlementErrorRate',
    envKey: 'ALERT_OBSERVED_ENTITLEMENT_ERROR_RATE',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  freeCostPerUserUsd: readObservedMetric({
    key: 'freeCostPerUserUsd',
    envKey: 'ALERT_OBSERVED_FREE_COST_PER_USER_USD',
    env,
    overrideMetrics,
    observedMetrics,
  }),
  premiumCostPerUserUsd: readObservedMetric({
    key: 'premiumCostPerUserUsd',
    envKey: 'ALERT_OBSERVED_PREMIUM_COST_PER_USER_USD',
    env,
    overrideMetrics,
    observedMetrics,
  }),
});

const REQUIRED_RELEASE_METRIC_KEYS = [
  'appCrashFreeRate',
  'sosSuccessRate',
  'sosP95Ms',
  'criticalApiErrorRate',
  'criticalApiP95Ms',
  'providerErrorRate',
  'entitlementErrorRate',
];

const classifyReleaseMetricsInput = observed => {
  const presentMetrics = REQUIRED_RELEASE_METRIC_KEYS.filter(
    key => Number.isFinite(observed?.[key]),
  );
  const missingMetrics = REQUIRED_RELEASE_METRIC_KEYS.filter(
    key => !presentMetrics.includes(key),
  );

  let inputStatus = 'absent';
  if (presentMetrics.length === REQUIRED_RELEASE_METRIC_KEYS.length) {
    inputStatus = 'complete';
  } else if (presentMetrics.length > 0) {
    inputStatus = 'partial';
  }

  return {
    inputStatus,
    requiredMetrics: REQUIRED_RELEASE_METRIC_KEYS,
    presentMetrics,
    missingMetrics,
  };
};

const SLO_CHECKS = [
  {
    key: 'appCrashFreeRate',
    thresholdKey: 'appCrashFreeRateMin',
    direction: 'min',
    severity: 'SEV 1',
    reason: 'app_crash_rate_regression',
  },
  {
    key: 'sosSuccessRate',
    thresholdKey: 'sosSuccessRateMin',
    direction: 'min',
    severity: 'SEV 1',
    reason: 'sos_success_rate_regression',
  },
  {
    key: 'sosP95Ms',
    thresholdKey: 'sosP95MsMax',
    direction: 'max',
    severity: 'SEV 1',
    reason: 'sos_latency_regression',
  },
  {
    key: 'criticalApiErrorRate',
    thresholdKey: 'criticalApiErrorRateMax',
    direction: 'max',
    severity: 'SEV 2',
    reason: 'critical_api_error_regression',
  },
  {
    key: 'criticalApiP95Ms',
    thresholdKey: 'criticalApiP95MsMax',
    direction: 'max',
    severity: 'SEV 2',
    reason: 'critical_api_latency_regression',
  },
  {
    key: 'providerErrorRate',
    thresholdKey: 'providerErrorRateMax',
    direction: 'max',
    severity: 'SEV 3',
    reason: 'provider_error_regression',
  },
  {
    key: 'entitlementErrorRate',
    thresholdKey: 'entitlementErrorRateMax',
    direction: 'max',
    severity: 'SEV 2',
    reason: 'entitlement_error_regression',
  },
];

const COST_CHECKS = [
  {
    key: 'freeCostPerUserUsd',
    thresholdKey: 'freeCostPerUserMaxUsd',
    severity: 'SEV 3',
    reason: 'freemium_unit_cost_regression',
  },
  {
    key: 'premiumCostPerUserUsd',
    thresholdKey: 'premiumCostPerUserMaxUsd',
    severity: 'SEV 3',
    reason: 'premium_unit_cost_regression',
  },
];

const evaluateChecks = ({ observed, thresholds, checks }) => {
  const missing = [];
  const violations = [];

  checks.forEach(check => {
    const value = observed[check.key];
    const threshold = thresholds[check.thresholdKey];
    if (!Number.isFinite(value)) {
      missing.push(check.key);
      return;
    }
    const violated =
      check.direction === 'min' ? value < threshold : value > threshold;
    if (violated) {
      violations.push({
        metric: check.key,
        observed: value,
        threshold,
        severity: check.severity,
        reason: check.reason,
      });
    }
  });

  return { missing, violations };
};

const buildOperationalPriceBookStatus = env => {
  const strictEnabled =
    readBoolean(env, 'ALERT_ECONOMICS_STRICT_PRICEBOOK', false) ||
    readBoolean(env, 'ALERT_REQUIRE_REAL_PRICE_BOOK', false);
  const priceBook = loadOperationalPriceBook({
    inlineJson: env?.ALERT_ECONOMICS_PRICE_BOOK_JSON,
    path: env?.ALERT_ECONOMICS_PRICE_BOOK_PATH,
    strict: strictEnabled,
  });
  return {
    status: priceBook.status,
    source: priceBook.source,
    strict: priceBook.strict,
    missingCostKeys: priceBook.missingCostKeys || [],
    absentCostKeys: priceBook.absentCostKeys || [],
    untrustedCostKeys: priceBook.untrustedCostKeys || [],
  };
};

const evaluateCostChecks = ({ observed, thresholds }) => {
  const violations = [];

  COST_CHECKS.forEach(check => {
    const value = observed[check.key];
    if (!Number.isFinite(value)) return;
    const threshold = thresholds[check.thresholdKey];
    if (value > threshold) {
      violations.push({
        metric: check.key,
        observed: value,
        threshold,
        severity: check.severity,
        reason: check.reason,
      });
    }
  });

  return violations;
};

const severityRank = severity => {
  if (severity === 'SEV 1') return 1;
  if (severity === 'SEV 2') return 2;
  if (severity === 'SEV 3') return 3;
  return 4;
};

const highestSeverity = violations => {
  if (violations.length === 0) return 'SEV 4';
  return violations
    .map(item => item.severity || 'SEV 4')
    .sort((left, right) => severityRank(left) - severityRank(right))[0];
};

const buildIncident = ({ reasons, violations, releaseVersion }) => {
  const severity = reasons.includes('global_kill_switch_active')
    ? 'SEV 1'
    : highestSeverity(violations);
  const idSeed = `${releaseVersion}:${severity}:${reasons.join('|')}`;
  const suffix = crypto.createHash('sha1').update(idSeed).digest('hex').slice(0, 8);

  return {
    id: `REL-${suffix}`,
    severity,
    status: 'mitigating',
    description:
      severity === 'SEV 1'
        ? 'Critical release guard triggered; user safety path is protected.'
        : 'Release guard detected degraded production health.',
    impact:
      severity === 'SEV 1'
        ? 'Potential user-risk or SOS-critical regression.'
        : 'Controlled degradation before global rollout.',
    likelyCause: reasons[0] || 'release_health_regression',
    actionsTaken: [
      'halt_canary_rollout',
      'keep_sos_core_enabled',
      'disable_noncritical_features_when_needed',
      'prepare_previous_release_restore',
    ],
    reasons,
    generatedAt: new Date().toISOString(),
  };
};

const resolveFeaturePercent = ({ env, override, feature, defaultPercent }) => {
  const overridePercent = override.featurePercents?.[feature.key];
  return clampPercent(
    readControlNumber(env, overridePercent, feature.envPercentKey, defaultPercent),
  );
};

const buildFeatureControls = ({
  env,
  override,
  killSwitchActive,
  identity,
  userBucket,
}) => {
  const disabledFeatures = new Set([
    ...normalizeCsv(readString(env, 'ALERT_DISABLED_FEATURES')),
    ...normalizeStringList(override.disabledFeatures),
  ]);
  const defaultPercent = clampPercent(
    readNumber(env, 'ALERT_FEATURE_DEFAULT_PERCENT', 0),
  );
  const region = String(identity?.region || '').trim();
  const segment = String(identity?.segment || '').trim();
  const allowedRegions = new Set([
    ...normalizeCsv(readString(env, 'ALERT_RELEASE_ALLOWED_REGIONS')),
    ...normalizeStringList(override.allowedRegions),
  ]);
  const allowedSegments = new Set([
    ...normalizeCsv(readString(env, 'ALERT_RELEASE_ALLOWED_SEGMENTS')),
    ...normalizeStringList(override.allowedSegments),
  ]);
  const regionAllowed =
    allowedRegions.size === 0 || (region && allowedRegions.has(region));
  const segmentAllowed =
    allowedSegments.size === 0 || (segment && allowedSegments.has(segment));
  const rolloutScopeAllowed = regionAllowed && segmentAllowed;

  const flags = Object.fromEntries(CORE_FEATURES.map(key => [key, true]));
  const details = [];

  NON_CRITICAL_FEATURES.forEach(feature => {
    const percent = resolveFeaturePercent({
      env,
      override,
      feature,
      defaultPercent,
    });
    const disabled = disabledFeatures.has(feature.key);
    const enabled =
      !killSwitchActive &&
      !disabled &&
      rolloutScopeAllowed &&
      userBucket < percent;

    flags[feature.key] = enabled;
    details.push({
      key: feature.key,
      enabled,
      percent,
      disabled,
      reason: killSwitchActive
        ? 'global_kill_switch_active'
        : disabled
          ? 'feature_disabled'
          : !rolloutScopeAllowed
            ? 'outside_region_or_segment_scope'
            : enabled
              ? 'in_rollout'
              : 'outside_rollout_bucket',
    });
  });

  return {
    flags,
    details,
    rolloutScope: {
      region,
      segment,
      regionAllowed,
      segmentAllowed,
    },
  };
};

const normalizeCanaryPercent = value => {
  const percent = clampPercent(value);
  if (percent === 0) return { percent: 0, validStage: true };
  return {
    percent,
    validStage: CANARY_STAGES.includes(percent),
  };
};

const nextCanaryStage = current => {
  if (current <= 0) return 1;
  return CANARY_STAGES.find(stage => stage > current) || null;
};

const buildReleasePolicy = ({
  env = process.env,
  override: rawOverride,
  observedMetrics = {},
  identity = {},
} = {}) => {
  const override = normalizeOverride(rawOverride);
  const envMetrics = parseJsonEnv(env, 'ALERT_RELEASE_METRICS_JSON');
  const thresholds = buildThresholds(env);
  const observed = buildObservedMetrics({
    env,
    overrideMetrics: { ...envMetrics, ...override.metrics },
    observedMetrics,
  });
  const releaseMetrics = classifyReleaseMetricsInput(observed);
  const operationalPriceBook = buildOperationalPriceBookStatus(env);
  const slo = evaluateChecks({ observed, thresholds, checks: SLO_CHECKS });
  const costViolations = evaluateCostChecks({ observed, thresholds });
  if (operationalPriceBook.strict.enabled && !operationalPriceBook.strict.ok) {
    costViolations.push({
      metric: 'operationalPriceBook',
      observed: operationalPriceBook.status,
      threshold: 'strict_operational_pricebook',
      severity: 'SEV 3',
      reason: 'operational_pricebook_incomplete',
      blockers: operationalPriceBook.strict.blockers,
      missingCostKeys: operationalPriceBook.missingCostKeys,
      absentCostKeys: operationalPriceBook.absentCostKeys,
      untrustedCostKeys: operationalPriceBook.untrustedCostKeys,
    });
  }
  const violations = [...slo.violations, ...costViolations];

  const releaseVersion =
    override.version || readString(env, 'ALERT_RELEASE_VERSION', 'unknown');
  const previousVersion =
    override.previousVersion ||
    readString(env, 'ALERT_PREVIOUS_RELEASE_VERSION', 'unknown');
  const killSwitchActive = readControlBoolean(
    env,
    override.globalKillSwitch,
    'ALERT_GLOBAL_KILL_SWITCH',
    false,
  );
  const forceRollback = readControlBoolean(
    env,
    override.forceRollback,
    'ALERT_FORCE_ROLLBACK',
    false,
  );
  const manualHalt = readControlBoolean(
    env,
    override.manualHalt,
    'ALERT_RELEASE_HALT',
    false,
  );
  const canaryEnabled = readControlBoolean(
    env,
    override.canaryEnabled,
    'ALERT_CANARY_ENABLED',
    true,
  );
  const canaryInput = readControlNumber(
    env,
    override.canaryPercent,
    'ALERT_CANARY_PERCENT',
    0,
  );
  const canaryStage = normalizeCanaryPercent(canaryInput);
  const identitySeed =
    identity.userId || identity.deviceId || identity.sessionId || 'anonymous';
  const userBucket = stableBucket(identitySeed);
  const inCanary =
    canaryEnabled && canaryStage.percent > 0 && userBucket < canaryStage.percent;
  const missingRequiredMetrics = releaseMetrics.missingMetrics;

  const rollbackReasons = [
    ...(killSwitchActive ? ['global_kill_switch_active'] : []),
    ...(forceRollback ? ['manual_force_rollback'] : []),
    ...violations.map(item => item.reason),
  ];
  const rollbackRecommended = rollbackReasons.length > 0;
  const holdReasons = [
    ...(!canaryEnabled ? ['canary_disabled'] : []),
    ...(manualHalt ? ['manual_halt'] : []),
    ...(!canaryStage.validStage ? ['invalid_canary_stage'] : []),
    ...(rollbackRecommended ? ['rollback_recommended'] : []),
    ...(missingRequiredMetrics.length > 0
      ? ['missing_required_release_metrics']
      : []),
  ];
  const canAdvance =
    canaryEnabled &&
    canaryStage.validStage &&
    !manualHalt &&
    !rollbackRecommended &&
    missingRequiredMetrics.length === 0;
  const featureControls = buildFeatureControls({
    env,
    override,
    killSwitchActive,
    identity,
    userBucket,
  });
  const incident = rollbackRecommended
    ? buildIncident({
        reasons: rollbackReasons,
        violations,
        releaseVersion,
      })
    : null;

  return {
    generatedAt: new Date().toISOString(),
    release: {
      version: releaseVersion,
      previousVersion,
      environment: readString(env, 'APP_ENV', readString(env, 'NODE_ENV', 'development')),
    },
    canary: {
      enabled: canaryEnabled,
      stages: CANARY_STAGES,
      currentPercent: canaryStage.percent,
      validStage: canaryStage.validStage,
      nextPercent: canAdvance ? nextCanaryStage(canaryStage.percent) : null,
      inCanary,
      userBucket,
      canAdvance,
      holdReasons,
    },
    featureFlags: featureControls.flags,
    featureFlagDetails: featureControls.details,
    killSwitch: {
      active: killSwitchActive,
      mode: killSwitchActive ? 'minimal_core_only' : 'normal',
      preservedFeatures: CORE_FEATURES,
      disabledNonCriticalFeatures: killSwitchActive
        ? NON_CRITICAL_FEATURES.map(feature => feature.key)
        : [],
    },
    slo: {
      thresholds,
      observed,
      inputStatus: releaseMetrics.inputStatus,
      requiredMetrics: releaseMetrics.requiredMetrics,
      presentMetrics: releaseMetrics.presentMetrics,
      missingMetrics: missingRequiredMetrics,
      violations: slo.violations,
      healthy: slo.violations.length === 0 && missingRequiredMetrics.length === 0,
    },
    cost: {
      priceBook: operationalPriceBook,
      violations: costViolations,
      actions:
        costViolations.length > 0
          ? [
              'cache_harder',
              'reduce_frequency',
              'degrade_noncritical_features',
              ...(operationalPriceBook.strict.enabled && !operationalPriceBook.strict.ok
                ? ['block_release_promotion_until_pricebook_complete']
                : []),
            ]
          : [],
    },
    rollback: {
      recommended: rollbackRecommended,
      automaticWhenWired: true,
      action: rollbackRecommended
        ? 'halt_rollout_and_restore_previous_release'
        : 'none',
      targetVersion: rollbackRecommended ? previousVersion : null,
      reasons: rollbackReasons,
    },
    incident,
    remoteOverride: {
      loaded: Boolean(rawOverride),
      updatedAt: override.updatedAt,
      notes: override.notes,
    },
    client: {
      releaseVersion,
      canaryPercent: canaryStage.percent,
      inCanary,
      killSwitchActive,
      rollbackRecommended,
      degradedMode: killSwitchActive || rollbackRecommended,
      reasonCodes: [...holdReasons, ...rollbackReasons],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
};

module.exports = {
  CANARY_STAGES,
  CORE_FEATURES,
  NON_CRITICAL_FEATURES,
  buildReleasePolicy,
  REQUIRED_RELEASE_METRIC_KEYS,
  stableBucket,
};
