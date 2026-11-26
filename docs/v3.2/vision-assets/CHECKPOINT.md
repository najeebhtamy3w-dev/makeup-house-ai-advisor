# Optional vision projector asset checkpoint

State: IMPLEMENTED helper; Host Java boundary verification PASS. Android integration/build/device behavior requires the parent implementation and remains NOT TESTED here. Download success does not mean vision acceptance.

The helper manages only `noBackupFilesDir/local-ai/vision-projector.gguf` and `vision-projector.part`. It never replaces or removes `approved.gguf`, product databases or images. The same pinned Qwen3.5-2B revision projector is optional: 668,227,264 bytes, SHA-256 `7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7`. The manifest is checked against fixed source code pins before network use. Source/license provenance is in native/vision-manifest.json and the sibling vision-probe evidence; original family Apache-2.0.

## Parent integration

- Copy `native/vision-manifest.json` to Android `assets/vision-manifest.json` during the existing assets build.
- Load the JSONObject and call `new VisionAsset(getContext(), manifest)` from the existing plugin. It does not perform authentication itself: the existing authenticated manager boundary must guard install/remove and diagnostics. All install/verify/remove/model calls must use the shared serial inference executor/busy lock.
- `status()` returns installed, verified, verified_sha256, downloaded, size, id and revision. `verified` means this helper process previously completed a full size/hash/GGUF check and metadata still matches, not runtime readiness. It intentionally does not report vision_ready.
- `verify(cancelAtomicBoolean)` returns a File only after full verification. Use that file for native projector loading, never a caller-provided path.
- `install(cancelAtomicBoolean, (phase,bytes,total)->...)` verifies an existing final file without redownloading. A corrupt existing file is preserved with an explicit error; remove only the optional projector before repair. A partial is resumed via validated HTTPS Range. A server ignoring Range restarts the partial safely. Redirects stay HTTPS and bounded; bytes and expected total are enforced. Final rename is atomic after verification; permissions owner-only.
- `cancel()` sets the active cancel flag and disconnects an active network connection. Connect/read timeouts are 20 seconds; verification checks cancellation per MiB. Native inference cancellation remains the parent runtime responsibility.
- `remove()` deletes only the projector and its partial. Unload an active projector in the shared serial runtime before calling it.

## Evidence

`python3 -m unittest discover -s tests -p test_vision_assets.py -v` compiles the actual Java helper with narrowly scoped Android/JSON API test stubs and executes 22 boundary checks: size/hash/GGUF, cancellation, exact Content-Range validation, malicious path rejection, immutable baseline weight preservation and independent cached REAL projector full hash/size/header verification. The stubs test asset logic, not Android behavior or a real HTTPS interruption/resume cycle. `integrity-tests.log` retains the raw output. This host has a JRE compiler module but no javac executable, so the test uses `java -m jdk.compiler/com.sun.tools.javac.Main`.

Open checks: Android compilation, permissions/atomic rename behavior on-device, actual download pause/resume/interruption, storage pressure, lifecycle, shared cancellation, model/projector compatibility during actual Android inference. No real product image was uploaded or processed by this helper, and no external image transmission is implemented.
