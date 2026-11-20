# Release Signing — Owner-Controlled Key and Custody

**Status: final signed release BLOCKED — waiting for the owner's permanent key.**

No permanent key was created in the cloud session, per "Do not create an uncontrolled substitute key". What exists:

- An **unsigned** v3.0.0 release candidate.
- A **debug-signed** v3.0.0 build for testing only. Its debug key exists only in the temporary cloud container, so it cannot be used for updates.

## Why this matters

Android installs an update only if it is signed with **the same key** as the installed app. If the key is lost, no future update can be installed over the shop's app. The data would then have to be moved by backup and restore to a newly installed app. Treat the key like the shop's master key.

## One-time: create the permanent key (owner, on the owner's own computer)

Requirements: a JDK 17+ (`keytool`).

```bash
scripts/owner-keygen.sh ~/secure/makeuphouse-release.jks
```

- `keytool` asks for the passwords; the script never stores them.
- The script refuses to write inside the repository or over an existing key.
- It prints the certificate **SHA-256 fingerprint**. That value is not secret: record it in the release notes.

## Custody (mandatory)

1. Keep **two copies** of the `.jks` file in separate places, for example an encrypted USB drive in the shop safe and an encrypted personal backup.
2. Keep the **passwords** in a password manager, not in the same place as the file.
3. Never commit, email or upload the key or its passwords to a chat. `.gitignore` already blocks `*.jks`, `*.keystore`, `*.p12`, `keystore.properties` and `key.properties`.
4. Write the fingerprint on the custody record. Every future release must show the same fingerprint.

## Each release: sign the candidate (owner)

Option A: sign the provided unsigned candidate. This needs Android SDK build-tools (`apksigner`, `zipalign`).

```bash
scripts/sign-release.sh makeuphouse-advisor-3.0.0-release-candidate-UNSIGNED.apk ~/secure/makeuphouse-release.jks
```

The script asks for the passwords, aligns, signs (v2 + v3), verifies, and prints the certificate SHA-256 and the APK SHA-256.

Option B: build signed with Gradle. Create a `keystore.properties` **outside git**:

```
storeFile=/home/owner/secure/makeuphouse-release.jks
storePassword=…
keyAlias=makeuphouse
keyPassword=…
```

Then run:

```bash
MH_KEYSTORE_PROPERTIES=/home/owner/secure/keystore.properties npm run android:sync && (cd android && ./gradlew assembleRelease)
```

Without that file the release is built **unsigned**. It is never signed with a substitute key.

## Verified in this session

Both paths were tested with the pre-existing Android **debug** keystore. No new key was created, and the test outputs were deleted, not delivered.

- Gradle with `keystore.properties` produced a signed, non-debuggable release.
- `sign-release.sh` produced valid v2 and v3 signatures.
- The unsigned build is reproducible: an identical SHA-256 on rebuild.
