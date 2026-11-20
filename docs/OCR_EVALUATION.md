# Local OCR — Evaluation and Decision

**Decision: deferred. Manual entry from the package stays.** This does not block the release: the authorization says "Do not make an unreliable OCR component a blocker … unless it was separately accepted as mandatory". It was not accepted as mandatory.

| Option | Arabic | Offline | Package / runtime cost | Fit | Status |
|---|---|---|---|---|---|
| Existing project OCR | — | — | — | none exists (`docs/CP05_EXPERT_DECISIONS.md` #14) | Not available |
| ML Kit Text Recognition v2 (on-device) | **No Arabic script** (Latin, Chinese, Devanagari, Japanese, Korean only) | Yes | Native plugin needed (+ several MB per script) | Would read only Latin INCI lists; adds native code to a WebView app | Not selected |
| Tesseract 5 WASM (`ara` + `eng`) | Yes | Yes | roughly 2–4 MB WASM, plus a few MB of language data per language; seconds per image on mid-range phones | Accuracy on curved, glossy, small-print packages is unknown | Not selected without a benchmark |
| Cloud OCR | Yes | No | Paid; sends product photos to a third party | Forbidden without owner approval | Out of scope |

## Why there is no benchmark number

A meaningful benchmark needs real photographs of the shop's own packages. They are not in the repository. Sending them to any service is not authorized, and synthetic images would overstate accuracy. Per "Do not assume OCR accuracy", no accuracy figure is claimed here. All size figures above are REPORTED (published sizes), not measured in this project.

## If the owner wants OCR later

1. The owner supplies about 50 photos, stored locally.
2. Benchmark Tesseract WASM (`ara+eng`) on them in the worker: character accuracy on the name and the INCI line, time per image on the Samsung, and APK growth.
3. Ship only as **proposed text**. It enters the existing evidence flow as `unverified` and needs human approval, exactly like provider data. It must never fill a product field directly.
