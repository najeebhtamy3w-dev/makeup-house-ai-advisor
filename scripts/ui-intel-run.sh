#!/usr/bin/env bash
# CP08: fresh DB + server with MH_CP07=1 + staff/manager screens of the unified advisor (360 / 390 px, no network, no cloud provider).
# Usage: scripts/ui-intel-run.sh
set -e; cd "$(dirname "$0")/.."
D=${TMPDIR:-/tmp}/mh-intel-$$; mkdir -p $D; export MH_DB_PATH=$D/intel.db MH_SECRET=intel-secret PORT=${PORT:-8093} MH_ENRICH=off MH_CP07=1
unset MH_LLM_PROVIDER MH_LLM_API_KEY
node --no-warnings --import tsx scripts/dev-seed.ts
node --no-warnings --import tsx server/src/server.ts > $D/server.log 2>&1 & SP=$!
trap 'kill $SP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:$PORT/api/health >/dev/null && break; sleep 0.25; done
node tests/ui-intel.mjs http://localhost:$PORT
