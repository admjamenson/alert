const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitForServer = async url => {
  const deadline = Date.now() + 25_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`status_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }

  throw lastError || new Error('server_start_timeout');
};

test('backend index weather route serves the safe-mode 8-day contract', async t => {
  const port = 10180 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}`;
  const backendRoot = path.resolve(__dirname, '../..');
  const child = spawn(process.execPath, ['index.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'staging',
      ALERT_ENV: 'staging',
      ALERT_LOAD_TEST_SAFE_MODE: 'true',
      ALERT_ALLOW_PUBLIC_PROVIDER_DEFAULTS: 'true',
      RELAY_HMAC_SECRET: 'runtime-test-relay-secret',
      RENDER_GIT_COMMIT: 'index-runtime-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  child.stdout.on('data', chunk => {
    output += String(chunk);
  });
  child.stderr.on('data', chunk => {
    output += String(chunk);
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await wait(500);
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
  });

  await waitForServer(`${baseUrl}/healthz`);

  const response = await fetch(
    `${baseUrl}/api/v1/weather/feed?lat=-16.64944&lon=-49.48889&locale=pt-BR`,
  );
  assert.equal(response.status, 200, output);
  const payload = await response.json();

  assert.equal(payload.source, 'safe_mode_hard_bypass');
  assert.equal(Array.isArray(payload.forecast), true);
  assert.equal(Array.isArray(payload.daily?.forecastDays), true);
  assert.ok(payload.forecast.length >= 6);
  assert.ok(payload.daily.forecastDays.length >= 6);
  assert.notDeepEqual(
    payload.forecast,
    [
      {day: 0, condition: 'clear', tempHigh: 24, tempLow: 18},
      {day: 1, condition: 'partly_cloudy', tempHigh: 23, tempLow: 17},
    ],
  );
  assert.equal(
    payload.debugBuild?.weatherFeedContract,
    'forecast_8_days_v2',
  );
});
