#!/usr/bin/env bash
# Fresh DB + server + UI acceptance run. Usage: scripts/ui-run.sh
set -e; cd "$(dirname "$0")/.."
D=${TMPDIR:-/tmp}/mh-ui-$$; mkdir -p $D; export MH_DB_PATH=$D/ui.db MH_SECRET=ui-secret PORT=${PORT:-8099} MH_ENRICH=${MH_ENRICH:-mock}
pkill -f "server/src/server.ts" 2>/dev/null || true; sleep 0.5
node --no-warnings --import tsx scripts/dev-seed.ts
node --no-warnings --import tsx server/src/server.ts > $D/server.log 2>&1 & SP=$!
sleep 2; node tests/ui.mjs http://localhost:$PORT; RC=$?; kill $SP 2>/dev/null; exit $RC
