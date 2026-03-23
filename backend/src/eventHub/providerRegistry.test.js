const assert = require('assert');
const { EVENT_TYPE_TO_PROVIDER_IDS, PROVIDER_REGISTRY } = require('./providerRegistry');

const run = () => {
  assert(PROVIDER_REGISTRY.meteo_nowcast_openmeteo);
  assert.strictEqual(
    PROVIDER_REGISTRY.meteo_nowcast_openmeteo.adapterName,
    'meteoNowcastAdapter',
  );

  ['flood', 'storm', 'snowstorm', 'lightning', 'hail'].forEach(type => {
    const ids = EVENT_TYPE_TO_PROVIDER_IDS[type] || [];
    assert(ids[0] === 'meteo_nowcast_openmeteo');
    assert(ids.includes('hydro_gdacs'));
  });

  console.log('providerRegistry tests passed');
};

run();
