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

const readMapConfig = (key: string, fallback = '') =>
  String(runtimeMapConfig[key] ?? fallback).trim();

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
  SUPPORT_EMAIL: 'support@alertpremium.com',
  API_BASE_URL: 'https://alert-vmpj.onrender.com',
  AUTH_ANONYMOUS_ENABLED: readMapFlag('AUTH_ANONYMOUS_ENABLED', false),
  MAP_PROVIDER: readMapConfig('MAP_PROVIDER', 'osm').toLowerCase(),
  MAPTILER_KEY: readMapConfig('MAPTILER_KEY'),
  MAP_STYLE_DEFAULT_URL: readMapConfig('MAP_STYLE_DEFAULT_URL'),
  MAP_STYLE_SATELLITE_URL: readMapConfig('MAP_STYLE_SATELLITE_URL'),
  MAP_SATELLITE_ENABLED: readMapFlag('MAP_SATELLITE_ENABLED', true),
  SECURITY_MAP_V2_ENABLED: readMapFlag('SECURITY_MAP_V2_ENABLED', true),
};
