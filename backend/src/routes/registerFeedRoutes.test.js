const test = require('node:test');
const assert = require('node:assert/strict');

const registerFeedRoutes = require('./registerFeedRoutes');

const createAppStub = () => {
  const handlers = new Map();
  return {
    get(path, handler) {
      const key = `GET ${path}`;
      const current = handlers.get(key) || [];
      current.push(handler);
      handlers.set(key, current);
    },
    handlers,
  };
};

const createResponseStub = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test('weather safe mode bypass keeps the canonical mobile weather contract', async t => {
  const previousSafeMode = process.env.ALERT_LOAD_TEST_SAFE_MODE;
  process.env.ALERT_LOAD_TEST_SAFE_MODE = 'true';
  t.after(() => {
    if (typeof previousSafeMode === 'string') {
      process.env.ALERT_LOAD_TEST_SAFE_MODE = previousSafeMode;
    } else {
      delete process.env.ALERT_LOAD_TEST_SAFE_MODE;
    }
  });

  const app = createAppStub();
  registerFeedRoutes(app, {
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  });

  const handlers = app.handlers.get('GET /api/v1/weather/feed');
  assert.ok(Array.isArray(handlers));
  assert.ok(handlers.length >= 1);

  const response = createResponseStub();
  let nextCalled = false;
  await handlers[0](
    {
      query: {
        lat: '-7.7619',
        lon: '-40.2672',
        locale: 'pt-BR',
      },
    },
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.source, 'safe_mode_hard_bypass');
  assert.equal(typeof response.body.current?.tempC, 'number');
  assert.equal(typeof response.body.current?.labelKey, 'string');
  assert.equal(typeof response.body.daily?.maxTempC, 'number');
  assert.equal(Array.isArray(response.body.daily?.forecastDays), true);
  assert.ok(response.body.daily.forecastDays.length >= 6);
  assert.equal(Array.isArray(response.body.forecast), true);
  assert.ok(response.body.forecast.length >= 6);
  assert.equal(typeof response.body.freshness?.fetchedAt, 'string');
});
