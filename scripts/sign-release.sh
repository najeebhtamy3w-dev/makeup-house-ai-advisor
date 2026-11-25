#!/usr/bin/env bash
# OWNER ONLY — signs the unsigned release candidate with the owner's permanent key, on the owner's own computer.
# Usage: scripts/sign-release.sh app-release-unsigned.apk /path/to/makeuphouse-release.jks [alias]
# apksigner asks for passwords interactively. No secrets are stored. Output includes the APK's actual version.
set -euo pipefail
IN=${1:?"unsigned APK"}; KS=${2:?"owner keystore (.jks)"}; ALIAS=${3:-makeuphouse}
BT=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}/build-tools; BT=$(ls -d "$BT"/* 2>/dev/null | sort -V | tail -1)
[ -x "$BT/apksigner" ] || { echo "apksigner not found: install Android SDK build-tools and set ANDROID_HOME." >&2; exit 1; }
VERSION=$("$BT/aapt" dump badging "$IN" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
[[ "$VERSION" =~ ^[0-9A-Za-z._-]+$ ]] || { echo 'Cannot determine a safe APK version.' >&2; exit 1; }
OUT="makeuphouse-advisor-$VERSION-release.apk"
[ ! -e "$OUT" ] || { echo "Refusing to overwrite $OUT" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf -- "$TMP"' EXIT
"$BT/zipalign" -P 16 -f 4 "$IN" "$TMP/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$ALIAS" --out "$TMP/signed.apk" "$TMP/aligned.apk"
CERT=$("$BT/apksigner" verify --print-certs "$TMP/signed.apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
[ "$CERT" = b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386 ] || { echo 'Signing certificate does not match the permanent owner key; output refused.' >&2; exit 1; }
"$BT/zipalign" -c -P 16 4 "$TMP/signed.apk"
mv -- "$TMP/signed.apk" "$OUT"
"$BT/apksigner" verify --verbose --print-certs "$OUT" | grep -E "Verified using|SHA-256 digest"
"$BT/aapt" dump badging "$OUT" | grep -E "^package|debuggable" || true
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
echo "Signed: $OUT — compare the certificate SHA-256 above with the one recorded at key creation; it must be identical for every update."
