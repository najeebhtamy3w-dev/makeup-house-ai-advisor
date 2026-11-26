# V6.4 vision checkpoint — real Host evidence, NOT Samsung acceptance

Completed by vision_recovery:

- Recovered complete attempt-03 without repeating it or redownloading valid 2B/projector.
- Verified existing pinned projector metadata/hash record, original licenses, cached CLI build.
- Actual image-dependent Arabic generation on two distinctly labelled synthetic packages. Visible name/color changed with image; shape accuracy weak and CLI answers truncated. No real product catalogue or INCI accuracy claim.
- Added native/vision.hpp and native/vision.cpp, using existing llama model/context; strict serial ownership, header bounds before decode, lazy projector, CPU only, cancellation and cleanup.
- Strict C++17 compilation passed; image header bounds 8/8 passed.
- Actual wrapper two-image responses completed at EOS, 37/44 output tokens. Cancellation before work and during prefill passed; actual inference recovered after cancellation on same instances.
- Upstream raw-prompt helper logging disabled. No image upload, automatic identity approval, product writes, or science endorsement.
- Vendor license notices collected from pinned source for APK redistribution.

Files owned: native/vision.hpp, native/vision.cpp, scripts/vision-probe-*.py/cpp, docs/v3.2/vision-probe/ text evidence. Binary synthetic PNG files are reproducible from exact .base64 representations; do not send PNG through text-only connector create_tree.

Root must integrate CMake/runtime/JNI/Java/projector management/UI, build Android, verify all libs and asset hashes, and perform actual device workflow acceptance. Root owns shared files and may already have started this work independently. This checkpoint does not certify that shared integration or final APK.

Boundary test: compile scripts/vision-probe-boundaries.cpp with native/vision.cpp and pinned mtmd/llama libraries, then pass fixture-A.png and fixture-B.png. Smoke/cancellation harness: scripts/vision-probe-wrapper.cpp, args MODEL PROJECTOR IMAGE_A IMAGE_B. Link flags: -lmtmd -lllama -lggml -lggml-base. Use a new evidence folder for any future run; never overwrite failed attempts.

Next action: integrate optional native visual description through same serial runtime, mark output validated:false, keep review mandatory and fallback explicit; then test actual Android image-to-review-to-confirmed-product path. GATE 04 remains PARTIAL/NOT TESTED, not PASS.
