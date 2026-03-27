param()

$ErrorActionPreference = 'Stop'

$message = @"
legacy_apk_patch_disabled:
Do not patch index.android.bundle into an old Android shell for this project.

Root cause:
- the Samsung still has the legacy package com.anonymous.Alerta installed
- the current workspace builds com.company.alert with the current React Native native stack
- patching a newer JS bundle into the legacy shell causes native/JS mismatches such as RNSScreenContentWrapper errors

Use the native Gradle flow instead:
- npm run android:rebuild:native
- adb install -r android\app\build\outputs\apk\release\app-release.apk
- adb shell monkey -p com.company.alert -c android.intent.category.LAUNCHER 1

See docs\android-native-build.md for the documented workflow.
"@

throw $message
