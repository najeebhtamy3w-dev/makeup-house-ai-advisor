#!/usr/bin/env bash
# Empty-catalog acceptance: fresh temp DB, staging mode, NO dev seed; restarts the server on the same DB mid-test.
set -e; cd "$(dirname "$0")/.."
D=$(mktemp -d "${TMPDIR:-/tmp}/mh-empty-XXXX")
export NODE_ENV=production MH_STAGING=1 MH_DB_PATH=$D/app.db MH_SECRET=empty-test-secret-0123456789abcdef0123456789 PORT=${PORT:-8092} MH_ADMIN_USER=owner-empty MH_ADMIN_PASSWORD=owner-empty-pass-1
export READY_FILE=$D/ready GO_FILE=$D/go
start() { node --no-warnings --import tsx server/src/server.ts </dev/null >> $D/server.log 2>&1 & SP=$!; for i in $(seq 1 40); do curl -s localhost:$PORT/api/health >/dev/null && return; sleep 0.25; done; }
start
node tests/ui-empty.mjs http://localhost:$PORT & TP=$!
while kill -0 $TP 2>/dev/null; do if [ -f $READY_FILE ] && [ ! -f $GO_FILE ]; then kill $SP; wait $SP 2>/dev/null || true; start; touch $GO_FILE; fi; sleep 0.3; done
set +e; wait $TP; RC=$?; kill $SP 2>/dev/null
echo "server starts: $(grep -c 'MAKEUP HOUSE listening' $D/server.log) · logged 'products are never seeded': $(grep -c 'products are never seeded' $D/server.log)"
exit $RC
