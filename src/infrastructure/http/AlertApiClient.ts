import { getAlertApiBaseUrl } from '../../core/config';
import { recordOperationalMetric } from '../../observability/OperationalMetrics';
import { toUrlEncodedString } from '../../utils/urlEncoding';
import { buildAlertIdentityHeaders } from './AlertIdentityHeaders';

type QueryValue = string | number | boolean | null | undefined;

type FetchAlertApiJsonOptions = {
  params?: Record<string, QueryValue>;
  timeoutMs?: number;
  headers?: Record<string, string>;
  init?: RequestInit;
};

const buildQueryString = (params?: Record<string, QueryValue>): string => {
  if (!params) return '';
  const serialized = toUrlEncodedString(params);
  return serialized ? `?${serialized}` : '';
};

export const buildAlertApiUrl = (
  pathname: string,
  params?: Record<string, QueryValue>,
): string => {
  const baseUrl = getAlertApiBaseUrl();
  if (!baseUrl) {
    throw new Error('missing_env_alert_api_url');
  }
  const normalizedPath = String(pathname || '')
    .trim()
    .replace(/^\/+/, '');
  return `${baseUrl}/${normalizedPath}${buildQueryString(params)}`;
};

export const fetchAlertApiJson = async <T>(
  pathname: string,
  options: FetchAlertApiJsonOptions = {},
): Promise<T> => {
  const startedAt = Date.now();
  let requestRecorded = false;
  const baseUrl = getAlertApiBaseUrl();
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 2500));
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // fail-soft
        }
      }, timeoutMs)
    : null;

  try {
    const identityHeaders = await buildAlertIdentityHeaders().catch(() => ({}));
    const requestUrl = buildAlertApiUrl(pathname, options.params);
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...identityHeaders,
        ...(options.headers || {}),
      },
      ...(options.init || {}),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const durationMs = Math.max(0, Date.now() - startedAt);
    requestRecorded = true;
    recordOperationalMetric('network_request_ms', durationMs, {
      path: pathname,
      status: response.status,
      ok: response.ok,
      timeoutMs,
      apiBaseUrl: baseUrl || 'missing',
    });
    if (!response.ok) {
      throw new Error(`alert_api_http_${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (requestRecorded) {
      throw error;
    }
    const durationMs = Math.max(0, Date.now() - startedAt);
    recordOperationalMetric('network_request_ms', durationMs, {
      path: pathname,
      status: 0,
      ok: false,
      timeoutMs,
      apiBaseUrl: baseUrl || 'missing',
      error: error instanceof Error ? error.name : 'unknown',
      errorMessage:
        error instanceof Error && error.message
          ? error.message
          : 'unknown',
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
