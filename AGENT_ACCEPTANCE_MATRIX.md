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
