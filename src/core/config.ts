import Config from 'react-native-config';

/**
 * CORE APPLICATION CONFIGURATION
 *
 * Centralized configuration hub for Alert Premium system.
 * Enables runtime optimization and security hardening across the stack.
 *
 * MAINTENANCE: When modifying these settings, validate against performance
 * benchmarks and security audits. Each flag directly impacts system behavior.
 */

type AlertRuntimeGlobals = typeof globalThis & {
  __ALERT_MAP_CONFIG__?: Record<string, unknown>;
};

const runtimeMapConfig =
  (globalThis as AlertRuntimeGlobals).__ALERT_MAP_CONFIG__ || {};

const readNativeConfig = (key: string) =>
  String((Config as Record<string, unknown>)[key] || '').trim();

const readMapConfig = (key: string, fallback = '') =>
  String(runtimeMapConfig[key] ?? fallback).trim();

const readRuntimeConfig = (key: string, fallback = '') => {
  const runtimeValue = readMapConfig(key);
  if (runtimeValue) {
    return runtimeValue;
  }
  const nativeValue = readNativeConfig(key);
  if (nativeValue) {
    return nativeValue;
  }
  return String(fallback || '').trim();
};

const readMapFlag = (key: string, fallback = true) => {
  const raw = runtimeMapConfig[key];
  if (typeof raw === 'boolean') {
    return raw;
  }
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeApiBaseUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const readRuntimeEnv = (key: string): string => {
  const nativeConfigValue = readNativeConfig(key);
  if (nativeConfigValue) {
    return nativeConfigValue;
  }
  if (typeof process === 'undefined') return '';
  return String((process as any)?.env?.[key] || '').trim();
};

// Keep a runtime fallback for bundled Android/device builds where
// react-native-config can fail to hydrate before JS boot, which otherwise
// collapses weather/risk/maps to immediate status=0 errors on-device.
const ALERT_API_FALLBACK_BASE_URL = 'https://alert-vmpj.onrender.com';
const ALERT_API_CONFIGURED_BASE_URL = normalizeApiBaseUrl(
  readRuntimeEnv('ALERT_API_URL'),
);
const ALERT_API_BASE_URL =
  ALERT_API_CONFIGURED_BASE_URL || ALERT_API_FALLBACK_BASE_URL;
const ALERT_API_BASE_URL_SOURCE = ALERT_API_CONFIGURED_BASE_URL
  ? 'configured'
  : 'bundled_fallback';
const ALERT_APP_ENV = readRuntimeConfig('ALERT_APP_ENV', __DEV__ ? 'development' : 'production')
  .toLowerCase();
const isProductionRuntime = ALERT_APP_ENV === 'production';

/**
 * Performance Configuration
 *
 * - ENABLE_HERMES: React Native's JavaScript engine for faster startup
 *   and reduced memory footprint. Reduces cold start by ~40%.
 * - USE_NATIVE_DRIVER: Offloads animations to native thread, preventing
 *   JS thread blocking. Critical for smooth 60fps UI interactions.
 * - MEMORY_OPTIMIZATION: Enables aggressive garbage collection for
 *   long-running background services.
 * - BACKGROUND_PROCESSING: Allows background task execution on Android/iOS.
 * - IMAGE_CACHING: Disk-based caching for image assets to reduce network load.
 */
export const PERFORMANCE_CONFIG = {
  ENABLE_HERMES: true,
  USE_NATIVE_DRIVER: true,
  MEMORY_OPTIMIZATION: true,
  BACKGROUND_PROCESSING: true,
  IMAGE_CACHING: true,
};

/**
 * Security Configuration
 *
 * - SSL_PINNING: Certificate pinning prevents man-in-the-middle attacks
 *   by validating server certificates against pinned public keys.
 * - BIOMETRIC_AUTH: Face ID / Fingerprint authentication for local device access.
 * - ENCRYPTED_STORAGE: All sensitive data (tokens, keys) stored in secure enclave.
 * - JWT_REFRESH: Automatic token rotation strategy with sliding expiration.
 * - RATE_LIMITING: API request throttling to prevent brute force attacks.
 */
export const SECURITY_CONFIG = {
  SSL_PINNING: true,
  BIOMETRIC_AUTH: true,
  ENCRYPTED_STORAGE: true,
  JWT_REFRESH: true,
  RATE_LIMITING: true,
};

/**
 * Application Metadata
 *
 * Used for versioning, error reporting, and user support routing.
 */
export const APP_CONFIG = {
  NAME: 'Alert Premium',
  VERSION: '1.0.0',
  ENVIRONMENT: ALERT_APP_ENV,
  IS_PRODUCTION: isProductionRuntime,
  SUPPORT_EMAIL: 'sac.alertai@gmail.com',
  API_BASE_URL: ALERT_API_BASE_URL,
  AUTH_ANONYMOUS_ENABLED: readMapFlag('AUTH_ANONYMOUS_ENABLED', false),
  MAP_PROVIDER: readMapConfig('MAP_PROVIDER', 'osm').toLowerCase(),
  MAPTILER_KEY: readMapConfig('MAPTILER_KEY'),
  MAP_STYLE_DEFAULT_URL: readMapConfig('MAP_STYLE_DEFAULT_URL'),
  MAP_STYLE_SATELLITE_URL: readMapConfig('MAP_STYLE_SATELLITE_URL'),
  MAP_SATELLITE_ENABLED: readMapFlag('MAP_SATELLITE_ENABLED', true),
  SECURITY_MAP_V2_ENABLED: readMapFlag('SECURITY_MAP_V2_ENABLED', true),
  POPUP_VALIDATION_ENABLED: readMapFlag('POPUP_VALIDATION_ENABLED', false),
};

export const getAlertApiBaseUrl = (): string => ALERT_API_BASE_URL;

export const hasAlertApiBaseUrl = (): boolean => ALERT_API_BASE_URL.length > 0;

export const describeAlertApiConfig = () => ({
  baseUrl: ALERT_API_BASE_URL,
  source: ALERT_API_BASE_URL_SOURCE,
  environment: ALERT_APP_ENV,
  isProduction: isProductionRuntime,
});

export const requireAlertApiBaseUrl = (): string => {
  if (!ALERT_API_BASE_URL) {
    throw new Error('missing_env_alert_api_url');
  }
  if (APP_CONFIG.IS_PRODUCTION && !ALERT_API_BASE_URL.startsWith('https://')) {
    throw new Error('unsafe_env_alert_api_url_requires_https');
  }
  return ALERT_API_BASE_URL;
};

export const validateMobileRuntimeConfig = (): string[] => {
  const issues: string[] = [];
  if (APP_CONFIG.IS_PRODUCTION && !ALERT_API_BASE_URL.startsWith('https://')) {
    issues.push('ALERT_API_URL must be HTTPS in production.');
  }
  if (APP_CONFIG.IS_PRODUCTION && APP_CONFIG.POPUP_VALIDATION_ENABLED) {
    issues.push('POPUP_VALIDATION_ENABLED must be false in production.');
  }
  if (
    APP_CONFIG.IS_PRODUCTION &&
    APP_CONFIG.AUTH_ANONYMOUS_ENABLED
  ) {
    issues.push('AUTH_ANONYMOUS_ENABLED must be false in production.');
  }
  return issues;
};
