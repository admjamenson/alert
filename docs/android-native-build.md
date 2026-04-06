# Android Native Build Flow

This project must be validated with a full native Android build from the current workspace.

## Why

- The Samsung currently has the legacy package `com.anonymous.Alerta` installed.
- The current workspace is configured as `com.company.alert`.
- The current Android build autolinks `react-native-screens`, `react-native-reanimated`, `react-native-gesture-handler`, and the rest of the React Native native stack correctly.
- Patching `index.android.bundle` into the legacy APK mixes a new JS bundle with an older native shell and can trigger runtime errors such as `No ViewManager found for class RNSScreenContentWrapper`.

## Current app identity

- `namespace`: `com.company.alert`
- `applicationId`: `com.company.alert`
- Legacy package on the Samsung: `com.anonymous.Alerta`

## Do not do this

- Do not reuse `scripts/patch-alert-debug-apk.ps1`.
- Do not copy `index.android.bundle` into `android/app/src/main/assets`.
- Do not validate the current JS bundle inside the legacy `com.anonymous.Alerta` shell.

## Supported build flow

From the repository root:

```powershell
npm run android:build:native
adb install -r android\app\build\outputs\apk\release\app-release.apk
adb shell monkey -p com.company.alert -c android.intent.category.LAUNCHER 1
```

Or rebuild and install in one Gradle pass:

```powershell
npm run android:rebuild:native
```

## One-command smoke test

To build, install, launch, capture `logcat`, dump the current UI tree, and save a fresh screenshot in `artifacts/`:

```powershell
npm run android:smoke:release
```

Or, on this Windows workspace without relying on `npm`:

```powershell
.\tools\run_android_smoke_release.cmd
```

Notes:

- The script prefers the USB-connected device when more than one device is attached.
- You can override the target device with `ALERT_ANDROID_SERIAL=<serial>`.
- If `android-sdk/platform-tools` is missing in the workspace, the script syncs it from the `adb` already available on the host before running `installRelease`.

## CI gate and release checklist

- GitHub Actions now exposes the `Android Release Smoke / smoke` check in [.github/workflows/android-release-smoke.yml](../.github/workflows/android-release-smoke.yml).
- The workflow is designed for a Windows self-hosted runner with an authorized Android device or emulator connected.
- Do not merge or cut an Android release if the smoke check is red, missing artifacts, or did not run on the self-hosted runner.
- When the workflow is temporarily unavailable, run `.\tools\run_android_smoke_release.cmd` locally and keep the fresh `artifacts/android-smoke-*` folder as release evidence.
- In GitHub branch protection, mark `Android Release Smoke / smoke` as a required status check for the protected branch.
- To automate that branch-protection update when the repository plan allows it, run `.\tools\run_set_github_required_smoke_check.cmd`.
- GitHub documents that protected branches and required status checks are available on public repositories with GitHub Free, and on private repositories only with GitHub Pro, Team, Enterprise Cloud, or Enterprise Server: https://docs.github.com/en/rest/branches/branch-protection

## Logs

If the app needs runtime verification after launch:

```powershell
adb logcat -c
adb shell monkey -p com.company.alert -c android.intent.category.LAUNCHER 1
adb logcat -d -t 300
```

## Notes

- The generated APK path is `android/app/build/outputs/apk/release/app-release.apk`.
- If the team later needs the current workspace to replace the legacy app instead of coexisting with it, that must be handled as a separate explicit package migration because it affects `applicationId`, Firebase config, signing, and device upgrade behavior.
