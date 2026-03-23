const assert = require('assert');
const { __test__ } = require('./meteoAdapter');

const { createNowcastEvents, inferNowcastEventTypes, mapNowcastSeverity, mapNowcastConfidence } = __test__;

const run = () => {
  const thunderNow = inferNowcastEventTypes({
    weatherCode: 95,
    precipitation: 7,
    rain: 6,
    showers: 0,
    snowfall: 0,
    gusts: 58,
  });
  assert(thunderNow.includes('lightning'));
  assert(thunderNow.includes('storm'));

  const hailNow = inferNowcastEventTypes({
    weatherCode: 99,
    precipitation: 11,
    rain: 8,
    showers: 0,
    snowfall: 0,
    gusts: 66,
  });
  assert(hailNow.includes('hail'));
  assert.strictEqual(
    mapNowcastSeverity({ weatherCode: 99, precipitation: 11, gusts: 66, eventType: 'hail' }),
    'Extreme',
  );

  const snowNow = inferNowcastEventTypes({
    weatherCode: 75,
    precipitation: 4,
    rain: 0,
    showers: 0,
    snowfall: 2.2,
    gusts: 28,
  });
  assert(snowNow.includes('snowstorm'));

  const floodNow = inferNowcastEventTypes({
    weatherCode: 63,
    precipitation: 16,
    rain: 12,
    showers: 0,
    snowfall: 0,
    gusts: 34,
  });
  assert(floodNow.includes('flood'));

  assert(mapNowcastConfidence({ source: 'current', weatherCode: 95, precipitation: 7 }) >= 0.9);
  assert(mapNowcastConfidence({ source: 'forecast', weatherCode: 80, precipitation: 1 }) >= 0.7);

  const minutelyEvents = createNowcastEvents({
    provider: {
      id: 'meteo_nowcast_openmeteo',
      trustTier: 'high',
      sourceClass: 'official',
      sourceAuthority: 'Open-Meteo',
    },
    bbox: {
      minLat: -23.58,
      minLon: -46.64,
      maxLat: -23.52,
      maxLon: -46.58,
    },
    json: {
      current: {
        time: '2026-03-11T21:00',
        weather_code: 3,
        precipitation: 0,
        rain: 0,
        showers: 0,
        snowfall: 0,
        wind_gusts_10m: 42,
      },
      minutely_15: {
        time: ['2026-03-11T21:15', '2026-03-11T21:30'],
        weather_code: [95, 99],
        precipitation: [7, 11],
      },
      hourly: {
        time: ['2026-03-11T22:00'],
        weather_code: [3],
        precipitation: [0],
        rain: [0],
        showers: [0],
        snowfall: [0],
        wind_gusts_10m: [30],
      },
    },
  });

  assert(minutelyEvents.some(event => event.type === 'lightning'));
  assert(minutelyEvents.some(event => event.type === 'hail'));
  console.log('meteoAdapter tests passed');
};

run();
