const { fetchJsonWithRetry } = require('../fetcher');

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const BIG_DATA_CLOUD_REVERSE_URL =
  'https://api-bdc.io/data/reverse-geocode-client';

const readPositiveInteger = (value, fallback, minValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.round(parsed));
};

const readWeatherForecastTimeoutMs = () =>
  readPositiveInteger(
    process.env.ALERT_WEATHER_FORECAST_TIMEOUT_MS,
    2_500,
    500,
  );

const readWeatherForecastRetries = () =>
  readPositiveInteger(process.env.ALERT_WEATHER_FORECAST_RETRIES, 0, 0);

const readWeatherReverseTimeoutMs = () =>
  readPositiveInteger(
    process.env.ALERT_WEATHER_REVERSE_TIMEOUT_MS,
    1_500,
    250,
  );

const readWeatherReverseRetries = () =>
  readPositiveInteger(process.env.ALERT_WEATHER_REVERSE_RETRIES, 0, 0);

const fetchWeatherFeedOpenMeteo = async (
  { latitude, longitude, locale },
  { userAgent } = {},
) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      forecastResult: { ok: false, status: 400, error: 'invalid_coordinates' },
      reverseResult: { ok: false, status: 400, error: 'invalid_coordinates' },
    };
  }

  const safeLocale = String(locale || 'en').trim() || 'en';
  const weatherUrl =
    `${OPEN_METEO_URL}?latitude=${lat.toFixed(5)}` +
    `&longitude=${lon.toFixed(5)}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,precipitation,rain,showers,snowfall' +
    '&hourly=weather_code,precipitation_probability' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset' +
    '&forecast_days=8&timezone=auto';
  const reverseUrl =
    `${BIG_DATA_CLOUD_REVERSE_URL}?latitude=${lat.toFixed(5)}` +
    `&longitude=${lon.toFixed(5)}` +
    `&localityLanguage=${encodeURIComponent(safeLocale.split('-')[0] || 'en')}`;

  const [forecastSettled, reverseSettled] = await Promise.allSettled([
    fetchJsonWithRetry(weatherUrl, {
      cacheKey: `weather-feed:${lat.toFixed(3)}:${lon.toFixed(3)}`,
      cacheTtlMs: 60_000,
      retries: readWeatherForecastRetries(),
      retryDelayMs: 180,
      timeoutMs: readWeatherForecastTimeoutMs(),
      rateLimitKey: 'weather-feed',
      maxPerMinute: 90,
      headers: {
        'User-Agent': userAgent,
      },
    }),
    fetchJsonWithRetry(reverseUrl, {
      cacheKey: `weather-reverse:${lat.toFixed(3)}:${lon.toFixed(
        3,
      )}:${safeLocale}`,
      cacheTtlMs: 30 * 60 * 1000,
      retries: readWeatherReverseRetries(),
      retryDelayMs: 120,
      timeoutMs: readWeatherReverseTimeoutMs(),
      rateLimitKey: 'weather-reverse',
      maxPerMinute: 90,
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': safeLocale,
      },
    }),
  ]);

  const forecastResult =
    forecastSettled.status === 'fulfilled'
      ? forecastSettled.value
      : {
          ok: false,
          status: 0,
          error: 'weather_forecast_unavailable',
        };
  // DEV diagnostics: log raw Open-Meteo payload shape when enabled
  try {
    if (process.env.ALERT_WEATHER_DEBUG === '1' && forecastResult?.ok) {
      const json = forecastResult.json || {};
      const daily = (json.daily && typeof json.daily === 'object') ? json.daily : {};
      const sample = {
        timezone: json.timezone || json.timezone_abbreviation || null,
        daily_keys: Object.keys(daily),
        daily_counts: {
          time: Array.isArray(daily.time) ? daily.time.length : null,
          temperature_2m_max: Array.isArray(daily.temperature_2m_max)
            ? daily.temperature_2m_max.length
            : null,
          temperature_2m_min: Array.isArray(daily.temperature_2m_min)
            ? daily.temperature_2m_min.length
            : null,
          weather_code: Array.isArray(daily.weather_code)
            ? daily.weather_code.length
            : null,
          precipitation_probability_max: Array.isArray(daily.precipitation_probability_max)
            ? daily.precipitation_probability_max.length
            : null,
        },
        sample_temperatures:
          Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max.slice(0, 5) : null,
        sample_codes: Array.isArray(daily.weather_code) ? daily.weather_code.slice(0, 5) : null,
      };
      console.info('[weather/open-meteo] RAW_PAYLOAD_DIAGNOSTICS', JSON.stringify(sample));
    }
  } catch (err) {
    // fail-safe: diagnostics must not break normal flow
  }
  const reverseResult =
    reverseSettled.status === 'fulfilled'
      ? reverseSettled.value
      : {
          ok: false,
          status: 0,
          error: 'weather_reverse_unavailable',
        };

  return {
    forecastResult,
    reverseResult,
  };
};

module.exports = {
  fetchWeatherFeedOpenMeteo,
  readWeatherForecastTimeoutMs,
  readWeatherForecastRetries,
  readWeatherReverseTimeoutMs,
  readWeatherReverseRetries,
};
