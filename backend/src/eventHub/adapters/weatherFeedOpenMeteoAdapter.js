const { fetchJsonWithRetry } = require('../fetcher');

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_REVERSE_URL = 'https://geocoding-api.open-meteo.com/v1/reverse';

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
    `${OPEN_METEO_REVERSE_URL}?latitude=${lat.toFixed(5)}` +
    `&longitude=${lon.toFixed(5)}&language=${encodeURIComponent(
      safeLocale,
    )}&count=1`;

  const [forecastResult, reverseResult] = await Promise.all([
    fetchJsonWithRetry(weatherUrl, {
      cacheKey: `weather-feed:${lat.toFixed(3)}:${lon.toFixed(3)}`,
      cacheTtlMs: 60_000,
      retries: 1,
      retryDelayMs: 180,
      timeoutMs: 2500,
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
      retries: 1,
      retryDelayMs: 120,
      timeoutMs: 1800,
      rateLimitKey: 'weather-reverse',
      maxPerMinute: 90,
      headers: {
        'User-Agent': userAgent,
      },
    }),
  ]);

  return {
    forecastResult,
    reverseResult,
  };
};

module.exports = {
  fetchWeatherFeedOpenMeteo,
};
