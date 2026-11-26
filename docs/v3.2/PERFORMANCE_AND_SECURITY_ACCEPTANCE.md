# Performance and security acceptance

## Evidence boundary

Actual Host2B development consultation:168484ms end-to-end,3 native generations. These are not phone timings. See raw native responses for exact per-call durations/token counts; do not derive tokens/sec from the whole multi-tool elapsed time. Genuine completion FAILED and deterministic fallback was used because the model invented an unobserved product. The original diagnostic double-counted model submissions as6; raw native responses/runner counted3 correctly. Counter fixed with explicit one/two-call regression tests, raw evidence retained unchanged. No phone performance numbers exist.

Current installer2B/CPU/context4096 is an engineering baseline, not a target-device approved configuration. No hardware acceleration adopted. Android manager diagnostics expose actual device model/hardware/SoC(SDK31+), process PSS/native heap and system memory when requested; those fields must be read on the real device before performance acceptance.

## Proposed physical acceptance thresholds — before physical final evaluation

Simple consultation end-to-end<=120s; complex bounded consultation<=180s; model loading<=20s; time to first generated token<=10s; cancellation acknowledged<=3s; UI remains usable throughout; measured process peak PSS<=4GiB with no low-memory kill;20 repeated consultations/30-minute session without crash, corrupt state or uncontrolled growth. Thermal/battery observations must be exported for the actual chipset and reviewed before approval; no unmeasured numeric power claim. These are engineering gates, not achieved results. Do not adjust them to conceal failures. The new Host simple case exceeds120s but is not a physical phone measurement.

## Newly exercised controls

Session ownership/replay/revision conflicts, role restrictions, strict input schemas, no arbitrary tools/SQL/system writes, draft exclusion, unsupported product IDs, bounded retries/tools, deterministic safety bypass, fallback provenance, valid-batch availability, full API envelope and existing fallback context preservation. New records use additive migrations and encrypted backup compatibility. Manager-only native diagnostics; no customer raw messages in new diagnostic rows. Trusted hashes and app-private model paths restrict installation to approved artifacts. No new mandatory external inference.

npm audit reports0 known advisories across scanned npm dependencies at this run. This is NOT a native/model vulnerability assessment or proof of security. Scientific semantic validation remains heuristic and incomplete; qualified review and broad adversarial heldout evaluation are outstanding. Current model semantic failures prevent production release despite passing software tests.
