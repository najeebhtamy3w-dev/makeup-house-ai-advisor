# V7.0 exact-input grammar control — Host only

Recovered cached Qwen3.5-2B binary, four actual inference calls, two existing V6.9 development failures. Exact original prompts retained, same weights, greedy decoding and 256-token budgets. Only task switches between application plan grammar and no grammar (diagnostic). Metadata records hashes and older-binary limitation. This is neither current native runtime nor Android/Samsung acceptance. Final holdout was untouched.

| Input | Grammar enabled | Grammar disabled |
| --- | --- | --- |
| First hair-loss turn | Empty context, irrelevant generic clarification; 127 tokens, stop | Empty context, invalid intent/missing labels, prohibited budget questions; 256 tokens, length |
| Follow-up denying gradual onset | Empty context, same previous question; 134 tokens, stop | Empty context, same previous question, invalid missing labels and incomplete tool shape; 214 tokens, stop |

Both unconstrained calls still omit hair_loss and ignore the semantic update; removal of grammar does not repair these failures. The follow-up remains repetitive even when unconstrained. Grammar protects schema/policy but is not sufficient for comprehension. This experiment does not isolate prompt-language, enum/tool burden or model limitations from one another, and does not prove any of them individually. It rejects grammar removal alone as a demonstrated fix. No model promotion, scientific recommendation, conversational PASS or Android acceptance follows.

Preserved evidence: requests.jsonl, responses.jsonl, stderr.log, metadata.json. Replaying unchanged failed development cases is investigative evidence, not independent final acceptance. Timing is not a mobile ranking.
