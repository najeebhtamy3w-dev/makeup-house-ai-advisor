#!/usr/bin/env bash
# OWNER ONLY — run on the owner's own computer (never in a cloud session, never in CI).
# Creates the PERMANENT release key of MAKEUP HOUSE AI Beauty Advisor. Every future update must be signed with this same
# key, or Android refuses to install it over the existing app (and the shop's data would have to be moved by backup/restore).
# Keep: the .jks file + both passwords in TWO separate safe places (e.g. an encrypted USB drive and a password manager).
# Never commit it, never email it, never upload it to a chat or a cloud drive without encryption.
# Usage: scripts/owner-keygen.sh /path/outside/the/repo/makeuphouse-release.jks
set -euo pipefail
OUT=${1:?"give the output path of the keystore, OUTSIDE the repository"}
case "$(cd "$(dirname "$OUT")" && pwd)/" in "$(cd "$(dirname "$0")/.." && pwd)/"*) echo "Refusing: the keystore must be created outside the repository." >&2; exit 1;; esac
[ -e "$OUT" ] && { echo "Refusing: $OUT already exists (never overwrite a release key)." >&2; exit 1; }
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (17 or newer)." >&2; exit 1; }
# keytool asks for the passwords interactively; they are never written to disk or to the shell history by this script.
keytool -genkeypair -v -keystore "$OUT" -alias makeuphouse -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=MAKEUP HOUSE, O=MAKEUP HOUSE"
echo
echo "Created $OUT. Its certificate fingerprint (record it in the release notes; it is not secret):"
keytool -list -v -keystore "$OUT" -alias makeuphouse | grep -E "SHA256:" || true
echo "Next: create a keystore.properties OUTSIDE git (see docs/RELEASE_SIGNING_AND_CUSTODY.md), or use scripts/sign-release.sh."
