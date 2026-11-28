# Persistent model provider tests

This isolated Maven project compiles the actual production `PersistentModelStore.java` and runs it with an Android `DocumentsProvider` under Robolectric. It does not build or load Capacitor, native inference, or a fake copy of the store. Fixtures have synthetic pinned hashes; no model is downloaded.

Robolectric runs Android API 35. The resolver test adapter forwards its legacy query shadow to the modern `Bundle` query dispatch, as real Android's resolver does. It changes only harness routing, not storage validation or grants. The test JVM opens `java.io` for Robolectric's file-descriptor interceptor on Java 17+.

Robolectric leaves `libcore.io.Linux.rename` unimplemented. The test OS adapter performs a real Host `Files.move(ATOMIC_MOVE, REPLACE_EXISTING)` at that boundary; production code still invokes `Os.rename` after validating the temporary file. This verifies the code's replacement ordering and actual result bytes, while Android's own filesystem/provider behavior remains a device check.

Run `mvn -f tests/android-provider/pom.xml test` with Java 17+ and network access for the pinned Maven dependencies. The first run also fetches Robolectric's Android runtime. These results are **Host Android simulation**, not Samsung, USB hardware, provider firmware, Android installation, or model-quality acceptance.

Cases cover an independently obtained renamed original without download history, read-only restoration, incorrect and incomplete files, a changed source between discovery and copying, cancellation, revoked grants, and untrusted sidecars. Every case also rejects any write, delete, rename, or external-copy request against the original provider.
