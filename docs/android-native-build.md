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
