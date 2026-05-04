# Alert Stack/Foundation 2A

## Baseline

- Mobile stack is React Native 0.78 with Hermes enabled and New Architecture explicitly disabled.
- Android debug device validation depends on bundled JS and `armeabi-v7a` for the connected Samsung.
- CMake on this Windows workstation must use `Unix Makefiles` plus the NDK `make.exe` override.
- Runtime configuration exists, but production safety around provider defaults and debug flags needed a firmer contract.

## Actions In This Round

- Added explicit TypeScript foundation checks in `tsconfig.json`.
- Added root scripts for repeatable typecheck, foundation doctor, debug build and debug install.
- Added `scripts/doctor-foundation.cjs` to audit dependency drift, TS config, Hermes/New Architecture flags, Android CMake override, ignored secret files and legacy host references.
- Added mobile runtime flags for environment and popup validation, with production safety checks.
- Hardened backend runtime config so production can fail fast instead of silently using public provider defaults.
- Added backend runtime tests for provider-default policy.

## Known Follow-Ups

- Align all `@react-native-firebase/*` packages to one version and refresh `package-lock.json`.
- Move `typescript` out of runtime dependencies when the lockfile can be updated.
- Remove obsolete `@types/react-native` after confirming no local type gaps.
- Decide whether tracked Firebase provider config files should remain committed or move to environment-specific secure provisioning.
- Validate iOS only on a real macOS/iOS toolchain before claiming iOS readiness.
