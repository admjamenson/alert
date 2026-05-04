'use strict';

const BACKEND_REQUEST_BASE = 'BACKEND_REQUEST_BASE';
const REDIS_COMMAND = 'REDIS_COMMAND';
const FIRESTORE_READ = 'FIRESTORE_READ';
const FIRESTORE_WRITE = 'FIRESTORE_WRITE';
const WEATHER_PROVIDER = 'WEATHER_PROVIDER';
const RISK_PROVIDER = 'RISK_PROVIDER';
const GEOCODING_PROVIDER = 'GEOCODING_PROVIDER';
const MAP_ROUTE_PROVIDER = 'MAP_ROUTE_PROVIDER';
const PUSH_NOTIFICATION = 'PUSH_NOTIFICATION';
const BILLING_LOOKUP = 'BILLING_LOOKUP';
const SOS_DRY_RUN = 'SOS_DRY_RUN';
const SOS_REAL_FANOUT = 'SOS_REAL_FANOUT';

const DEFAULT_COST_CATALOG = Object.freeze({
  [BACKEND_REQUEST_BASE]: 0.000001,
  [REDIS_COMMAND]: 0.000002,
  [FIRESTORE_READ]: 0.000001,
  [FIRESTORE_WRITE]: 0.000003,
  [WEATHER_PROVIDER]: 0.00005,
  [RISK_PROVIDER]: 0.0001,
  [GEOCODING_PROVIDER]: 0.00005,
  [MAP_ROUTE_PROVIDER]: 0.00005,
  [PUSH_NOTIFICATION]: 0.00001,
  [BILLING_LOOKUP]: 0.00002,
  [SOS_DRY_RUN]: 0.00001,
  [SOS_REAL_FANOUT]: 0.0001,
});

const OPERATION_ENV_MAP = Object.freeze({
  [BACKEND_REQUEST_BASE]: 'ALERT_COST_BACKEND_REQUEST_BASE_USD',
  [REDIS_COMMAND]: 'ALERT_COST_REDIS_COMMAND_USD',
  [FIRESTORE_READ]: 'ALERT_COST_FIRESTORE_READ_USD',
  [FIRESTORE_WRITE]: 'ALERT_COST_FIRESTORE_WRITE_USD',
  [WEATHER_PROVIDER]: 'ALERT_COST_WEATHER_PROVIDER_USD',
  [RISK_PROVIDER]: 'ALERT_COST_RISK_PROVIDER_USD',
  [GEOCODING_PROVIDER]: 'ALERT_COST_GEOCODING_PROVIDER_USD',
  [MAP_ROUTE_PROVIDER]: 'ALERT_COST_MAP_ROUTE_PROVIDER_USD',
  [PUSH_NOTIFICATION]: 'ALERT_COST_PUSH_NOTIFICATION_USD',
  [BILLING_LOOKUP]: 'ALERT_COST_BILLING_LOOKUP_USD',
  [SOS_DRY_RUN]: 'ALERT_COST_SOS_DRY_RUN_USD',
  [SOS_REAL_FANOUT]: 'ALERT_COST_SOS_REAL_FANOUT_USD',
});

const COST_OPERATIONS = Object.freeze(Object.keys(DEFAULT_COST_CATALOG));

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nonNegative = (value, fallback) => Math.max(0, numberOr(value, fallback));

const normalizeOperation = operation => {
  const normalized = String(operation || '')
    .trim()
    .toUpperCase();
  return COST_OPERATIONS.includes(normalized)
    ? normalized
    : BACKEND_REQUEST_BASE;
};

const readCostCatalog = (env = process.env) =>
  COST_OPERATIONS.reduce((catalog, operation) => {
    catalog[operation] = nonNegative(
      env[OPERATION_ENV_MAP[operation]],
      DEFAULT_COST_CATALOG[operation],
    );
    return catalog;
  }, {});

const getOperationCostUsd = (operation, env = process.env) =>
  readCostCatalog(env)[normalizeOperation(operation)];

const sumOperationCosts = (operations = [], env = process.env) => {
  const catalog = readCostCatalog(env);
  return (Array.isArray(operations) ? operations : [operations]).reduce(
    (total, operation) =>
      total + Number(catalog[normalizeOperation(operation)] || 0),
    0,
  );
};

module.exports = {
  BACKEND_REQUEST_BASE,
  REDIS_COMMAND,
  FIRESTORE_READ,
  FIRESTORE_WRITE,
  WEATHER_PROVIDER,
  RISK_PROVIDER,
  GEOCODING_PROVIDER,
  MAP_ROUTE_PROVIDER,
  PUSH_NOTIFICATION,
  BILLING_LOOKUP,
  SOS_DRY_RUN,
  SOS_REAL_FANOUT,
  DEFAULT_COST_CATALOG,
  COST_OPERATIONS,
  OPERATION_ENV_MAP,
  normalizeOperation,
  readCostCatalog,
  getOperationCostUsd,
  sumOperationCosts,
};
