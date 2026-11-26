# Native execution checkpoint — 2026-11-26

Work in progress; not a release acceptance report.

- Existing source reused: llama.cpp b1b770d90d94cad9e9ea5b993bdbc383a522fb28, archive SHA256 ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4 verified again.
- The execution workspace had no cached model/native build/CMake/Ninja after reset. Restored only missing isolated tools outside the application: CMake3.31.6, Ninja1.11.1.4 under `../toolchain/native-recovery/python`; C++ compiler already installed.
- Verified Qwen3.5-2B Q4_K_M:1,280,835,840 bytes; SHA256 aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223. File `../toolchain/native-recovery/qwen35-2b.gguf`.
- Host Release build succeeded: `../toolchain/native-recovery/host/mh-ai-session`, `mh-ai-poc`, `mh-ai-test`. This is NOT Android compilation or physical execution.
- Actual raw diagnostic probe running via `scripts/native-execution-probe.py`; outputs saved incrementally in `docs/v3.2/native-execution-evidence/2b-raw-20261126/`. No final holdout opened.
- Qwen3.5-4B comparative download COMPLETED and size/SHA VERIFIED outside app, pinned version e87f176479d0855a907a41277aca2f8ee7a09523. Use `../toolchain/native-recovery/qwen35-4b.gguf`; do not re-download. Expected2,740,937,888 bytes, SHA256 00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4.

## Implemented, pending integrated acceptance

- Native typed product/claim ID allowlists, max50 each, no arbitrary grammar supplied by caller. Empty allowlists force empty product/claim references; independent application verification remains required.
-13 standalone native constraint security checks PASSED, no model needed; `native/constraints_test.cpp`.
- Native grammar accepts new capabilities intent, scientific_specialist/get_system_capabilities tools and optional response_segments contract.
- Manager-only `diagnose({token,prompt,max_tokens<=256})`: actual raw local model without plan/decision/RAG/validator/fallback. Response explicitly `RAW_NATIVE_DIAGNOSTIC_NOT_CONSULTATION` and `validated:false`. Employee `generate` still rejects diagnostic task.
- Native diagnostic metrics: input/output tokens, TTFT, generation/model-load ms, finish_reason. UI/library must not present this raw output as validated consultation.
- Status now distinguishes actual installed/loaded/active and verified hash cached only after a real hash check. ABI is a JSON array. On process restart verified=false means not yet verified in this process, not proof of corruption; no automatic model download/replacement.

## Rebuild / next step

```bash
PYTHONPATH=../toolchain/native-recovery/python ../toolchain/native-recovery/python/bin/cmake -S native -B ../toolchain/native-recovery/host -DLLAMA_SOURCE_DIR="$PWD/../toolchain/native-recovery/llama" -DCMAKE_BUILD_TYPE=Release -DGGML_AVX2=ON -DGGML_FMA=ON
PYTHONPATH=../toolchain/native-recovery/python ../toolchain/native-recovery/python/bin/cmake --build ../toolchain/native-recovery/host -j3
```

Check real raw output and constraint-probe JSON; then parent runs the main-advisor real model integration harness. Compilation and nonempty text are not scientific/Arabic/device acceptance. Physical Samsung new version NOT TESTED. Owner-provided earlier diagnostics must remain REPORTED owner observations and must not be represented as tests of this source.

## Final component checkpoint

See `native-execution-REPORT_AR.md`: actual raw Arabic2B/4B evidence, baseline2B lifecycle11/11, pure guards13/13, failed whitespace-loop Raw preserved and bounded-whitespace correction verified against both models. No model upgrade authorized by measurement; no qualified Arabic/scientific acceptance or Samsung measurements claimed. Parent integrates UI/worker and Android build.

## Required-tools schema follow-up

- Root actual main UI2B failed plan_has_no_tools twice; failure retained by parent.
- Native grammar now mirrors existing Zod plan invariant: work intents>=1tool, clarify/out_of_scope0allowed. Toolchoice remains model-owned.
- Exact development failure replay selected get_system_capabilities correctly; raw metadata saved under native-execution-evidence/2b-required-tools-replay. This does not claim final decision/UI completion.
- Empty-ID structured-field negative regression passed again; free text requires independentvalidation.
- Rebuilt Host successfully. Android JNI additionally guards failed typed-array allocation. No commit/push by this agent.
