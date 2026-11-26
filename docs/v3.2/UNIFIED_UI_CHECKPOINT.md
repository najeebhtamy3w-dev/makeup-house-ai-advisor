# Unified advisor UI checkpoint — 2026-11-26

IMPLEMENTED (source only; integrated release/native acceptance remains separate):

- Main `advisor()` enters unified `intel()`; historical `#/intel` is the same core, no separate experimental advisor menu.
- POST `/api/intelligence/consult`; GET `/api/intelligence/status`. No legacy `/api/advisor/status` is used by the primary interface.
- Native installed/active/loaded/error status is read directly. Active but unloaded is explicitly distinguished from an absent file. Unknown status remains unknown.
- Conversational validated text shown as paragraphs; evidence/source detail collapsed. Safety/referral sections remain visible before dialogue text. Fallback reason and actual invocation provenance are explicit.
- Cancel/reset and owned-session deletion retained; route departure cancels and removes progress listener.
- Manager-only `#/ai-lab` raw native diagnostic surface calls `MHLocalAI.diagnose(token,prompt)` directly. It never supplies a canned answer on failure, labels raw output unvalidated, and offers explicit JSON copy/export. It does not write scientific/product data and is not an employee consultation.
- Financial spend values removed from the touched scientific settings UI.

Files: `web/js/app.js`, `views-advisor.js`, `views-intel.js`, new `views-ai-lab.js`; tests `unified-advisor-ui.test.ts`, `native-lab-ui.test.ts`.

Fresh verification: JS syntax checks PASSED; the 12 focused Node VM/DOM-double UI contract tests PASSED, 0 failed/skipped. Project `npm run typecheck` PASSED at this checkpoint (integration may continue concurrently).

These tests use explicit synthetic API/native fixtures and do NOT count as real model inference, Chromium UI, Android or Samsung acceptance. Real browser binary was absent in this recovered environment. Root/native executor owns subsequent native/host/device acceptance and final build.

## Attachment and stored-image checkpoint

Added `web/js/chat-product-attachment.js`, integrated into main chat with an explicit “صورة منتج / باركود” button. Actual endpoints are `/api/intelligence/attachments/inspect-image`, `/api/intelligence/identity/barcode/:code`, `/api/intelligence/product-drafts/preview`, `/api/intelligence/product-drafts/confirm`, and `/api/intelligence/products/:id/images`. Image writes reuse existing `uploadImage()` and authenticated display helpers. This is file inspection/manual transcription/optional BarcodeDetector, explicitly NOT OCR or VLM interpretation. Employees inspect/search/use manual context; only manager can explicitly confirm a draft/image write from this screen. Drafts remain review/unknown availability. Data is not uploaded to external services.

JPEG/PNG file/camera inputs reuse 25MiB source/2MiB processed limits, image re-encoding, and authenticated stored thumbnails. Names/INCI/origin are entered by a person. Oversized consultation text is rejected with an explanation rather than silently truncating INCI. Product recommendation images appear only for positive local IDs carrying an actual `primary_image_id`; no invented global thumbnail.

Fresh focused verification: **20/20 UI contract tests passed**, 0 failed/skipped (8 unified including stored thumbnail, 5 raw lab, 7 attachments). These remain synthetic DOM/native/image-adapter tests, not camera, OCR, VLM or real model acceptance. Latest overall typecheck encountered concurrent changes outside this scope (`scripts/unified-main-real-inference.mts:15` HeadersInit typing); root notified. Earlier typecheck pass must not be treated as validation of those later changes.
