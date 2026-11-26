# Current real browser regression — 2026-11-26

Official Chrome for Testing headless shell 131.0.6778.204, Linux x86_64:
https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.204/linux64/chrome-headless-shell-linux64.zip

`BROWSER_SHA256SUMS.txt` records the independently downloaded ZIP checksum, not an upstream signed checksum. Version output is retained separately. Dependencies use the preinstalled Playwright exposed by `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. Full Chrome's process singleton required unsupported Unix sockets; official headless shell works with the Playwright pipe.

Reproduce with a freshly seeded throwaway database (never use production data):

```bash
MH_DB_PATH=/tmp/mh32-ui-fresh/ui.db MH_SECRET=ui-secret node --no-warnings --import tsx scripts/dev-seed.ts
MH_DB_PATH=/tmp/mh32-ui-fresh/ui.db MH_SECRET=ui-secret PORT=8096 MH_ENRICH=off node --no-warnings --import tsx server/src/server.ts
# In the same process environment / local network namespace:
CHROME_PATH=/absolute/toolchain/chrome/chrome-headless-shell-linux64/chrome-headless-shell SHOTS=/absolute/evidence/ui node tests/ui-intelligence-v32.mjs http://localhost:8096
```

Fixtures explicitly use synthetic products and batches. This is a real browser at a 390 × 844 mobile viewport on the Linux host. It is **not Android, Samsung acceptance, or real catalogue/inventory evidence**. The server and browser are launched within the same command because execution sessions use isolated process/network namespaces.

Current result: **PASSED 7/7** in `ui-v32.log`, including manager menus, synthetic product setup, real form batch creation and verified stock check, global draft form save and exclusion from reviewed retrieval, staff restrictions, unauthenticated access, and uncaught-error check. Inventory and global pages passed RTL/no-horizontal-overflow checks at 390 px. Both screenshots were visually inspected. The initial harness failure is retained: clearing sessionStorage on hash navigation left the running module's in-memory token intact; the test now reloads before checking unauthenticated behavior. No application authentication changes were needed.
