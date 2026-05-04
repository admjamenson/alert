# Alert iOS Readiness

This repository is prepared for iOS structurally, but this Windows host cannot prove an iOS build.

## Implemented In This Round

- iOS display name corrected to `Alert`.
- Required privacy usage descriptions are populated for location, contacts, camera, microphone and photo library.
- React Native module name now matches `app.json` (`Alert`).
- Example bundle identifier was removed from the Xcode project.
- `PrivacyInfo.xcprivacy` declares safety-critical location/contact data use and is included in app resources.
- `GoogleService-Info.plist` is referenced as an app resource for Firebase validation.
- Launch screen no longer uses template `A1` / React Native copy.
- `doctor:ios` checks Podfile, Podfile.lock, Info.plist, privacy manifest, Firebase plist membership, deployment target, CocoaPods and Xcode availability.

Run:

```powershell
npm run doctor:ios
```

## Validation Classification

- Proven on this host: iOS project files, plist keys, bundle id, module name, privacy manifest and Firebase plist project membership.
- Blocked on this host: `pod install`, `xcodebuild`, simulator boot, archive, signing and TestFlight validation.
- Required macOS validation: `pod install`, `xcodebuild -workspace ios/A1.xcworkspace -scheme A1 -configuration Debug -sdk iphonesimulator build`, then physical iPhone smoke.

## Current Risk

iOS should not be scored as fully validated until a macOS/Xcode run proves pods, native modules, signing, Firebase plist consistency and App Store billing paths.
