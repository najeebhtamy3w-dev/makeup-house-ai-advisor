#!/usr/bin/env bash
# CP06.2 Phase 1: fresh DB + server + product-edit navigation suite (360 and 390 px). Usage: scripts/ui-nav-run.sh
set -e; cd "$(dirname "$0")/.."
D=${TMPDIR:-/tmp}/mh-back-$$; mkdir -p $D; export MH_DB_PATH=$D/nav.db MH_SECRET=nav-secret PORT=${PORT:-8099} MH_ENRICH=mock
node --no-warnings --import tsx scripts/dev-seed.ts
node --no-warnings --import tsx server/src/server.ts > $D/server.log 2>&1 & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/api/health >/dev/null && break; sleep 0.25; done
node tests/ui-android-back.mjs http://localhost:$PORT
