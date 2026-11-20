#!/usr/bin/env bash
# Final completion: extra codes, dashboard, bulk classify (Chromium 360 px; not device evidence).
# Usage: scripts/ui-final-run.sh
set -e; cd "$(dirname "$0")/.."
D=${TMPDIR:-/tmp}/mh-final-$$; mkdir -p $D; export MH_DB_PATH=$D/final.db MH_SECRET=final-secret PORT=${PORT:-8098} MH_ENRICH=off
unset MH_LLM_PROVIDER MH_LLM_API_KEY
node --no-warnings --import tsx scripts/dev-seed.ts
node --no-warnings --import tsx server/src/server.ts > $D/server.log 2>&1 & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/api/health >/dev/null && break; sleep 0.25; done
node tests/ui-final.mjs http://localhost:$PORT
