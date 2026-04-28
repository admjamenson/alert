const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchWeatherFeedOpenMeteo,
} = require('./weatherFeedOpenMeteoAdapter');

test.beforeEach(() => {
  delete process.env.ALERT_WEATHER_FORECAST_TIMEOUT_MS;
  delete process.env.ALERT_WEATHER_FORECAST_RETRIES;
  delete process.env.ALERT_WEATHER_REVERSE_TIMEOUT_MS;
  delete process.env.ALERT_WEATHER_REVERSE_RETRIES;
});

test('weather feed keeps forecast available when reverse geocoding times out', async () => {
  process.env.ALERT_WEATHER_FORECAST_TIMEOUT_MS = '500';
  process.env.ALERT_WEATHER_FORECAST_RETRIES = '0';
  process.env.ALERT_WEATHER_REVERSE_TIMEOUT_MS = '80';
  process.env.ALERT_WEATHER_REVERSE_RETRIES = '0';

  const originalFetch = global.fetch;
  global.fetch = (url, options = {}) => {
    if (String(url).includes('/forecast')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() {
          return {
            timezone: 'UTC',
            current: {
              temperature_2m: 27,
              apparent_temperature: 28,
              relative_humidity_2m: 70,
              weather_code: 1,
              is_day: 1,
              wind_speed_10m: 14,
              precipitation: 0,
              rain: 0,
              showers: 0,
              snowfall: 0,
            },
            daily: {
              temperature_2m_max: [30, 31, 30, 29],
              temperature_2m_min: [22, 23, 22, 21],
              weather_code: [1, 2, 3, 1],
              precipitation_probability_max: [10, 20, 30, 10],
              sunrise: ['2026-04-21T06:00'],
              sunset: ['2026-04-21T18:00'],
              time: ['2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24'],
            },
            hourly: {
              time: ['2026-04-21T12:00'],
              weather_code: [1],
              precipitation_probability: [10],
            },
          };
        },
      });
    }

    return new Promise((_resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  };

  try {
    const result = await fetchWeatherFeedOpenMeteo(
      {
        latitude: -23.55,
        longitude: -46.63,
        locale: 'pt-BR',
      },
      { userAgent: 'AlertBackend/Tests' },
    );

    assert.equal(result.forecastResult.ok, true);
    assert.equal(result.reverseResult.ok, false);
    assert.equal(result.reverseResult.errorType, 'timeout');
  } finally {
    global.fetch = originalFetch;
  }
});

test('weather feed reverse geocoding targets the Nominatim reverse endpoint', async () => {
  const originalFetch = global.fetch;
  const seenUrls = [];
  global.fetch = url => {
    seenUrls.push(String(url));
    if (String(url).includes('/forecast')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() {
          return {
            timezone: 'UTC',
            current: {},
            daily: { time: [] },
            hourly: { time: [] },
          };
        },
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      async json() {
        return {
          address: {
            city: 'Sao Paulo',
            state: 'Sao Paulo',
            country: 'Brazil',
          },
        };
      },
    });
  };

  try {
    const result = await fetchWeatherFeedOpenMeteo(
      {
        latitude: -23.55,
        longitude: -46.63,
        locale: 'pt-BR',
      },
      { userAgent: 'AlertBackend/Tests' },
    );

    assert.equal(result.forecastResult.ok, true);
    assert.equal(result.reverseResult.ok, true);
    assert.equal(
      seenUrls.some(url => url.startsWith('https://nominatim.openstreetmap.org/reverse?')),
      true,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
