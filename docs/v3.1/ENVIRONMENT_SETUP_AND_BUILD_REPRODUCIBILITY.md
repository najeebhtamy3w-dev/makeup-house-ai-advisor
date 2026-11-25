# البيئة وإعادة البناء

## VERIFIED

Linux x86_64؛ Git 2.56.1؛ Node 24.22.3 (يفي >=22.13)؛ npm 11.19.1؛ JDK Temurin 21.0.13.1+2؛ Gradle 8.14.3؛ AGP 8.13.0؛ Android API 36؛ Build Tools 35.0.0 و36.0.0؛ NDK 28.2.13676358؛ CMake Android 3.22.1؛ CMake host 3.31.6؛ Ninja 1.11.1.4؛ Chromium headless 131.0.6778.204؛ Playwright من بيئة التطوير فقط.

المثبت افتراضيًا كان JRE بلا javac. جُلب JDK من API Adoptium؛ بصمة الأرشيف المرصودة `bb8a93f9ae6e7a693b2b721e85dbeff26ae1a77447985a8d7afcdd9c7cf6222e` (ليست بذاتها توقيع أصالة مستقل). مصدر Android: https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip . Gradle bin SHA256 مطابق للمنشور رسميًا: `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531`.

## الأوامر

```sh
npm ci
npm test
npm run typecheck
npm run android:sync
export JAVA_HOME=/path/to/jdk21
export ANDROID_HOME=/path/to/android-sdk
cd android
./gradlew :app:assembleDebug :app:assembleRelease --no-daemon --max-workers=2
```

ثبت حزم SDK: `platforms;android-36` و`build-tools;35.0.0` و`build-tools;36.0.0` و`platform-tools` و`ndk;28.2.13676358` و`cmake;3.22.1`.

CMake ينزل llama.cpp عند SHA ثابت ويتحقق من SHA256 للأرشيف. يمكن تمرير MH_LLAMA_SOURCE_DIR لنسخة مطابقة محلية؛ تحقق أولًا أن HEAD هو `a7a98e0fffed794396b3fbad4dcdbbc184963645` ولا تعديلات فيها. لا تعتمد فرع master متحركًا.

```sh
cmake -S native -B /tmp/mh-host -DLLAMA_SOURCE_DIR=/path/to/pinned/llama.cpp -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/mh-host -j2
/tmp/mh-host/mh-ai-test /path/to/approved.gguf /path/to/prompt.txt
node --import tsx scripts/evaluate-local-ai.ts /tmp/mh-host/mh-ai-poc /path/to/approved.gguf
```

في هذه البيئة احتاج Java إعداد proxy من HTTPS_PROXY لكل عملية، واستخدام trustStore الموجود بالنظام؛ لم تُعطل TLS. لا تنسخ منافذ proxy المؤقتة إلى ملفات المشروع. التوقيع عبر scripts/sign-release.sh على جهاز المالك فقط. لا model weights أو keystore ضمن git أو source ZIP.

Playwright: `NODE_PATH` يشير إلى حزمة البيئة. فشل تنزيل Chromium الجديد من CDN؛ استُخدم Chrome for Testing الرسمي 131 من storage.googleapis.com. هذه قياسات Chromium وليست WebView على Samsung.
