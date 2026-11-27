# Root causes and measured repairs

1. The baseline main advisor called the legacy `/api/advisor/chat` and read an old provider status, bypassing local generation. The main view now uses the unified `/api/intelligence/consult`, intercepted by the Android native bridge. A legacy scientific feature flag no longer disables the basic AI core.
2. Installed, active and loaded were conflated. Native status now exposes each separately, verification state, actual execution phase and last operation error. A failed operation is displayed even if weights remain loaded. This does not prove generation quality.
3. Legacy follow-up context was stored but short replies were classified as unclear. Nonurgent referrals were appended after an early return. Context handling and referral ordering were repaired; unified fallback preserves protected referrals.
4. Actual constrained generation produced hundreds of whitespace tokens until its limit. GBNF whitespace is bounded; failed and corrected raw probes are retained. Work plans require an actual tool, selected by the model. Duplicate idempotent tools are rejected before an unproductive loop consumes the entire budget.
5. Application capability dialogue had been treated as a scientific/product consultation. It now has application-contract facts, an ordinary dialogue policy and a restricted dialogue decision schema. Clinical evidence guards remain independent and unchanged.
6. Runtime wiring is not the remaining semantic solution. Actual 2B main-UI and isolated paired planner tests still produce irrelevant clarification. A shorter Arabic prompt reduced latency but did not improve semantic understanding; it was NOT adopted. Phi also failed quality checks, so the baseline model was not replaced for appearances.

Evidence is under docs/v3.2/native-execution-evidence, main-ui-2b-dialogue-schema, native-phi-evidence and native-planner-concise-evidence. Host Chromium with actual C++ inference proves the Host main path, not Android/JNI or Samsung acceptance. New APK builds require separate verification and owner testing.

7. A reference-attribution negative control exposed loss of Arabic negation despite lexical overlap. A local two-word negated-anchor guard now rejects the reproduced inversion without changing existing support thresholds; this remains conservative and incomplete for novel morphology. Failed attribution was never adopted.
8. Android compilation found duplicate JNI vision definitions from integration. The duplicate block was removed and failure logs preserved. The new Android build must prove this correction; Host vision success does not imply Android compilation.


## V6.9 active checkpoint — 2026-11-27
Production signing remains DEFERRED BY OWNER. Source now targets dev.4 / code9; no APK exists for this checkpoint yet. Last delivered dev.3 remains separately identified.
Implemented additive migration012: explicit owner-scoped redacted conversation snapshots, authenticated list/resume/delete, restore after active-session expiry, max100 saved contexts. Memory is not scientific evidence; current inventory must be checked again.
Empty model clarifications now trigger bounded repair then transparent fallback instead of a canned question counted as generation.
A bounded PubMed/Europe PMC research metadata tool is linked to research mode after validated local consultation. Retrieved titles/identifiers remain unreviewed, separate from final scientific claims; this is not full deep-research synthesis.
Verification: 285/285 software tests, TypeScript check and mobile asset build PASS. Two prior backup-test failures were stale expected migration lists; updated for additive012 while preserving 10,000-record content checks. No Samsung execution or generative quality gate is newly passed.
Qwen3-4B-Instruct-2507 Q4_K_M candidate size/hash verified (2497281120 bytes, 3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597). Isolated frozen-case Host comparison in progress; preserve outputs before rerunning. Baseline unchanged.
Semantic E5 experiments produced poor retrieval and remain experimental, outside Android integration. No semantic acceptance claimed.


## V6.9 continuation — native completion and repeated clarification
Source targets dev.5/code10. Previous dev.4/code9 Android run45936337100 PASS, artifact15170976997 verified and delivered separately. Dev.4 Debug certificate differs from dev.3; no compatible update or data transfer is claimed. Production signing remains DEFERRED BY OWNER.
Added exact normalized pending-question repeat rejection across plan/decision/segments, bounded repair then explicit fallback. Native metrics/model identity now travel from actual Java bridge into consultation diagnostics; telemetry is explicitly reported, not independent attestation or semantic acceptance. Length/cancel/error/zero-token completions cannot silently become final generated answers.
288/288 software tests PASS, typecheck and mobile asset build PASS. Two initial old synthetic tests reused the same fixed clarification to set up unrelated revision/correction checks; their setup now uses distinct questions while preserving all ownership, stale-revision, context and redaction assertions. Failure log retained. New repeated-question regression remains strict. Actual Host main UI regression is being recorded; Samsung execution remains NOT TESTED.
The isolated two-stage paraphrase experiment did not improve shared acceptance (1/3 weak plan checks, same as baseline), introduced incorrect paraphrases and repeated questions; NOT ADOPTED. Original questions/history and all raw failures remain retained.

V6.9 actual main-UI regression is complete: docs/v3.2/v69-main-ui contains3 actual native calls and two turns, raw responses, metrics and screenshot base64. Guard rejected repeated clarification after bounded repair. Initial plan still omitted hair context; conversational Gate02 remains FAIL. Current code remoteec7b34b84075fb175f4a81912ec42977e411ef8c, tree52903ca33e6e2c6e7569b6b31d00c309126295f6. Android dev.5/code10 run45939536985 in progress when this record was written; recover it before rebuilding. Source control metadata may differ locally; compare trees.


## Current V7.0 resumption

See `docs/v3.2/v70-resumed/state.json` and fresh logs for current source/limits. Retained constraints now reach tools; essential-oil exclusion and unresolved-fallback relevance regressions pass. No intelligence gate or Samsung acceptance is upgraded.


V7.0 resumed diagnostic: current Host lifecycle11 checks PASS; exact674 input tokens and full-vocabulary logits match reference batching/reset, and64 constrained decoding steps match direct/common sampler paths. No demonstrated BOS/prefill/reset/sampler mechanism explains the failed semantics. The older CLI discrepancy remains unresolved. See docs/v3.2/v70-resumed-parity; no intelligence PASS or production runtime change follows.
