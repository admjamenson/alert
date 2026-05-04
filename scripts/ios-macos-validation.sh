#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "blocked: iOS build validation requires macOS" >&2
  exit 2
fi

command -v pod >/dev/null 2>&1 || {
  echo "blocked: CocoaPods is not installed" >&2
  exit 2
}

command -v xcodebuild >/dev/null 2>&1 || {
  echo "blocked: Xcode command line tools are not installed" >&2
  exit 2
}

pushd ios >/dev/null
pod install
xcodebuild \
  -workspace A1.xcworkspace \
  -scheme A1 \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
popd >/dev/null

echo "iOS macOS validation passed"
