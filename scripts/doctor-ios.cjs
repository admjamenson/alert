const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const requiredFiles = [
  'ios/Podfile',
  'ios/A1/Info.plist',
  'ios/A1/PrivacyInfo.xcprivacy',
  'ios/A1/LaunchScreen.storyboard',
  'ios/A1/AppDelegate.mm',
  'ios/A1.xcodeproj/project.pbxproj',
];
const requiredPlistKeys = [
  'CFBundleDisplayName',
  'NSLocationWhenInUseUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSContactsUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSAppTransportSecurity',
];

const checks = [];
const add = (id, status, message, data = undefined) => {
  checks.push({ id, status, message, ...(data ? { data } : {}) });
};

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

for (const rel of requiredFiles) {
  const exists = fs.existsSync(path.join(ROOT, rel));
  add(`file:${rel}`, exists ? 'pass' : 'fail', exists ? 'present' : 'missing');
}

const podLockExists = fs.existsSync(path.join(ROOT, 'ios/Podfile.lock'));
add(
  'file:ios/Podfile.lock',
  podLockExists ? 'pass' : process.platform === 'darwin' ? 'fail' : 'blocked',
  podLockExists
    ? 'present'
    : process.platform === 'darwin'
      ? 'missing; run pod install before iOS validation'
      : 'missing; CocoaPods lock generation requires macOS/Ruby/CocoaPods validation',
);

let plist = '';
try {
  plist = read('ios/A1/Info.plist');
  for (const key of requiredPlistKeys) {
    const keyIndex = plist.indexOf(`<key>${key}</key>`);
    const hasKey = keyIndex >= 0;
    const after = hasKey ? plist.slice(keyIndex, keyIndex + 320) : '';
    const hasEmptyString = /<string>\s*<\/string>/.test(after);
    add(
      `plist:${key}`,
      hasKey && !hasEmptyString ? 'pass' : 'fail',
      hasKey
        ? hasEmptyString
          ? 'key exists but value is empty'
          : 'key configured'
        : 'key missing',
    );
  }
} catch (error) {
  add('plist:read', 'fail', String(error.message || error));
}

try {
  const appDelegate = read('ios/A1/AppDelegate.mm');
  const expectedModuleName = String(appJson.name || '').trim();
  add(
    'appdelegate:module-name',
    appDelegate.includes(`self.moduleName = @"${expectedModuleName}"`) ? 'pass' : 'fail',
    `expected React module name ${expectedModuleName}`,
  );
} catch (error) {
  add('appdelegate:module-name', 'fail', String(error.message || error));
}

try {
  const privacy = read('ios/A1/PrivacyInfo.xcprivacy');
  add(
    'privacy:tracking-disabled',
    /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy) ? 'pass' : 'fail',
    'NSPrivacyTracking must stay false unless legal/product explicitly changes tracking posture',
  );
  add(
    'privacy:collected-data-declared',
    /NSPrivacyCollectedDataType(?:PreciseLocation|CoarseLocation|Name|PhoneNumber)/.test(
      privacy,
    )
      ? 'pass'
      : 'fail',
    'privacy manifest declares safety-critical data categories used by SOS/location flows',
  );
} catch (error) {
  add('privacy:manifest', 'fail', String(error.message || error));
}

try {
  const project = read('ios/A1.xcodeproj/project.pbxproj');
  const hasExampleBundleId = project.includes('org.reactjs.native.example');
  add(
    'xcode:bundle-id',
    hasExampleBundleId ? 'fail' : 'pass',
    hasExampleBundleId
      ? 'example bundle identifier still present'
      : 'example bundle identifier removed',
  );
  add(
    'xcode:privacy-manifest-resource',
    project.includes('PrivacyInfo.xcprivacy in Resources') ? 'pass' : 'fail',
    'PrivacyInfo.xcprivacy is part of the app resources',
  );
  const targets = Array.from(project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)).map(
    match => match[1],
  );
  const uniqueTargets = Array.from(new Set(targets));
  const minTarget = Math.min(...uniqueTargets.map(Number));
  add(
    'xcode:deployment-target',
    Number.isFinite(minTarget) && minTarget >= 15.1 ? 'pass' : 'fail',
    `deployment targets: ${uniqueTargets.join(', ') || 'none'}`,
  );
} catch (error) {
  add('xcode:deployment-target', 'fail', String(error.message || error));
}

try {
  const launchScreen = read('ios/A1/LaunchScreen.storyboard');
  add(
    'launchscreen:branding',
    launchScreen.includes('text="Alert"') && !launchScreen.includes('Powered by React Native')
      ? 'pass'
      : 'fail',
    'launch screen uses Alert branding and no React Native template copy',
  );
} catch (error) {
  add('launchscreen:branding', 'fail', String(error.message || error));
}

try {
  const hasFirebaseDependency = Object.keys(packageJson.dependencies || {}).some(key =>
    key.startsWith('@react-native-firebase/'),
  );
  const googleInfoInAppTarget = fs.existsSync(
    path.join(ROOT, 'ios/A1/GoogleService-Info.plist'),
  );
  const googleInfoElsewhere = fs.existsSync(
    path.join(ROOT, 'ios/Alert/GoogleService-Info.plist'),
  );
  const project = read('ios/A1.xcodeproj/project.pbxproj');
  const googleInfoInResources = project.includes(
    'GoogleService-Info.plist in Resources',
  );
  add(
    'firebase:google-service-info',
    !hasFirebaseDependency || googleInfoInAppTarget || googleInfoInResources
      ? 'pass'
      : googleInfoElsewhere
        ? 'warn'
        : 'blocked',
    !hasFirebaseDependency
      ? 'Firebase is not used'
      : googleInfoInAppTarget || googleInfoInResources
        ? 'GoogleService-Info.plist is configured for the iOS app target'
        : googleInfoElsewhere
          ? 'GoogleService-Info.plist exists outside ios/A1; verify target membership on macOS/Xcode'
          : 'Firebase dependencies exist but GoogleService-Info.plist was not found for iOS',
  );
} catch (error) {
  add('firebase:google-service-info', 'warn', String(error.message || error));
}

try {
  const output = execFileSync('pod', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  add('tool:cocoapods', 'pass', `pod ${output}`);
} catch {
  add(
    'tool:cocoapods',
    process.platform === 'darwin' ? 'fail' : 'blocked',
    process.platform === 'darwin'
      ? 'CocoaPods is not available'
      : 'pod install validation requires macOS/Ruby/CocoaPods host',
  );
}

try {
  const output = execFileSync('xcodebuild', ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  add('tool:xcodebuild', 'pass', output);
} catch {
  add(
    'tool:xcodebuild',
    process.platform === 'darwin' ? 'fail' : 'blocked',
    process.platform === 'darwin'
      ? 'xcodebuild not available'
      : 'iOS build validation requires macOS/Xcode host',
  );
}

const failed = checks.filter(item => item.status === 'fail');
const blocked = checks.filter(item => item.status === 'blocked');
const warned = checks.filter(item => item.status === 'warn');
const result = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  hostPlatform: process.platform,
  summary: {
    pass: checks.filter(item => item.status === 'pass').length,
    warn: warned.length,
    fail: failed.length,
    blocked: blocked.length,
  },
  checks,
};

console.log(JSON.stringify(result, null, 2));
if (failed.length > 0) {
  process.exitCode = 1;
}
