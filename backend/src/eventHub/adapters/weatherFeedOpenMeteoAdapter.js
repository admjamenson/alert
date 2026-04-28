const { fetchJsonWithRetry } = require('../fetcher');

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const readPositiveInteger = (value, fallback, minValue) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.round(parsed));
};

const readWeatherForecastTimeoutMs = () =>
  readPositiveInteger(
    process.env.ALERT_WEATHER_FORECAST_TIMEOUT_MS,
    1_400,
    500,
  );

const readWeatherForecastRetries = () =>
  readPositiveInteger(process.env.ALERT_WEATHER_FORECAST_RETRIES, 0, 0);

const readWeatherReverseTimeoutMs = () =>
  readPositiveInteger(
    process.env.ALERT_WEATHER_REVERSE_TIMEOUT_MS,
    700,
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
    '&forecast_days=4&timezone=auto';
  const reverseUrl =
    `${NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=10` +
    `&lat=${lat.toFixed(5)}` +
    `&lon=${lon.toFixed(5)}` +
    '&addressdetails=1';

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
