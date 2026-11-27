#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/mh-download-java.XXXXXX")"
if command -v javac >/dev/null 2>&1; then
  javac -d "$build_dir" "$repo_dir/android/app/src/main/java/com/makeuphouse/advisor/ResumableAssetDownload.java" "$repo_dir/tests/java/com/makeuphouse/advisor/ResumableAssetDownloadTest.java"
else
  java -m jdk.compiler/com.sun.tools.javac.Main -d "$build_dir" "$repo_dir/android/app/src/main/java/com/makeuphouse/advisor/ResumableAssetDownload.java" "$repo_dir/tests/java/com/makeuphouse/advisor/ResumableAssetDownloadTest.java"
fi
java -cp "$build_dir" com.makeuphouse.advisor.ResumableAssetDownloadTest
