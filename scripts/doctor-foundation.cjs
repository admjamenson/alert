#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const readJson = relativePath =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const readText = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const exists = relativePath => fs.existsSync(path.join(root, relativePath));

const checks = [];

const addCheck = (level, id, message) => {
  checks.push({ level, id, message });
};

const rootPackage = readJson('package.json');
const backendPackage = readJson('backend/package.json');
const tsconfig = readJson('tsconfig.json');
const gradleProperties = readText('android/gradle.properties');
const gitignore = readText('.gitignore');

const firebaseDeps = Object.entries(rootPackage.dependencies || {})
  .filter(([name]) => name.startsWith('@react-native-firebase/'))
  .map(([name, version]) => ({ name, version }));

const firebaseVersions = new Set(firebaseDeps.map(dep => dep.version));
if (firebaseVersions.size > 1) {
  addCheck(
    'warn',
    'firebase-version-drift',
    `React Native Firebase packages are not aligned: ${firebaseDeps
      .map(dep => `${dep.name}@${dep.version}`)
      .join(', ')}`,
  );
} else {
  addCheck('pass', 'firebase-version-alignment', 'React Native Firebase package versions are aligned.');
}

if ((rootPackage.dependencies || {}).typescript) {
  addCheck(
    'warn',
    'typescript-runtime-dependency',
    'typescript is listed in dependencies; keep compiler tooling in devDependencies when lockfile can be updated.',
  );
} else if ((rootPackage.devDependencies || {}).typescript) {
  addCheck('pass', 'typescript-dev-dependency', 'typescript is scoped to devDependencies.');
}

if ((rootPackage.devDependencies || {})['@types/react-native']) {
  addCheck(
    'warn',
    'obsolete-react-native-types',
    '@types/react-native is present although React Native ships its own types.',
  );
} else {
  addCheck('pass', 'obsolete-react-native-types', '@types/react-native is not declared directly.');
}

if ((rootPackage.dependencies || {})['react-native-facebook']) {
  addCheck(
    'warn',
    'unused-fragile-facebook-sdk',
    'react-native-facebook is declared but no source import was found; remove it to reduce native risk.',
  );
} else {
  addCheck('pass', 'unused-fragile-facebook-sdk', 'Unused react-native-facebook dependency is absent.');
}

if (tsconfig.compilerOptions?.noEmit !== true) {
  addCheck('fail', 'tsconfig-noemit', 'tsconfig must explicitly set compilerOptions.noEmit=true.');
} else {
  addCheck('pass', 'tsconfig-noemit', 'TypeScript noEmit is explicit.');
}

if (tsconfig.compilerOptions?.forceConsistentCasingInFileNames !== true) {
  addCheck(
    'fail',
    'tsconfig-casing',
    'tsconfig must enforce forceConsistentCasingInFileNames.',
  );
} else {
  addCheck('pass', 'tsconfig-casing', 'TypeScript path casing is enforced.');
}

if (!/hermesEnabled=true/.test(gradleProperties)) {
  addCheck('fail', 'hermes-enabled', 'Hermes must be enabled in android/gradle.properties.');
} else {
  addCheck('pass', 'hermes-enabled', 'Hermes is enabled.');
}

if (!/newArchEnabled=(true|false)/.test(gradleProperties)) {
  addCheck('fail', 'new-architecture-explicit', 'newArchEnabled must be explicit.');
} else {
  addCheck('pass', 'new-architecture-explicit', 'New Architecture flag is explicit.');
}

if (!/alertCmakeGenerator=Unix Makefiles/.test(gradleProperties)) {
  addCheck('warn', 'cmake-generator', 'Windows CMake generator override is not explicit.');
} else {
  addCheck('pass', 'cmake-generator', 'Windows CMake generator override is explicit.');
}

const appBuildGradle = readText('android/app/build.gradle');
if (!/react-native-config.+dotenv\.gradle/.test(appBuildGradle)) {
  addCheck(
    'fail',
    'mobile-env-wiring',
    'android/app/build.gradle must apply react-native-config dotenv.gradle so .env reaches native/mobile runtime.',
  );
} else {
  addCheck('pass', 'mobile-env-wiring', 'react-native-config dotenv.gradle is wired into Android build.');
}

const mobileConfig = readText('src/core/config.ts');
if (!/from 'react-native-config'/.test(mobileConfig)) {
  addCheck(
    'fail',
    'mobile-config-source',
    'src/core/config.ts must read runtime values from react-native-config before process.env fallback.',
  );
} else {
  addCheck('pass', 'mobile-config-source', 'Mobile config reads react-native-config.');
}

if (!exists('.env.example')) {
  addCheck('fail', 'mobile-env-example', '.env.example is missing.');
}

if (!exists('backend/.env.example')) {
  addCheck('fail', 'backend-env-example', 'backend/.env.example is missing.');
}

[
  '.env',
  '.env.*',
  'backend/firebase-admin.json',
  'android/keystore.properties',
  '*.jks',
  '*.keystore',
].forEach(pattern => {
  if (!gitignore.includes(pattern)) {
    addCheck('fail', `gitignore-${pattern}`, `.gitignore must ignore ${pattern}.`);
  }
});

if (!backendPackage.scripts?.['test:runtime']) {
  addCheck(
    'warn',
    'backend-runtime-tests',
    'backend package should expose test:runtime for config safety checks.',
  );
}

const billingAdapter = exists('src/infrastructure/adapters/PremiumBillingApiAdapter.ts')
  ? readText('src/infrastructure/adapters/PremiumBillingApiAdapter.ts')
  : '';
const billingConfig = exists('backend/src/billing/billingConfig.js')
  ? readText('backend/src/billing/billingConfig.js')
  : '';
if (
  billingAdapter.includes('LEGACY_BILLING_API_HOSTS') &&
  billingConfig.includes('LEGACY_BILLING_HOSTS')
) {
  addCheck(
    'pass',
    'legacy-billing-host-contained',
    'Retired billing host appears only in explicit legacy migration/deny-list config.',
  );
} else if (`${billingAdapter}\n${billingConfig}`.includes('api.alertpremium.com')) {
  addCheck(
    'warn',
    'legacy-billing-host-contained',
    'Retired billing host reference is present outside the expected migration/deny-list constants.',
  );
}

const severityRank = { pass: 0, warn: 1, fail: 2 };
checks.sort((a, b) => severityRank[b.level] - severityRank[a.level] || a.id.localeCompare(b.id));

const summary = checks.reduce(
  (acc, check) => {
    acc[check.level] += 1;
    return acc;
  },
  { pass: 0, warn: 0, fail: 0 },
);

console.log(JSON.stringify({ summary, checks }, null, 2));

if (summary.fail > 0) {
  process.exitCode = 1;
}
