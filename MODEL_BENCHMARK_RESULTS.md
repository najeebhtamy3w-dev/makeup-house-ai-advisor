# Measured model state

The verified Qwen3.5-2B Q4_K_M baseline remains unchanged. Isolated Qwen3.5-4B and Phi-4-mini tests did not establish sufficient quality advantage to promote either model. All three produced actual Arabic text on Host; the hair question exposed length/repetition or comprehension defects. One 4B main-UI capability answer was grounded, but that single case is not broad acceptance.

Observed Linux peak VmHWM was about 1.83 GiB for 2B, 4.09 GiB for 4B and 4.11 GiB for Phi. These are process measurements, not Android PSS, battery or thermal results. Concurrent engineering activity makes exploratory latencies unsuitable as a controlled mobile ranking.

An isolated 207-token Arabic planner prompt reduced input and TTFT but all six paired constrained plans still chose clarification, with additional correction errors. It was not adopted. The final acceptance holdout has not been used for prompt/model selection. No aggregate intelligence score or Samsung benchmark is claimed.

Detailed inputs, failures, metrics, model hashes, licenses and correct templates are preserved in docs/v3.2/native-execution-evidence, native-phi-evidence and native-planner-concise-evidence.


## V6.9 new Qwen3-4B-Instruct-2507 candidate
Verified Q4_K_M artifact2497281120 bytes, SHA3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597. Original revisioncdbee75f17c01a7cc42f958dc650907174af0554, GGUF revisiona06e946bb6b655725eafa393f4a9745d460374c9. Official nonthinking template inspected; baseline prompt's closed-thinking assistant prefix removed for this candidate only.
Three frozen development planning cases completed on Host CPU, not Android. On the shared reference fields, baseline and candidate both satisfy all checks in only1/3 cases. This metric is weak: the follow-up answer repeats the already answered question, so it does NOT pass conversational acceptance. Candidate improves correction=true in the mixed-skin case but still misses concerns and skin state; capability question is misrouted. No promotion.
Candidate load5858ms, reported first-token19010–21435ms, total request generation42899–64260ms; approximate decode7.5–7.9 tokens/s after TTFT. Peak VmHWM4841120KB (~4.62GiB). Timing is exploratory under concurrent engineering work, not a controlled phone ranking. Thermal, battery, Android ARM64 execution, full scientific reasoning and multi-agent coordination NOT TESTED. Raw diagnostic boundary controls are separate from validated consultation and are not model acceptance.
Multilingual E5-small experiments: Q8 cross-language0/4, alternativeF16 cross-language1/4; F16 same-language4/4 on only4 exploratory cases. No broad multilingual retrieval acceptance or Android integration. Preserve all failures, conversion metadata and source licenses.

Raw diagnostic boundary control completed2/2 on the new candidate, with no grammar/tool/RAG pipeline. Scope answer responded to capabilities, and the follow-up recognized sudden onset, unlike constrained plans. These differ in system prompt and input length as well as grammar: they DO NOT isolate a proven grammar bug. Raw hair output included unverified causal/medical claims and is not an approved consultation. This supports investigating the planning/validation burden, without bypassing safety or adopting the candidate.


## V6.9 continuation — native completion and repeated clarification
Source targets dev.5/code10. Previous dev.4/code9 Android run45936337100 PASS, artifact15170976997 verified and delivered separately. Dev.4 Debug certificate differs from dev.3; no compatible update or data transfer is claimed. Production signing remains DEFERRED BY OWNER.
Added exact normalized pending-question repeat rejection across plan/decision/segments, bounded repair then explicit fallback. Native metrics/model identity now travel from actual Java bridge into consultation diagnostics; telemetry is explicitly reported, not independent attestation or semantic acceptance. Length/cancel/error/zero-token completions cannot silently become final generated answers.
288/288 software tests PASS, typecheck and mobile asset build PASS. Two initial old synthetic tests reused the same fixed clarification to set up unrelated revision/correction checks; their setup now uses distinct questions while preserving all ownership, stale-revision, context and redaction assertions. Failure log retained. New repeated-question regression remains strict. Actual Host main UI regression is being recorded; Samsung execution remains NOT TESTED.
The isolated two-stage paraphrase experiment did not improve shared acceptance (1/3 weak plan checks, same as baseline), introduced incorrect paraphrases and repeated questions; NOT ADOPTED. Original questions/history and all raw failures remain retained.


## V7.0 active checkpoint — 2026-11-27
Authoritative current incremental recovery: `docs/v3.2/v70-checkpoint/checkpoint.json`; fresh logs alongside it. Recovered remote HEAD b160e3e28547eb742ad20ad18d655c142a21dbfd; no prior local modifications overwritten. Dev.5 run45939536985 verified success through GitHub jobs and artifact metadata; no rebuild of unchanged dev.5.
Implemented targeted update_fields/clear_fields across model contract, native grammar and memory application. Legacy correction preserves unrelated nonempty context; erasure requires explicit field. Rejected plans restore context and usable observations before repair, while tool execution audit and budgets remain retained. Public multi-turn/archive recovery and rejected-plan regression pass.
Scientific quarantine now propagates across valid normalized DOI/PMID identity links, preserves warning source URLs and human-reviewed knowledge. Four missing behaviors reproduced before fix.
302/302 software tests, typecheck and mobile assets PASS. These are not real-model quality acceptance. Exact-input grammar controls in docs/v3.2/v70-grammar-control show removing grammar alone does NOT fix omission/repetition and weakens schema/policy. Uses recovered older Host binary, clearly labeled; holdout untouched. Gate02 remains FAIL, scientific/multimodal gates retain prior partial/unverified states, Samsung NOT TESTED. Baseline model unchanged.
Source targets dev.6/code11; APK not built at this checkpoint. Production signing remains deferred. Next: finish fresh Native build/current-source inference, publish verified source, inspect CI and deliver actual APK, then continue independent semantic and scientific work.
