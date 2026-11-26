# V3.2 engineering architecture

## Actual implementation

The existing Capacitor/Java/JNI/C++/SQLite application remains. Ordinary offline Android consultations enter `/api/intelligence/start` before the deterministic answer composer. Independent safety prechecks run first. A native model generates a typed consultation plan (intent, slots, missing information, queries and read-only tool calls). The worker validates the plan, resolves only known product references, executes allowed tools, and asks the model for a structured decision. The model may request additional retrieval within a six-tool/four-inference budget. A single bounded repair is allowed. No hidden chain-of-thought is returned or persisted.

The deterministic engine remains the scientific calculation/knowledge authority and explicit failure path. It does not select an ordinary answer before the model planner. A model invocation is not counted as completed generative reasoning. Provenance separates `generative_first`, `generative_retry`, `clarification`, `evidence_selection`, `deterministic_fallback`, `policy_bypass`, and `safety_referral`. A conditional conclusion needs multiple cited premises as well as a chosen recommendation or multi-step routine to qualify under the current engineering completion definition. This definition is not a scientific certification.

## Independent enforcement

- Emergency input returns a deterministic referral without waiting for inference. Referral state survives follow-up turns until the consultation is reset.
- Native GBNF bounds and structures Plan/Decision. Worker Zod validation is independent of this syntax guarantee.
- Product/claim IDs must come from authoritative tool results, not model knowledge. Local availability is freshly computed from positive unexpired batches and reviewed active products. Global product IDs are negative and never imply local stock.
- Routine products must have compatible verified functional metadata; ordering, citations, contraindications and independently calculated suitability are checked. Missing function/evidence causes rejection, not an invented attribute.
- Generated explanations undergo the existing independent fidelity and prohibited-output checks. These checks are conservative heuristics, not a complete semantic proof. Qualified human scientific/language review remains mandatory.
- Tools cannot execute arbitrary SQL, shell commands, administrative writes or external inference. SQL values are bound. Retrieved text is serialized as untrusted data with chat delimiter escaping.

## Retrieval and knowledge

Tools combine structured metadata, indexed lexical BM25 and bounded graph traversal with model-chosen queries. No embedding model/vector search or knowledge graph inference engine has been adopted. The graph exposes ingredient/function/topic/claim/source relationships and explicitly flags associations lacking evidence. Baseline coverage is limited (74 claims,32 sources,26 topics,12 ingredients,13 unlinked relationships); pending-review records are not human-approved science. Four original Arabic source summaries can be ingested as pending review through a manager endpoint. Global catalog and local inventory are separate tables; no real catalog was fabricated.

## Conversation state and privacy

`intelligence_memory` stores bounded structured consultation state under existing session ownership and a revision CAS. Tickets are random, expire, belong to one user/session and are consumed once; stale concurrent turns fail. Product references preserve identity, and session deletion cascades to memory/diagnostics. Raw customer questions are not written into the new turn/diagnostic records. The current implementation is structured memory, not free-form cross-day autobiographical recall or a summarization model.

## Native/mobile execution

Pinned llama.cpp b1b770d90d94cad9e9ea5b993bdbc383a522fb28 supplies real CPU inference, JSON grammar sampling, cancellation/reset/unload and JNI. Plan/decision inputs are capped3072 tokens/output768 within4096 context; compose limits remain1536/384. Java runs work off the UI thread. The main-thread service orchestrates worker requests and native generation, buffers outputs until validation, and returns the full advisor API envelope. Model2B remains the approved manifest baseline;4B is a research candidate, not an installed or selected replacement. No mandatory remote AI or model weights are embedded in the APK.

## Acceptance boundary

Current software verification is separate from model intelligence evaluation. Historical failed2B/4B samples with lost raw logs are REPORTED, not fresh measurements. New evidence must include raw requests/responses, model/binary/source hashes and provenance. Final heldout inference is not run during development. Physical Samsung, permanent signature continuity, thermal/battery performance and qualified review remain outstanding.
