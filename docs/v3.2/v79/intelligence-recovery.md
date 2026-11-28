# V7.9 targeted intelligence recovery — zero repeated inference

Recovered repository baseline: `4577ea280e91dcf821586290c406935daf769d92`, branch `work-v32-unified-scientific-core`. This note records a read-only evidence recovery and a bounded proposed implementation seam. No model execution, download, sampling experiment, planner trial, Android run or production-source edit was performed for this recovery.

## Durable evidence actually found

| Requested evidence | Actual inspected state | Permitted conclusion |
| --- | --- | --- |
| Latest V7.6 Layer A2B raw dialogue results | Only `docs/v3.2/v76/raw-layer-a/run.py` survived in this clone. No corresponding results.jsonl, before-inference protocol/requests, assessment or result report was found in either available scratch tree. | The suite definition exists. The latest raw execution artifacts cannot currently be reverified. Do not rerun the finished suite to replace lost evidence. |
| Latest V7.6 Layer A4B comparison | No raw-layer-a-4b results, protocol, script or assessment survived in the inspected trees. | Conversation-recorded execution is summarized separately below; do not label it recovered raw evidence. |
| Gemma3 project run / candidate results | No Gemma3 candidate weights or project inference results were found. The cached llama source contains Gemma3 model code, a schema snapshot and build-target files; a third-party repository contains Gemma3 tests. | Architecture support, fixtures and build targets are not evidence of an executed project model comparison. This search does not prove Gemma3 was never tested elsewhere. |
| Gemma model-card cache | `preimplementation-study-2026-11-26/model_cards/google__gemma-4-E2B-it/config.json` exists; so do embedding-Gemma card files. | These are distinct model metadata, not Gemma3 inference results or acceptance. |
| Layer B/C/D named acceptance results | No durable named B/C/D protocol/results/assessment suite was found in the inspected project evidence directories. | No layer acceptance can be reconstructed from names alone. Existing scientific/runtime tests must retain their actual original scopes. |
| Earlier real planning/raw controls | Existing `docs/v3.2/v68-core/qwen3-4b-instruct-2507/candidate-plans.jsonl` and `raw-diagnostic-control.jsonl` survive, alongside earlier runtime/control evidence. | These are earlier, different cases and experiments. Reuse their own evidence; do not relabel them as the missing V7.6 four-case dialogue suite or Gemma evidence. |

Inspection scope: current clone `docs/v3.2`, current intelligence contracts, persistent `/workspace/scratch/921845f84f0b` project/evidence/cache trees, and available scratch paths containing raw-layer directories. Vendor-source Gemma references were distinguished from project results. No inference or network access was used.

Top-level cached GGUF assets actually present under persistent `toolchain/native-recovery`:

| Filename | Bytes |
| --- | --- |
| qwen35-2b.gguf |1280835840|
| qwen35-4b.gguf |2740937888|
| qwen3-4b-instruct-2507-q4km.gguf |2497281120|
| phi4-mini.gguf |2491874272|
| multilingual-e5-small-f16.gguf |242360000|
| multilingual-e5-small-q8_0.gguf |131624960|
| mmproj-F16.gguf |668227264|
| mmproj-qwen35-2b-f16.gguf |100806656|

This is a file/size inventory, not a fresh hash verification, loading test or license/model decision. A Gemma vocabulary fixture nested in the llama source is not an inference-ready Gemma candidate.

## RECORDED_CONVERSATION_SUMMARY_NOT_RAW_EVIDENCE

The following comes solely from the preceding execution conversation. It is retained to prevent repeated work, not upgraded to a recovered transcript, independently checked metric, benchmark score or acceptance certificate. No lost JSONL, protocol, full model answer, timing table or numerical assessment has been recreated.

The conversation reports four new raw natural-Arabic development dialogues on the cached Qwen3.5-2B baseline, then the same four on Qwen3-4B-Instruct-2507. Conditions were reported as one cached Host native diagnostic binary, greedy sampling,256-token caps, native model templates, fixed role-labelled history and no planner/tools/RAG. Four controlled cases covered scope with an absent image, Yemeni correction of body target and fragrance constraint, scalp/tips/face separation, and second-container reference with retained fragrance-free preference. They were development cases; independent final holdout was not used. The cached binary was expressly not current APK JNI or Samsung evidence.

| Conversation-reported case |2B summary only |4B-Instruct-2507 summary only |
| --- | --- | --- |
| Scope and absent-image limits | Repetitive capability promises in a text-only setting; answer reportedly reached its token cap. | Reportedly explained text-only/image limitations more appropriately and completed. |
| Body→face and fragrance-constraint correction | Reportedly retained body-only and fragrance-free despite both explicit corrections. | Reportedly changed the target to face, but retained fragrance-free wording while also saying fragrance was allowed; an internal correction/constraint contradiction remained. |
| Oily scalp / dry tips / separate face | Reportedly asserted oily face despite explicit denial and asked a vague question. | Reportedly preserved the broad scalp/tips distinction better, but introduced unreported traits and multiple/redundant questions. |
| Second-container reference and uncertainty | Reportedly gave a generic unknown-ingredients response, omitting the referent and fragrance conflict. | Reportedly refused guaranteed safety more directly, but still omitted the second-container/fragrance conflict. |

The preceding conversation reports critical semantic failures and **no model promotion**. The owner's80/100 plus zero-critical-failure condition was not relaxed. Numerical case scores are deliberately not reconstructed here because the scored artifacts are absent. Neither the reported relative improvement nor any reported completed short answer is a scientific/Android acceptance result. Keep status `RECORDED_CONVERSATION_SUMMARY_NOT_RAW_EVIDENCE` until an actual original saved artifact is recovered.

The restored V7.6 run.py is also not identical to the conversation-reported successful preparation: it currently uses Jinja `StrictUndefined` although the official template tests an optional tool_calls field. The preceding conversation reports correcting optional-field handling before actual inference. That later edit did not survive remotely. No script was executed or silently repaired during this recovery. The script's mere presence cannot prove or disprove the separately recorded execution.

## One concrete unexecuted implementation boundary

**Separate user-reported conversation facts from scientific evidence authority, with a typed response path for acknowledging those facts.** This is a source-demonstrable contract gap, not a proven explanation for the raw model failures above. The raw Layer A calls did not use these application contracts, so changing the contracts alone cannot be claimed to fix their Arabic understanding.

Current source evidence:

- `server/src/intelligence/contracts.ts` stores skin/hair/concerns/constraints as broad arrays. It has no first-class subject-scoped user assertion, polarity, source turn/span or anonymous product-mention identity.
- Targeted update_fields/clear_fields and `memory-update.ts` already exist. Do not rebuild that completed field-preservation work. They do not by themselves distinguish oily scalp from dry tips or face from body, and fragrance permission is represented mostly by the absence of an avoidance enum.
- `retrieve_conversation_context` in `tools.ts` returns memory in **notes**, not typed citable user facts.
- In `validateDecision`, every non-clarification response segment must cite observed claim_ids; capability segments additionally require system-topic facts. There is no explicit user-context response kind with a separate user-fact authority. Scientific claim IDs must not be invented to acknowledge what the staff member said.

Suggested smallest implementation slice, only after root assigns it:

1. Define a bounded **user-assertion contract** distinct from EvidenceFact: stable session/turn reference, original source span, subject/entity reference, reported attribute/value, asserted/negated status and supersession. Preserve original turns. Do not convert user claims into scientific evidence or create global catalogue records from anonymous mentions.
2. Add a separate conversational response kind that cites observed user-assertion IDs and is authorized only to acknowledge, compare or clarify the user's reported context. It cannot justify efficacy, ingredients, safety, local availability, diagnosis or a product recommendation. Existing scientific evidence/claim validation remains mandatory for those conclusions.
3. At the existing request/decision/persistence seam, validate ownership, source-role and source-span bounds; reject dangling/cross-session references and retain clear unknown/conflict states. A quoted span proves provenance, **not** that a model's polarity/subject interpretation is correct. Do not certify semantic comprehension from successful parsing or span checks.
4. Introduce this additively behind an explicit versioned contract or guarded route, retaining legacy records and existing targeted field updates. Review compatibility with the persisted saved-conversation schema before writing a migration. No automatic memory replacement, hidden fallback, raw-output passthrough or hardcoded case answer.

Falsifiable implementation verification would exercise the contract's actual invariant boundaries: user-context acknowledgement without scientific citations must have valid user-fact references; user testimony must never satisfy scientific recommendation evidence; anonymous first/second mentions must not become inventory IDs; subject-scoped conflicting assertions must remain distinct; superseding one scoped preference must preserve unrelated facts; cross-account/session references must fail. These would be software-contract tests, not claims of model intelligence. Any eventual semantic quality test must use a newly authorized independent protocol, not repeat the completed frozen raw/planner/sampling controls to regain missing files.

This boundary is ready for a small implementation assignment. No additional model search, download, broad study, benchmark rerun or model promotion is needed to implement and verify its authority/provenance invariants. Actual comprehension, scientific reasoning and Samsung acceptance remain separate requirements with their original gates intact.
