#!/usr/bin/env bash
# CP09: score the blind safety set on the Node server AND inside the Android web bundle (static, offline).
set -e; cd "$(dirname "$0")/.."
node scripts/build-mobile.mjs > /dev/null
PORT=${PORT:-8078}; (cd dist-mobile && exec python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/index.html >/dev/null && break; sleep 0.25; done
node --no-warnings --import tsx tests/cp09-safety-both.mjs http://localhost:$PORT
