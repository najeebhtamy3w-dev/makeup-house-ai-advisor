# Isolated VLM probe / integration boundary

This folder is a bounded development experiment, not Android integration or acceptance. It does not modify app/runtime/Gradle/UI or switch its model. No private product images leave the machine. Test packaging is synthetic and labelled as such; it is not catalogue knowledge or evidence of real product recognition.

## Verified assets

The current 2B text GGUF can remain installed. The SAME pinned Unsloth repository revision contains a separate `mmproj-F16.gguf` (668,227,264 bytes). Its complete download was independently checked against HF LFS content hash `7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7`. See projector-manifest.json. Original Qwen model and Unsloth card declare Apache-2.0. Upstream llama.cpp is MIT. License texts accompany this experiment; third-party notices from the pinned source must remain in distributed builds.

## Exact upstream components

Pinned source: ggml-org/llama.cpp commit `b1b770d90d94cad9e9ea5b993bdbc383a522fb28` already cached and used by project.

- `tools/mtmd/mtmd.h`: `mtmd_init_from_file`, `mtmd_support_vision`, `mtmd_tokenize`, `mtmd_free`, bitmap/chunk ownership.
- `tools/mtmd/mtmd-helper.h`: `mtmd_helper_bitmap_init_from_buf`, `mtmd_helper_eval_chunks`; decode actual image embeddings into the existing llama context.
- `tools/mtmd/mtmd-image.cpp` and `models/qwen2vl.cpp`, `models/qwen3vl.cpp`: model-specific resize/embedding pipeline chosen from projector metadata. Do not manually guess image token layout.
- `tools/mtmd/mtmd-cli.cpp`: upstream experimental Host test harness, explicitly not production ready.
- `tools/mtmd/CMakeLists.txt`: standalone `mtmd` target linking existing llama/ggml and vendor hash/miniaudio/stb/sheredom; root CMake supports `LLAMA_BUILD_MTMD=ON` with tools/common off.

## Required Android work before advertising vision

1. Extend native asset manifest/downloader to verify, retain, activate and remove the projector independently; preserve valid existing text weights. Never infer visual readiness from a text GGUF or camera button.
2. Link standalone mtmd into the ARM64 JNI library, retain dependency notices, verify every shipped ELF and APK 16KB alignment and actual device compatibility.
3. Add a serial authenticated image-generation bridge using the already loaded language model; image bytes remain local. Validate image magic, byte count, dimensions and allocation limits before decoding. Clamp image tokens/context/output to tested bounds.
4. Create/free vision context and bitmap/chunks on success, failure and cancellation; reuse one language model, not two simultaneous LLMs. Abort callback, app lifecycle and memory-pressure tests must cover the encoder as well as decoder.
5. Treat visible text and visual guesses as untrusted provisional data with provenance/confidence, not approved product identity, ingredients or scientific claims. Feed draft review + identity tools; require manager confirmation before saving.
6. Validate unclear images, conflicting variants, image prompt injection, INCI fidelity, barcode handoff, wrong-product abstention and real packaging before Gate04. OCR reading and VLM scene understanding are separate capabilities.

## Reproduction

Build only the upstream experimental `llama-mtmd-cli` in an isolated build tree from the cached pinned source. Configuration/build commands are retained in logs and probe report. `scripts/vision-probe-fixtures.py` recreates the two synthetic images and their SHA-256. `scripts/vision-probe-run.py` verifies both model files, runs real image inference sequentially with bounded tokens/time, and records raw stdout/stderr/RSS. It refuses to overwrite an existing attempt directory; set MH_VISION_ATTEMPT to a new name for every attempt.

No matched Samsung latency, thermal, battery or scientific/product accuracy score can be inferred from this Host experiment. Concurrent compilation/other tests may affect Host latency.

## Implemented wrapper API and exact root integration (V6.4)

`native/vision.hpp/cpp` now compile against the pinned libmtmd. `LocalVision::load(projector_path, llama_model*, cancelled)` lazily loads the verified projector. `generate(llama_context*, llama_model*, encoded_bytes, size, question, limit, cancelled, optional_progress)` returns `VisionResult`. Calls must use the EXISTING text runtime serial executor and shared cancellation atomic. The wrapper clears its llama KV/recurrent memory on entry and all exits; memory is external persistent knowledge, not model cache.

Required shared edits (owned by root):

1. Before upstream `add_subdirectory`, CMake `set(LLAMA_BUILD_MTMD ON CACHE BOOL "" FORCE)` and `set(MTMD_VIDEO OFF CACHE BOOL "" FORCE)`; retain `LLAMA_BUILD_COMMON/TOOLS OFF` and CPU baseline. Add vision.cpp to mh_runtime and link `mtmd` alongside llama. libmtmd propagates its headers/link dependencies; if needed include `${LLAMA_SOURCE_DIR}/tools/mtmd` explicitly.
2. `runtime.hpp` include vision.hpp and own LocalVision member. runtime unload MUST call vision.unload BEFORE freeing llama context/model. Runtime wrappers pass the existing model/context; never create a second language model for image intake.
3. Existing LocalAI native bridge calls these runtime methods under SAME Java busy/serial executor; authorize roles independently, validate Base64 and image limits, lazily verify/download optional pinned Projector, set native_started only when actual native invocation begins. Generation errors must be explicit and cancelable.
4. Do not call image analysis scientifically verified. Return `validated:false`, `vision:true`, `ocr:false`, actual model/projector IDs/hashes and token/TTFT/finish metrics. No automatic product writes. Separate OCR candidates from model visual descriptions; both need employee review before product drafts.
5. Copy `THIRD_PARTY_NOTICES.txt`, `LLAMA-LICENSE.txt` and model license into APK assets/notice display via root's build preparation; do not include the private image in logs. Optional projector weights stay app private and out of source/backup ZIP.

Standalone smoke harness: scripts/vision-probe-wrapper.cpp. Header boundary harness: scripts/vision-probe-boundaries.cpp. Both are development tools, not fixtures for a fabricated product catalogue. Link example uses `-lmtmd -lllama -lggml -lggml-base` with pinned library folder and headers. CMake targets can be registered by root; no root build file was edited by this agent.
