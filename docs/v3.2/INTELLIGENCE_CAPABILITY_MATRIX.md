# Capability matrix

|Capability|V3.1 baseline|V3.2 actual|Evidence/status|Remaining gate|
|---|---|---|---|---|
|Native generation|real2B composition|real native plan/decision tasks and strict GBNF|IMPLEMENTED; recovered host run pending|Fresh inference acceptance|
|Intent/planning|deterministic selection|model-owned structured plan before ordinary answer|IMPLEMENTED; schema/API tests PASSED|NLU metrics and qualified Arabic review|
|Tools|fixed retrieval|bounded model-selected read-only dispatcher|IMPLEMENTED; permissions/budgets PASSED|Correct tool selection benchmark|
|Scientific grounding|existing claim fidelity|observed IDs, suitability, function/order and fidelity checks|IMPLEMENTED; malicious IDs rejected in tests|Independent scientific semantic acceptance|
|Multi-step reasoning|mostly composition|structured decisions with conditional multi-premise explanations|PARTIAL; completion not established|Real generative completion and ablation benefit|
|Arabic/Yemeni|limited prior samples|model-driven slots/clarification, no language-quality claim|PARTIAL; historical samples mixed|Qualified review and heldout metrics|
|Memory|existing limited context|persistent bounded slots/product references/revision CAS|IMPLEMENTED; correction/isolation/replay tests PASSED|Long real-model conversations|
|Retrieval|lexical/structured|model queries+BM25+bounded graph|IMPLEMENTED|Independent retrieval relevance measurements; no embeddings claimed|
|Global catalog|limited product knowledge|separate reviewed manufacturer-information records|IMPLEMENTED;3 focused tests PASSED|Real verified catalog population|
|Local availability|legacy flag|strict reviewed-active positive unexpired batches|IMPLEMENTED; inventory tests PASSED|Physical shop data and legacy UI reconciliation|
|Knowledge enrichment|74 pending claims|4 optional original summaries pending human review|IMPLEMENTED draft ingestion|Qualified review; broader ingredient coverage|
|Safety|independent rules|precheck, protected referrals, postcheck and fallback|IMPLEMENTED; governance tests PASSED|Full adversarial scientific acceptance|
|Backup/data scale|existing MHBAK1/2|additive tables, no model weights in ordinary DB backup|PARTIAL; scale test in progress|New/old restore and Android worker acceptance|
|Android APK|V3.1 APK reported|V3.2 engineering build in progress|NOT TESTED until artifact verified|Manifest/native/signature checks|
|Samsung/offline/thermals|not tested|not tested|NOT TESTED|Owner physical device|
|Permanent release signing|owner key retained|owner key unavailable here|BLOCKED|Secure owner signing, no substitute key|
