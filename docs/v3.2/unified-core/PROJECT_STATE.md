# Unified AI core — active implementation checkpoint

2026-11-26. Owner authorized actual source fixes, true local generation, diagnostics, scientific tools and phased multimodal work. NOT production accepted.

- Baseline branch work-v32-generative-orchestrator, local94e9c3d (published equivalent ca5ec5b), delivered APK source bdeef660.
- Checkpoint branch checkpoint/pre-unified-core-20261126 created; active work branch work-v32-unified-scientific-core.
- Fresh baseline npm test:222 passed,0failed,0skipped.
- Implemented canonical /api/intelligence/consult and /status; native bridge intercepts canonical path. Main UI delegates unified screen (UI worker).
- Core no longer depends on legacy scientific feature toggle. Optional research/settings retain controls.
- Referrals survive legacy early clarification; short context follow-up repair tested.
- Added real bounded recent-turn memory with PII redaction, pending question; audit turns remain structured.
- Added structured Arabic response segments with independent conservative claim validation; nonmedical application-capability facts separate from scientific sources.
- Added per-turn trace, invocation attempts vs successful generations, explicit fallback reasons; mobile cancellation/deadline/phases.
- Native worker adding constrained observed-ID grammar + genuine raw manager diagnostics; real Host2B restored and hash checked;4B download in progress. No Android/phone acceptance yet.
- Knowledge worker changes are on disk: specialist analysis and provenance pack; not yet integrated/verified centrally.
- Product-image worker implementing safe reviewed drafts and existing image-store tools; no VLM claim.
- Fresh focused core20/20 passed. Typecheck currently fails2 implicit-any annotations in new UI test; owner notified. Browser executable missing; restoring installed Playwright's matching binary for real UI test.

Next: integrate specialist tools, fix typecheck, run full suite, real Host model through main UI, preserve raw failures, build Android via existing CI, verify APK identity/hash/alignment. Existing downloaded owner model must not be deleted; package identity/signing must preserve update continuity. No permanent signing secret available in workspace.

Field evidence: owner reports installed/active=true, loaded=false and real61byte/6236ms diagnostic. Native status snapshot SM-S908E/qcom/SM8450, totalMem11749158912 bytes (differs from user8GB description), available5691801600; preserve conservative8GB design target and distinguish snapshot from controlled measurement.

## Integrated checkpoint

- Core commit2236681. Integrated259/259 server/unit/contract tests now PASS,0failed/0skipped; project typecheck PASS, mobile web build PASS.
- UI/lab/attachment contract tests are included but use synthetic data; not intelligence acceptance.
- Native actual Host tests: lifecycle11/11, pure constraints13/13, parser9/9. Found real unbounded-whitespace generation loop, fixed bounded whitespace and retained original failed probes.
- Actual2B and4B raw Arabic samples saved under native-execution-evidence; both have semantic/language limitations, no automatic4B adoption.2B VmHWM~1.83GiB,4B~4.09GiB (Host).
- Actual new2B development2turns: clarification route returned but intent/slots/toolchoice failed expectations; no acceptance claim. Raw outside repo in unified-core-evidence/2b-development-after-core pending copy.
- Real Chromium headless restored pinned151.0.7922.34 from official Google storage after CDN blocked and fullChrome process-singleton blocked; headless shell successfully launches. Main UI-to-real Host binary test ongoing; initial selector/harness errors retained, not product acceptance.
- Git CLI push lacks credentials; use authorized GitHub connector object API. New remote work-v32-unified-scientific-core created fromca5ec5b, no main changes/forcepush.
- RootcreateProductRecord reuses existing product insert path; no third autonomous insert. Productattachment writes need managerconfirmed click and remain review/unknownstock.
- Native rawdiagnose has noRAG/schema/fallback and is manager-only. Main UI displays validated conversationtext and actualmodel state. Pendingphase screenshots provided by owner are baseline dev1, not currentdev2 acceptance.
- Owner model must remain on phone. Native install shortcircuits existing correct model. No permanentkey present; debugsigning update continuity must be checked rather than assumed.
