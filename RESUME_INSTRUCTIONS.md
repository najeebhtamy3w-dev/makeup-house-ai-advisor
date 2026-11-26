# Resume without restarting

1. Read PROJECT_STATE.md, RELEASE_MANIFEST.json and git status/log. Preserve newer changes and never reset or force push.
2. Cached toolchain: ../toolchain/native-recovery/{host/mh-ai-session,python,llama}. Verified 2B/4B weights and isolated Phi candidate remain outside Git. Do not redownload valid files.
3. Browser: ../toolchain/browser/chrome-headless-shell-linux64/chrome-headless-shell. Full Chrome process-singleton is blocked; headless shell works. Playwright is in CODEX_PRIMARY_RUNTIME_NODE_MODULES.
4. Run npm test, npm run typecheck, npm run build:mobile as changes require. Real Host main-UI harness: scripts/unified-main-real-inference.mts. Use a NEW MH_EVAL_OUT folder and MH_EVAL_CASES JSON. It invokes an actual native binary, but is not Android/JNI acceptance.
5. Read actual logs in ../unified-core-evidence and docs/v3.2 native evidence folders. Failed and incomplete runs are not successes. Latest 2B open dialogue failed semantic understanding.
6. Direct git push lacks HTTPS credentials; GitHub connector create_tree/create_commit/update_ref with expected SHA and force:false works. Last verified remote head before this checkpoint: 899df0253dabe0e023ac661386cb80d387973441, content tree 1a258e549d42429d92bfc1b646c7f5fe094b026c. Verify current remote before updating. Local/remote commit metadata can differ; content trees must match.
7. CI: .github/workflows/v32-engineering.yml and scripts/ci-v32-build.sh. Completed OCR build run 45831293938 PASS; artifact 15121519592 is verified in ../delivery/v32-ocr. Do not rebuild this unchanged commit. Native invocation-accounting changes are newer and not in that APK.
8. OCR assets: python3 scripts/prepare-ocr-assets.py AFTER Android sync, BEFORE Gradle. Pinned size/hash verified; cached AAR/models/licenses reused. Generated assets are not source Git blobs.
9. Owner signing key unavailable. Never generate a replacement permanent key, uninstall the existing app or delete data/weights. Debug runner certificate may differ from an older debug build; do not claim compatible update.
10. Next: complete real dialogue quality, inspect concise-planner evidence, finish actual VLM probe, then device integration/acceptance. Scientific qualified review and Samsung tests remain required. Do not stop at a build or interface pass.

11. Owner signing: docs/v3.2/OWNER_SIGNING_RECOVERY_AR.md. Do not request JKS/password in chat. Protected environment and installed APK public certificate must be verified by owner. The request trigger file is intentionally absent until real verified inputs are available.
12. Native vision: optional projector already verified in ../toolchain/native-recovery/mmproj-F16.gguf. Native wrapper and Host evidence in docs/v3.2/vision-probe; restore synthetic fixtures from .base64 via provided script. Never confuse Host vision with Samsung/full product acceptance.
