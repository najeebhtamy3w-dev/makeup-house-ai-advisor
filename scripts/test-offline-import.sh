#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/mh-offline-import-java.XXXXXX")"
trap 'rm -rf -- "$build_dir"' EXIT
sources=(
  "$repo_dir/android/app/src/main/java/com/makeuphouse/advisor/ResumableAssetDownload.java"
  "$repo_dir/android/app/src/main/java/com/makeuphouse/advisor/VerifiedAssetImport.java"
  "$repo_dir/tests/java/com/makeuphouse/advisor/VerifiedAssetImportTest.java"
)
if command -v javac >/dev/null 2>&1; then
  javac -source 8 -target 8 -Xlint:-options -d "$build_dir" "${sources[@]}"
else
  java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -Xlint:-options -d "$build_dir" "${sources[@]}"
fi
java -cp "$build_dir" com.makeuphouse.advisor.VerifiedAssetImportTest
