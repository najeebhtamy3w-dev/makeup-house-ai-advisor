#!/usr/bin/env bash
# CP06.2 Gate 1: proves the Render path can be produced WITHOUT the (unapproved) Android code, and still passes the
# server + UI suites. Works on a throw-away worktree; never touches a protected branch. Usage: scripts/render-path-check.sh
set -e; cd "$(dirname "$0")/.."
W=$(mktemp -d)/render-path; git worktree add -q --detach "$W" HEAD; trap 'git worktree remove --force "$W"' EXIT
cd "$W"
# Android-only paths (see docs/CP06_2_BRANCH_STRATEGY.md)
git rm -rq android mobile capacitor.config.json scripts/build-mobile.mjs scripts/local-run.sh tests/local-app.mjs web/js/views-backup.js
node -e "const f='package.json',p=require('./'+f);for(const k of Object.keys(p.devDependencies)) if(/^@capacitor\/|^@sqlite\.org\/|^@noble\/|^fflate$|^buffer$|^esbuild$/.test(k)) delete p.devDependencies[k];for(const s of ['build:mobile','test:local','android:sync']) delete p.scripts[s];require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
echo "Android-only files left: $(git ls-files | grep -cE '^(android|mobile)/|capacitor' || true)"
ln -s "$OLDPWD/node_modules" node_modules
npm test 2>&1 | grep -E "^# (pass|fail)"
npx tsc --noEmit && echo "typecheck OK"
PORT=8094 timeout 900 scripts/ui-run.sh 2>&1 | grep -cE "^PASS" | sed 's/^/ui PASS=/'
PORT=8093 timeout 600 scripts/ui-nav-run.sh 2>&1 | tail -1
