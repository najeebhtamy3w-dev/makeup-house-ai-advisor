# Incremental open-source selection — V3.2

This continues the V3.1 discovery, not a repeated greenfield search. Reuse baseline reports under docs/v3.1. No numerical weighted score is assigned to unmeasured criteria.

|Component|Evidence inspected|Decision|Limits|
|---|---|---|---|
|llama.cpp pinned b1b770d90d94cad9e9ea5b993bdbc383a522fb28|actual source/build, grammar sampling, native session, Android ARM64 compilation|RETAINED; task-specific strict GBNF added|Syntax is not reasoning/safety quality; CPU only, no GPU/NPU claim|
|Qwen3.5-2B Q4_K_M|trusted pinned manifest/size/SHA; actual recovered Host inference and raw JSONL|Reference model retained in engineering installer|Failed genuine completion in new development smoke; no production model acceptance|
|Qwen3.5-4B Q4_K_M|official card and separately pinned Hugging Face artifact metadata; new comparison pending|Research candidate only|No installer replacement or mobile resource claim without evidence|
|LiteRT-LM / FunctionGemma|official Android API and tool-use documentation|Not adopted at this checkpoint|No measured Arabic/scientific benefit justifies replacing functioning JNI/runtime; framework support alone is not model capability|
|Existing SQLite / BM25 / structured knowledge graph|actual app source, independent22-query retrieval experiment|RETAINED; graph bounded and evidence-linked|No embedding-based semantics claimed|
|Curated retrieval query expansion PoC|actual22-query development comparison|NOT integrated|Average topic recall improved but one case regressed; cross-domain false positives and weak postwash query persist|
|Local semantic embeddings / ONNX/alternative runtimes|considered as future gap-directed experiments|NOT implemented or benchmarked|No fabricated Android measurement, dependency or license adoption|

## Current primary sources

- https://github.com/ggml-org/llama.cpp (MIT; exact archive SHA verified by build pipeline).
- https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md (GBNF syntax/schema support; adopted code is pinned, not mutable master).
- https://huggingface.co/Qwen/Qwen3.5-2B and https://huggingface.co/Qwen/Qwen3.5-4B (original model identities/license).
- https://huggingface.co/unsloth/Qwen3.5-2B-GGUF and https://huggingface.co/unsloth/Qwen3.5-4B-GGUF (community conversion provenance, separate from original weights).
- https://developers.google.com/edge/litert-lm/android and https://github.com/google-ai-edge/LiteRT-LM (official alternative Android/tool APIs; documentation reviewed, no adoption claim).

Model2B manifest SHAaaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223 /1280835840B. Candidate4B SHA00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4 /2740937888B/revisione87f176479d0855a907a41277aca2f8ee7a09523. Never install partial/mismatched files. Research downloads are not employee auto-downloads. APK installer remains explicit manager-approved2B only.

Licenses/notices from existing V3.1 inventory remain binding. No model weights redistributed inside the APK/source ZIP. C++ session JSON uses the pinned upstream vendored nlohmann implementation, not a new unpinned package. npm audit is newly executed and raw output retained; it does not scan native code/model files or establish absence of vulnerabilities. Treat retrieved records as untrusted data; no external repository text can change tools, privileges or scientific authority.
