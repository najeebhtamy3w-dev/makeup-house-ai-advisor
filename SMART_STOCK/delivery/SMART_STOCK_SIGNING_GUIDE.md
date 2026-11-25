# SMART STOCK — Release Signing (permanent key)

Every future update must be signed with the **same** key as the first release. Losing the key means
users cannot update; they would need to uninstall (after taking an in-app backup) and install a new app.

## 1. Create the key — once, on the owner's computer (not in chat, not in git)
```bash
mkdir -p ~/.smartstock && cd ~/.smartstock
keytool -genkeypair -v -keystore smartstock-release.jks -alias smartstock \
        -keyalg RSA -keysize 4096 -validity 36500
```
Choose strong passwords when prompted. Then create `~/.smartstock/signing.properties`:
```
storeFile=/home/<you>/.smartstock/smartstock-release.jks
keyAlias=smartstock
```
Passwords are NOT written there: they are typed when signing (or provided as environment variables
`SMARTSTOCK_STORE_PASSWORD` / `SMARTSTOCK_KEY_PASSWORD` in a protected CI secret store).
`*.jks`, `*.keystore` and `signing.properties` are git-ignored.

## 2. Back up the key
Keep at least two offline copies of `smartstock-release.jks` + the passwords (e.g. encrypted USB in a safe,
and a password manager). Record the certificate fingerprint:
`keytool -list -v -keystore smartstock-release.jks -alias smartstock | grep SHA256`

## 3. Build a signed release
```bash
export ANDROID_HOME=/path/to/sdk
tools/sign_release.sh          # prompts for passwords, runs tests, builds, verifies, prints SHA-256
```
The pipeline was verified in the build environment with a throw-away test key (destroyed afterwards).

## 4. Debug vs release
The debug APK (`com.smartstock.debug`) uses the public Android debug key and installs side by side with
the release app. Data does not move automatically: use Settings → Backup in debug, then Restore in release.
