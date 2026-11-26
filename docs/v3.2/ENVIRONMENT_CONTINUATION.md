# Environment recovery — 2026-11-26

## Status and interruption boundary

The transient workspace containing the native build, installed SDK, downloaded model and pending Android build was reset. The repository checkpoint was recovered separately. No APK from that build was verified, copied or delivered before the reset. Do not treat its expected output filenames as existing delivery artifacts.

The last observed Android log reached `:app:mergeReleaseNativeLibs` after successful ARM64 CMake Release compilation. Gradle had proceeded into Android resources and plugin tasks. Final `BUILD SUCCESSFUL`, Java compilation completion, APK packaging, signature inspection and alignment verification were **NOT VERIFIED**. The subsequent attempt to poll the running build was blocked by an automatic approval review usage-limit failure; the build outcome remained unknown. After the environment reset the process and outputs no longer exist.

## Previously reproduced evidence

- Host native lifecycle: **PASSED 11 real checks**, Qwen3.5-2B, SHA256 `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`, 1,280,835,840 bytes. These checks predate the subsequent strict plan/decision grammar update. The persisted raw log, where present, is historical execution evidence, not evidence of a currently available executable or model.
- **VERIFIED** executable tools: JDK/Javac21.0.13.1+2, Gradle8.14.3, compile/target SDK36, Build Tools36.0.0, NDK28.2.13676358/Clang19.0.1, CMake3.22.1, Ninja1.10.2, ADB37.0.3.
- `zipalign` actual ZIP align and check both exited0. Its unsupported `-h` flag exits2 and is not a provisioning failure.
- No Android emulator, Samsung device, permanent signing or update installation was tested.

## Reprovisioning

Run `bash scripts/provision-v32-toolchain.sh --install /absolute/path/toolchain` only when the engineering lead authorizes rebuilding the toolchain. Default invocation prints usage and downloads nothing. The script verifies fixed archive SHA256 values before extraction and uses system TLS trust; it does not disable certificate checks. An unavailable pinned JDK URL or checksum mismatch must fail closed. Obtain a newly verified official source rather than substituting an unchecked archive.

The script requires Python3.12+ (`tarfile` data extraction filter), curl, standard Linux utilities, approximately multiple GB of network/storage and permission to accept Android SDK development licenses. Android SDK packages are requested by pinned package IDs except `platform-tools`, for which sdkmanager resolves the current revision; record its actual installed version after each provision. Do not describe that package as reproducibly revision-pinned.

Downloads and installed tools stay outside the source repository. No model weights or signing secrets are downloaded by this script. Model recovery remains a separate verified task.

## Secure build invocation after web source freeze

1. Finish web/worker changes, run typecheck and tests, and execute the existing `npm run android:sync` in the repository. Verify `Sync finished` in its log.
2. Set `JAVA_HOME=<toolchain>/jdk-21.0.13.1+2`, `ANDROID_HOME=<toolchain>/android-sdk`, `ANDROID_SDK_ROOT=$ANDROID_HOME`, `MH_LLAMA_SOURCE_DIR=<verified llama.cpp source>`, and `CMAKE_BUILD_PARALLEL_LEVEL=2`.
3. Use Gradle8.14.3 from `<toolchain>/gradle-8.14.3/bin/gradle`, working directory `android`, with `--no-daemon --max-workers=2 --console=plain assembleRelease assembleDebug`.
4. In this managed environment, derive Java `https.proxyHost`/`https.proxyPort` and `http.proxyHost`/`http.proxyPort` from the **current process** `HTTPS_PROXY` using a URL parser. Do not print or persist credentials, nor reuse a previous execution's ephemeral proxy port. Use `-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts` for trusted system CAs. Pass Java proxy properties as structured subprocess arguments. Never disable TLS verification.
5. Verify actual APK application ID `com.makeuphouse.advisor`, versionCode6, versionName `3.2.0-dev.1`, release debuggable=false, ARM64 native `libmh_local_ai.so`, ZIP integrity, `zipalign -c -P 16 4`, and signature state with `apksigner verify --verbose --print-certs`.
6. Release must remain unsigned unless the existing owner-controlled key is securely available. A debug certificate is testing-only and cannot update the permanently signed app. Copy actual verified artifacts only; calculate SHA256 after the final frozen-source rebuild.

Native source pinned previously: llama.cpp `b1b770d90d94cad9e9ea5b993bdbc383a522fb28`; source tar SHA256 `ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4`. Confirm the checkout/archive against this pin before building. Prior host build directory was `<toolchain>/mh32-host` and must now be recreated.

## Next executable step

Persist this recovery script/document in the dedicated development checkpoint. Wait for the parent to authorize multi-GB reprovisioning; preserve no claim of built or delivered APKs from the lost attempt. Production approval remains blocked by intelligence acceptance, final build verification, permanent signing continuity, physical Samsung acceptance and qualified scientific/linguistic review.
