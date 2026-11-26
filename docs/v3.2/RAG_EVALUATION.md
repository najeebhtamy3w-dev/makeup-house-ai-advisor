# Local RAG development retrieval experiment

Status: **VERIFIED — measured on Linux Host; experimental expansion NOT integrated**. No model inference, embedding downloads, core retrieval edits, final holdout access or scientific approval occurred.

## Reproduction

`node --no-warnings --import tsx scripts/intelligence-retrieval-eval.ts`

The script opens a fresh in-memory database and runs the existing `seedKnowledge`; 32 sources, 26 topics, 74 usable claims and 12 ingredient entries. **Zero claims have qualified scientific review**. Usability includes pending curated seed claims under the existing policy, so retrieval success does not certify their scientific quality. No synthetic scientific claims or catalogue data are inserted.

## Dataset and metric

Twenty-two explicit development queries cover Arabic/Yemeni phrasing, compound concerns, ingredient aliases in Arabic/English, hair roots/ends, sun and routines. Reference topic IDs are declared directly in the script before execution and checked against actual seeded topic IDs. They are engineering topical labels, not blinded expert relevance judgments or reference medical answers. Dictionary and cases were authored together: results are exploratory and may be optimistically biased. No holdout was read, modified or evaluated.

Both variants call the same `retrieveKnowledgeGraph(db,{query,limit:6})`, without `topic_id` or `ingredient` hints. Baseline uses current JS BM25 and its existing token normalization/synonyms; experiment appends visible curated lexical aliases/phrases. No semantic embeddings, free-form NLU, knowledge graph traversal improvement, agent planning or generative reasoning is measured.

**Macro topic recall@6** is the mean per query of the number of reference topic IDs represented among the top six claims divided by the number of reference topic IDs. Any-topic hit and all-topics hit are query-level rates. Multiple claims from one topic count once. Top IDs, scores, trust labels, expanded strings and applied dictionary rule IDs are retained in `evidence/recovery-2026-11-26/retrieval/results.json`; dataset hash and exact cases are also retained. Precision, claim-level relevance, answer usefulness, safety, inference and phone performance are NOT TESTED.

| Metric | Current BM25 | Curated expansion |
|---|---:|---:|
| Macro topic recall@6 | 84.09% | 92.42% |
| Any reference topic@6 | 90.91% | 95.45% |
| All reference topics@6 | 77.27% | 90.91% |
| Empty result queries | 2 / 22 | 0 / 22 |

Four cases improved, one regressed, seventeen unchanged. Macro recall improved by 8.33 percentage points on this small development set. This is **not** an acceptance result, measured Arabic intelligence improvement, or evidence that keyword expansion solves the compound-consultation problem.

| Case | Declared relevant topics | Current recall | Expanded recall |
|---|---|---:|---:|
| mixed-face | oily_skin, dry_skin, combination_skin | 0.000 | 0.333 |
| wash-tight | dry_skin, moisturizer_basics | 0.500 | 0.000 |
| niacinamide-ar | niacinamide | 1.000 | 1.000 |
| niacinamide-en | niacinamide | 1.000 | 1.000 |
| niacinamide-variant | niacinamide | 0.000 | 1.000 |
| hair-mixed | oily_hair, dry_damaged_hair | 1.000 | 1.000 |
| hair-roots | oily_hair, dry_damaged_hair | 0.500 | 1.000 |
| sun | sun | 1.000 | 1.000 |
| sun-english | sun | 1.000 | 1.000 |
| glycerol | ing_glycerin | 1.000 | 1.000 |
| glycerin-ar | ing_glycerin | 1.000 | 1.000 |
| petroleum | ing_petrolatum | 1.000 | 1.000 |
| petrolatum-ar | ing_petrolatum | 1.000 | 1.000 |
| ceramide | ing_ceramides | 1.000 | 1.000 |
| b5 | ing_panthenol | 1.000 | 1.000 |
| hyaluronic | ing_hyaluronic | 1.000 | 1.000 |
| sensitive | sensitive_skin | 1.000 | 1.000 |
| acne-marks | pigmentation, acne | 0.500 | 1.000 |
| flakes | dandruff | 1.000 | 1.000 |
| hair-fall | hair_loss | 1.000 | 1.000 |
| routine | routine | 1.000 | 1.000 |
| urea | ing_urea | 1.000 | 1.000 |

## Failures and decision

- Face oil plus local flaking: baseline returned nothing. Expansion recovered only `combination_skin` of three reference topics and also returned hair topics. Empty-result recovery alone is insufficient.
- Post-wash tightness regressed from 0.5 to 0 topic recall: generic dry/oily additions crowded out `dry_skin` and failed to retrieve `moisturizer_basics`. This is an explicit counterexample to unconditional expansion.
- Existing aliases already retrieve glycerol, petrolatum, B5, ceramides and urea successfully; blanket replacement would add complexity without demonstrating benefit on these cases.
- Compound hair roots/ends improved on one phrasing but results still include unrelated topics. Topical recall hides these false positives.

**Decision:** retain the current production module unchanged. This prototype justifies a narrower follow-up: protect strong baseline hits, use ingredient exact-match metadata, distinguish skin/hair intent before contextual expansion, then compare with independently labeled development/validation relevance sets. Do not turn the hand-authored query dictionary into a claimed generative NLU capability. Root review is required before adopting an algorithm change.

Raw per-call host milliseconds are recorded only for reproducibility; baseline runs before expansion and includes cold index work, so they are not a fair performance comparison or mobile latency measurement.
