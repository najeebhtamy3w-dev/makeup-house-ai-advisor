#!/usr/bin/env bash
# OWNER ONLY — signs the unsigned release candidate with the owner's permanent key, on the owner's own computer.
# Usage: scripts/sign-release.sh app-release-unsigned.apk /path/to/makeuphouse-release.jks [alias]
# apksigner asks for the passwords interactively (nothing is stored). Output: makeuphouse-advisor-3.0.0-release.apk
set -euo pipefail
IN=${1:?"unsigned APK"}; KS=${2:?"owner keystore (.jks)"}; ALIAS=${3:-makeuphouse}
BT=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}/build-tools; BT=$(ls -d "$BT"/* 2>/dev/null | sort -V | tail -1)
[ -x "$BT/apksigner" ] || { echo "apksigner not found: install Android SDK build-tools and set ANDROID_HOME." >&2; exit 1; }
OUT=makeuphouse-advisor-3.0.0-release.apk; TMP=$(mktemp -d); trap 'rm -rf -- "$TMP"' EXIT
"$BT/zipalign" -p -f 4 "$IN" "$TMP/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$ALIAS" --out "$OUT" "$TMP/aligned.apk"
"$BT/apksigner" verify --verbose --print-certs "$OUT" | grep -E "Verified using|SHA-256 digest"
"$BT/aapt" dump badging "$OUT" | grep -E "^package|debuggable" || true
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
echo "Signed: $OUT — compare the certificate SHA-256 above with the one recorded at key creation; it must be identical for every update."
