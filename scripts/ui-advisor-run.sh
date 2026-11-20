#!/usr/bin/env bash
# CP06.2 Phase 1: fresh DB + server + conversational advisor suite (360 and 390 px, no AI provider, no network). Usage: scripts/ui-advisor-run.sh
set -e; cd "$(dirname "$0")/.."
D=${TMPDIR:-/tmp}/mh-adv-$$; mkdir -p $D; export MH_DB_PATH=$D/adv.db MH_SECRET=adv-secret PORT=${PORT:-8091} MH_ENRICH=off
node --no-warnings --import tsx scripts/dev-seed.ts
node --no-warnings --import tsx server/src/server.ts > $D/server.log 2>&1 & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/api/health >/dev/null && break; sleep 0.25; done
node tests/ui-advisor.mjs http://localhost:$PORT
