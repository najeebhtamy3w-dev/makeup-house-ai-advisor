#!/usr/bin/env bash
# CP06: builds the Android web bundle and runs the local-first acceptance test against it, served as static files only.
set -e; cd "$(dirname "$0")/.."
node scripts/build-mobile.mjs
PORT=${PORT:-8075}; (cd dist-mobile && exec python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/index.html >/dev/null && break; sleep 0.25; done
node tests/local-app.mjs http://localhost:$PORT
