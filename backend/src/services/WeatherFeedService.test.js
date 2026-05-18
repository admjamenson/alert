const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __buildForecastDaysFromDailyForTests,
  __countUsableBackendForecastDaysForTests,
  __hasUsableBackendForecastForMobileForTests,
  buildSafeModeWeatherFeed,
} = require('./WeatherFeedService');

test('weather feed daily forecast keeps the available daily range for the app carousel', () => {
  const forecastDays = __buildForecastDaysFromDailyForTests({
    time: [
      '2026-05-17',
      '2026-05-18',
      '2026-05-19',
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
      '2026-05-25',
    ],
    weather_code: [1, 2, 3, 95, 1, 2, 3, 1, 0],
    temperature_2m_max: [31, 30, 29, 28, 27, 26, 25, 24, 23],
    temperature_2m_min: [24, 23, 22, 21, 20, 19, 18, 17, 16],
    precipitation_probability_max: [10, 20, 30, 40, 50, 60, 70, 80, 90],
  });

  assert.deepEqual(
    forecastDays.map(day => day.date),
    [
      '2026-05-17',
      '2026-05-18',
      '2026-05-19',
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
    ],
  );
  assert.deepEqual(
    forecastDays.map(day => day.maxTempC),
    [31, 30, 29, 28, 27, 26, 25, 24],
  );
  assert.deepEqual(
    forecastDays.map(day => day.rainChance),
    [10, 20, 30, 40, 50, 60, 70, 80],
  );
});

test('safe mode weather feed keeps enough forecast days for the app carousel', () => {
  const payload = buildSafeModeWeatherFeed({
    lat: -3.7319,
    lon: -38.5267,
    locale: 'pt-BR',
  });

  assert.equal(payload.daily.forecastDays.length, 8);
  assert.equal(payload.forecast.length, 8);
  assert.deepEqual(
    payload.forecast.map(day => day.day),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(payload.debugBuild.weatherFeedContract, 'forecast_8_days_v2');
  assert.equal(__hasUsableBackendForecastForMobileForTests(payload), true);
});

test('weather feed cache rejects one-day forecasts before the mobile carousel', () => {
  const oneDayPayload = {
    available: true,
    daily: {
      forecastDays: [
        {
          date: '2026-05-18',
          maxTempC: 23,
          minTempC: 17,
        },
      ],
    },
  };
  const sixDayPayload = {
    available: true,
    daily: {
      forecastDays: Array.from({length: 6}, (_, index) => ({
        date: `2026-05-${String(18 + index).padStart(2, '0')}`,
        maxTempC: 23 - index,
        minTempC: 17 - index,
      })),
    },
  };

  assert.equal(__countUsableBackendForecastDaysForTests(oneDayPayload), 1);
  assert.equal(
    __hasUsableBackendForecastForMobileForTests(oneDayPayload),
    false,
  );
  assert.equal(__countUsableBackendForecastDaysForTests(sixDayPayload), 6);
  assert.equal(
    __hasUsableBackendForecastForMobileForTests(sixDayPayload),
    true,
  );
});

test('buildForecastDaysFromDaily ignores incomplete tail entries and preserves valid days', () => {
  const forecastDays = __buildForecastDaysFromDailyForTests({
    time: ['2026-05-17', '2026-05-18', '2026-05-19', '2026-05-20'],
    weather_code: [1, 2, 3],
    temperature_2m_max: [30, 31, 32, 33],
    temperature_2m_min: [20, 21, 22, 23],
    precipitation_probability_max: [10, 20, 30, 40],
  });

  assert.equal(forecastDays.length, 3);
  assert.deepEqual(
    forecastDays.map(day => day.date),
    ['2026-05-17', '2026-05-18', '2026-05-19'],
  );
  assert.deepEqual(
    forecastDays.map(day => day.maxTempC),
    [30, 31, 32],
  );
});
