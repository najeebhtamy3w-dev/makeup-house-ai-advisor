# Independent functional acceptance — V6.9

These are functional role mappings, not sixteen accepted autonomous agents. A shared model drives constrained plans; registry names and unit tests do not establish intelligent reasoning. No role is granted PASS. Production signing is deferred.

| Role | Actual component/tools | State | Evidence / remaining limit |
|---|---|---|---|
| Skin Science | retrieve_scientific_evidence; skin specialist | PARTIAL | Structured local knowledge; generative clinical reasoning not accepted |
| Hair & Scalp | retrieve_scientific_evidence; hair specialist | PARTIAL | Safety/context regression tests; dialogue quality fails |
| INCI | analyze_ingredient_compatibility | PARTIAL | Known ingredients; unknowns stay uncertain |
| Formulation | formulation specialist | PARTIAL | Cannot infer undisclosed concentrations |
| Safety | protected referrals; independent validator | PARTIAL | Negation regression passed; no broad scientific review |
| Evidence & Citation | typed source IDs; evidence retrieval | PARTIAL | Provenance checks; entailment incomplete |
| Deep Research | runDeepResearch; /api/intelligence/research | PARTIAL | Bounded metadata from PubMed/Europe PMC; no paper synthesis |
| Global Product | search_global_products | PARTIAL | Catalogue distinct from shop; discovery incomplete |
| Comparison | compare_products | PARTIAL | Real stored product fields; broad model reasoning unaccepted |
| Routine | build_cosmetic_routine | PARTIAL | Tool connected; personalized reasoning not passed |
| Alternatives | find_global_alternatives | PARTIAL | No inferred local availability |
| Vision | native mtmd; optional projector | PARTIAL | Actual Host image inference; product/device accuracy unaccepted |
| Identity & Barcode | barcode lookup; OCR | PARTIAL | Saved exact matches; real package recognition not accepted |
| Inventory | check_local_availability; check_valid_batches | PARTIAL | Actual DB quantities and expiry; field acceptance pending |
| Memory & Context | saved-conversations; intelligence_memory | PARTIAL | Persistence/isolation software tests passed; model recall not accepted |
| Critical Review | claim/citation validation; safety guards | PARTIAL | Deterministic validation; full evidence conflict reasoning incomplete |

Evidence: tests/unified-core.test.ts, tests/saved-conversations.test.ts, tests/deep-research.test.ts, tests/research-tool-route.test.ts, docs/v3.2/v69-checkpoint/software-tests.log; previous raw native and vision evidence remains retained. These establish software behavior separately from model quality. Runtime, conversational, scientific and multimodal gates remain PARTIAL/FAIL as recorded in ACCEPTANCE_MATRIX.md.

V6.9 follow-up evidence: real main UI3 native calls/2 turns retained under docs/v3.2/v69-main-ui. Runtime telemetry and bounded repeat rejection work on Host; memory/context comprehension still fails. Do not upgrade any agent status from this boundary regression.


## V7.0 active checkpoint — 2026-11-27
Authoritative current incremental recovery: `docs/v3.2/v70-checkpoint/checkpoint.json`; fresh logs alongside it. Recovered remote HEAD b160e3e28547eb742ad20ad18d655c142a21dbfd; no prior local modifications overwritten. Dev.5 run45939536985 verified success through GitHub jobs and artifact metadata; no rebuild of unchanged dev.5.
Implemented targeted update_fields/clear_fields across model contract, native grammar and memory application. Legacy correction preserves unrelated nonempty context; erasure requires explicit field. Rejected plans restore context and usable observations before repair, while tool execution audit and budgets remain retained. Public multi-turn/archive recovery and rejected-plan regression pass.
Scientific quarantine now propagates across valid normalized DOI/PMID identity links, preserves warning source URLs and human-reviewed knowledge. Four missing behaviors reproduced before fix.
302/302 software tests, typecheck and mobile assets PASS. These are not real-model quality acceptance. Exact-input grammar controls in docs/v3.2/v70-grammar-control show removing grammar alone does NOT fix omission/repetition and weakens schema/policy. Uses recovered older Host binary, clearly labeled; holdout untouched. Gate02 remains FAIL, scientific/multimodal gates retain prior partial/unverified states, Samsung NOT TESTED. Baseline model unchanged.
Source targets dev.6/code11; APK not built at this checkpoint. Production signing remains deferred. Next: finish fresh Native build/current-source inference, publish verified source, inspect CI and deliver actual APK, then continue independent semantic and scientific work.
