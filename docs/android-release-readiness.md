# Alert Android Release Readiness

This document captures the release path used for Samsung validation.

## Commands

```powershell
npm.cmd run android:release:device
npm.cmd run android:release:readiness
adb install --no-streaming -r android\app\build\outputs\apk\release\app-release.apk
npm.cmd run android:startup:release
```

## Current Evidence

- Release APK contains `assets/index.android.bundle`.
- Release APK contains native libraries for `arm64-v8a` and `armeabi-v7a`.
- Samsung release install completed after the Play Protect prompt was dismissed with "Don't send".
- Five release startup samples are stored under `artifacts/android-startup-20260418-030610`.
- Measured release p50/p95:
  - `am start -W TotalTime`: 503ms / 526ms
  - native critical overlay ready: 79ms / 85ms
  - JS SOS ready: 243ms / 255ms
  - main app ready: 633ms / 660ms

## Current Blocker

Store signing credentials are not configured on this Windows host. The release is installable and multi-ABI, but not store-signed until `android/keystore.properties` or `ALERT_RELEASE_*` variables are provided and the build is run with `ALERT_REQUIRE_RELEASE_SIGNING=true`.
