# Signing and engineering artifacts — VERIFIED 2026-11-26

Engineering version3.2.0-dev.1/code6. Latest known source baseline3.1.0-rc.1/code5; independently inspected historical signed APK3.0.0/code4. No claim about unknown privately distributed versions. Production approval withheld.

|Artifact|Identity|Signature|SHA256|
|---|---|---|---|
|MAKEUP_HOUSE_ADVISOR_3.2.0_DEV1_UNSIGNED_ENGINEERING.apk|com.makeuphouse.advisor;3.2.0-dev.1;code6;debuggable=false|UNSIGNED; not directly installable|5ac64e08967879aa5baac8da1287b4ab2b00a8a1050957fbfebe43538f2dc0ae|
|MAKEUP_HOUSE_ADVISOR_3.2.0_DEV1_DEBUG_TEST_ONLY.apk|com.makeuphouse.advisor.engineering;3.2.0-dev.1-test;code6|Debug test certificate; isolated app|c85e1c055c8d1106018edbdf235a468b473a94897b0041a9a6176a597ca42001|

Both APKs actually built; ARM64 native runtime packaged, ELF LOAD alignment0x4000 and ZIP16KiB verification PASSED. All39 embedded app assets match frozen source bytes.201app source file hashes recorded. Build and inspection raw output is retained under evidence/recovery-2026-11-26. No physical Android execution claim. These are engineering test artifacts, not an accepted generative intelligence release.

## Historical permanent certificate — independently reverified

Retrieved owner historical signed APK has SHA2569ce93846d79f354374e6d8cd7f69c49f1d3aa351c251cf01676ba36656eaa358; verified v2/v3 signatures and certificateSHA256b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386 match handover. Public certificate verification does not provide the private signing key. No replacement permanent key created. Debug certificateSHA2561cfb4e89d9a40ff46fc260c9411e06e5dc2e756b9708e97ef09f6933fb06e6e6 is deliberately different and only signs the isolated test application.

## Owner-controlled signing later

On the owner's own computer with Android Build Tools and existing keystore:

```sh
scripts/sign-release.sh MAKEUP_HOUSE_ADVISOR_3.2.0_DEV1_UNSIGNED_ENGINEERING.apk /secure/path/makeuphouse-release.jks makeuphouse
```

The script prompts locally, aligns before signing, verifies the exact permanent certificate, refuses mismatched keys and existing output, and prints the real APK version/hash. Never paste passwords/private keys into chat or commit keystore files. Do not uninstall the permanent app to bypass mismatch. Permanent-signed install/update/data continuity must be tested on a controlled device with a verified encrypted backup. The isolated Debug can coexist and cannot update the permanent app.

Signing a candidate does not grant production approval. Model intelligence acceptance, qualified scientific/Arabic review and Samsung tests remain required.

## V6.4 recovery — supersedes current-state assumptions above

The dev.1 table is historical only. Verified OCR dev.2 source899df0253dabe0e023ac661386cb80d387973441/run45831293938 produced Debug certificate8d511afe34f1a3e7d7b9662432087c90773b51b79ba188aad0029645669a14b9; it is not the permanent certificate and may differ from another engineering build. The installed phone package/certificate is UNKNOWN until extracted or otherwise verified. Owner reports two JKS copies, not yet inspected here. Secure owner-signing workflow, fixed-certificate preflight and local comparison tools are implemented; see OWNER_SIGNING_RECOVERY_AR.md. Actual owner signing and device update remain BLOCKED/NOT TESTED. New dev.3/code8 source917d85c96488512681c1100c8af4eb78133e8391 is being built after JNI repair and the scientific negation guard. Use the actual artifact manifest for its eventual hashes; never reuse the historical APK hashes as current results.
