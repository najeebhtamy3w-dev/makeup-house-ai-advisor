#!/usr/bin/env bash
# Builds and signs the RELEASE APK with the owner's permanent key.
# Passwords are prompted interactively (never stored in files or git).
set -euo pipefail
PROPS="${SMARTSTOCK_SIGNING:-$HOME/.smartstock/signing.properties}"
[ -f "$PROPS" ] || { echo "Missing $PROPS (see SMART_STOCK_SIGNING_GUIDE.md)"; exit 1; }
read -rsp "Keystore password: " SMARTSTOCK_STORE_PASSWORD; echo
read -rsp "Key password (Enter = same): " SMARTSTOCK_KEY_PASSWORD; echo
export SMARTSTOCK_STORE_PASSWORD SMARTSTOCK_KEY_PASSWORD="${SMARTSTOCK_KEY_PASSWORD:-$SMARTSTOCK_STORE_PASSWORD}" SMARTSTOCK_SIGNING="$PROPS"
cd "$(dirname "$0")/.."
./gradlew --no-daemon clean :app:testDebugUnitTest :app:assembleRelease
APK=app/build/outputs/apk/release/app-release.apk
"${ANDROID_HOME:?set ANDROID_HOME}"/build-tools/35.0.0/apksigner verify --print-certs "$APK"
cp "$APK" SMART_STOCK_V$(grep versionName app/build.gradle | head -1 | sed "s/.*'\(.*\)'.*/\1/")_RELEASE.apk
sha256sum SMART_STOCK_V*_RELEASE.apk
