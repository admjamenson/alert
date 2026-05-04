'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const requireUpload = process.env.ALERT_REQUIRE_STORE_UPLOAD === 'true';

const checks = [];
const addCheck = (id, status, message, data) => {
  const row = { id, status, message };
  if (data !== undefined) row.data = data;
  checks.push(row);
};

const exists = relativePath => {
  const absolutePath = path.join(repoRoot, relativePath);
  return {
    path: absolutePath,
    exists: fs.existsSync(absolutePath),
    bytes: fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0,
  };
};

const envPresent = key => {
  const value = process.env[key];
  return Boolean(value && value.trim());
};

const anyEnvPresent = keys => keys.some(envPresent);

const probeTool = command => {
  try {
    const version = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    addCheck(`tool:${command}`, 'pass', `${command} is available`, { version });
    return true;
  } catch (error) {
    addCheck(`tool:${command}`, 'blocked', `${command} is not available`, {
      code: error.code,
    });
    return false;
  }
};

const checkAndroid = () => {
  const aab = exists('android/app/build/outputs/bundle/release/app-release.aab');
  const apk = exists('android/app/build/outputs/apk/release/app-release.apk');
  const keystoreProperties = exists('android/keystore.properties');

  addCheck('android:aab', aab.exists ? 'pass' : 'blocked', aab.exists ? 'Release AAB is present' : 'Release AAB is missing', aab);
  addCheck('android:apk', apk.exists ? 'pass' : 'blocked', apk.exists ? 'Release APK is present' : 'Release APK is missing', apk);
  addCheck(
    'android:release-signing-config',
    keystoreProperties.exists || anyEnvPresent([
      'ALERT_RELEASE_STORE_FILE',
      'ALERT_RELEASE_STORE_PASSWORD',
      'ALERT_RELEASE_KEY_ALIAS',
      'ALERT_RELEASE_KEY_PASSWORD',
    ])
      ? 'pass'
      : 'blocked',
    'Release signing config is required for store upload',
    { keystorePropertiesPath: keystoreProperties.path, keystorePropertiesPresent: keystoreProperties.exists },
  );

  const hasPlayCredentials = anyEnvPresent([
    'PLAY_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'SUPPLY_JSON_KEY',
  ]);
  addCheck(
    'android:play-credentials',
    hasPlayCredentials ? 'pass' : 'blocked',
    hasPlayCredentials
      ? 'Google Play upload credentials are configured'
      : 'Google Play upload credentials are missing',
    {
      acceptedEnv: ['PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'SUPPLY_JSON_KEY'],
    },
  );
  addCheck(
    'android:play-track',
    envPresent('ALERT_PLAY_TRACK') ? 'pass' : 'blocked',
    envPresent('ALERT_PLAY_TRACK') ? 'Google Play target track is configured' : 'ALERT_PLAY_TRACK is missing',
  );
};

const checkIos = () => {
  const hostIsMac = os.platform() === 'darwin';
  addCheck(
    'ios:host',
    hostIsMac ? 'pass' : 'blocked',
    hostIsMac ? 'Host is macOS' : 'App Store/iOS archive validation requires macOS',
    { platform: os.platform() },
  );
  probeTool('xcodebuild');
  probeTool('pod');

  const hasAppStoreConnectApi = envPresent('ASC_API_KEY_ID') &&
    envPresent('ASC_API_ISSUER_ID') &&
    (envPresent('ASC_API_KEY_PATH') || envPresent('ASC_API_PRIVATE_KEY'));
  addCheck(
    'ios:app-store-connect-api',
    hasAppStoreConnectApi ? 'pass' : 'blocked',
    hasAppStoreConnectApi
      ? 'App Store Connect API credentials are configured'
      : 'App Store Connect API credentials are missing',
    {
      acceptedEnv: ['ASC_API_KEY_ID', 'ASC_API_ISSUER_ID', 'ASC_API_KEY_PATH or ASC_API_PRIVATE_KEY'],
    },
  );
};

const main = () => {
  checkAndroid();
  probeTool('fastlane');
  checkIos();

  const failed = checks.filter(check => check.status === 'fail');
  const blocked = checks.filter(check => check.status === 'blocked');
  const result = {
    ok: failed.length === 0 && (!requireUpload || blocked.length === 0),
    generatedAt: new Date().toISOString(),
    requireUpload,
    classification:
      blocked.length === 0
        ? 'store_upload_ready_inputs_present'
        : 'store_ready_but_not_uploaded_blocked_by_missing_store_credentials_or_host',
    summary: {
      pass: checks.filter(check => check.status === 'pass').length,
      fail: failed.length,
      blocked: blocked.length,
    },
    checks,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
};

main();
