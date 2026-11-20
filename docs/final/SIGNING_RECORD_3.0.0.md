# Signing Record — v3.0.0

Signed by the owner on the owner's own Android phone (Termux, `keytool` from OpenJDK 17, `apksigner` 0.9 / build-tools package 37.0.0).
The key was created on that phone. It never existed in the cloud session, and its password was never written in the conversation or to any file.

## Key

| Item | Value |
|---|---|
| Keystore | `makeuphouse-release.jks` (PKCS12), alias `makeuphouse` |
| Algorithm | RSA 4096, SHA384withRSA, self-signed |
| Subject | `CN=MAKEUP HOUSE, O=MAKEUP HOUSE` |
| Validity | 2026-11-20 → 2054-04-07 (10,000 days) |
| **Certificate SHA-256** | `B5:1B:F9:B0:42:27:7C:F4:FD:0C:36:83:7C:5A:93:D7:7C:B6:73:FE:B1:C6:EE:9E:57:BD:60:26:50:4D:63:86` |
| Keystore file SHA-256 (integrity of the copies) | `a896c1ec7d7ac0ea435f5ade0c8de636f3708c89947bd398e90c5682b2e69702` |

## APK

| Item | Value |
|---|---|
| Input (unsigned candidate) | `makeuphouse-advisor-3.0.0-release-candidate-UNSIGNED.apk`, SHA-256 `eda179f809640c9f25984e227ee9723b33de8b1792d3289d03a12f518cda329d` (matched on the phone before signing; zip-aligned) |
| Output | `makeuphouse-advisor-3.0.0-release-candidate-SIGNED.apk` |
| **Signed APK SHA-256** | `9ce93846d79f354374e6d8cd7f69c49f1d3aa351c251cf01676ba36656eaa358` |
| `apksigner verify` | `Verifies`; v2 true; v3 true (v4 disabled on purpose, no `.idsig` file) |
| Signer certificate | DN `CN=MAKEUP HOUSE, O=MAKEUP HOUSE`, SHA-256 `b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386` — **equals the key above** |
| App identity (unchanged by signing) | `com.makeuphouse.advisor`, versionCode 4, versionName 3.0.0 |

Evidence label: **REPORTED**. These are the owner's own `keytool` / `apksigner` outputs, transcribed into this session. The signed file itself was not re-checked in the cloud container.

## Custody status

| Requirement | Status |
|---|---|
| Key created outside the temporary cloud environment | DONE (owner's phone) |
| Password held in a password manager and on paper, not with the file | owner reported |
| Two copies of the key | 2 copies on the same phone (Termux home and internal storage) |
| **Copy off the phone** | **PENDING**: the owner plans to copy it to a computer. Until then, a lost or reset phone means no future update can be installed |

## Next

1. Copy `makeuphouse-release.jks` off the phone (computer and/or a private cloud folder), keeping the password elsewhere. Check each copy with `sha256sum` against `a896c1ec…69702`.
2. Uninstall the old debug-signed test app, then install the SIGNED APK.
3. Run `docs/SAMSUNG_ACCEPTANCE_V3.md`.
4. Every future release: sign with this key and check that the certificate SHA-256 is `b51bf9b0…4d6386`.
