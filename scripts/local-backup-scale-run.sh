#!/usr/bin/env bash
# CP06.3: builds the Android web bundle and runs the backup/restore scale + attack suite against it (static files only).
# Usage: scripts/local-backup-scale-run.sh   (SCALE_IMAGES=1000 STRESS_IMAGES=2500 by default)
set -e; cd "$(dirname "$0")/.."
node scripts/build-mobile.mjs > /dev/null
PORT=${PORT:-8076}; (cd dist-mobile && exec python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/index.html >/dev/null && break; sleep 0.25; done
node --no-warnings --import tsx tests/local-backup-scale.mjs http://localhost:$PORT
