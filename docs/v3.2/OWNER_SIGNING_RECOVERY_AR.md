# استعادة توقيع المالك — V6.4

الحالة: **IMPLEMENTED / PARTIAL** لمسار التحقق والتوقيع الآمن؛ **BLOCKED** للتوقيع الفعلي إلى أن يوفّر المالك الأسرار داخل بيئة GitHub المحمية، وتُثبت هوية APK المستخرج من الهاتف. لا يوجد وصول إلى مفتاح المالك أو كلمة مروره، ولم يُنشأ مفتاح دائم بديل.

## ما ثبت وما لم يثبت

- المصدر الحالي يحتوي آلية توقيع محلية `scripts/sign-release.sh` تتحقق من شهادة المالك، ولا يحتوي Workflow قديمًا يقرأ أسرار توقيع. عدم وجود ذلك في المصدر لا يثبت أن حساب GitHub لا يحتوي أسرارًا؛ الأدوات الحالية لا تسمح بقراءة قيمها، ولم نحاول استخراجها.
- الشهادة التاريخية المتحققة من APK V3.0.0 هي:

  `b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386`

- هذه ليست شهادة آخر تطبيق مثبت على الهاتف قبل استخراج نسخته والتحقق منها. قد تكون النسخة المثبتة `com.makeuphouse.advisor.engineering` وموقعة بشهادة Debug مختلفة؛ لا يمكن ترقية تلك النسخة بمفتاح التطبيق الدائم ذي الحزمة `com.makeuphouse.advisor`.
- ملف `makeuphouse-release.jks` المرشح، ونسختاه المختلفتا التاريخ، لم تُقرأ محتوياتهما هنا. اسم الملف وحجمه 4.31 KB لا يثبتان التطابق. Java Keystore قد يكون JKS أو PKCS12؛ الأداة تفحصه باستخدام keytool ولا تعتمد الامتداد وحده.
- اسم Key Alias الفعلي غير مثبت. السكربت يستخرج أسماء `PrivateKeyEntry` ويقارن شهادة كل منها؛ لا يفترض `makeuphouse` تلقائيًا.
- SHA-256 لملف APK يثبت بايتات الحزمة، وSHA-256 لملف JKS يثبت بايتات المخزن، وSHA-256 لشهادة التوقيع يحدد الشهادة. القيم الثلاث ليست بدائل لبعضها. ملف `SHA256SUMS-3.0.0.txt` غالبًا سجل بصمات ملفات؛ لا يصير بصمة شهادة إلا إذا نص محتواه على ذلك وأُعيد التحقق منه.

## المسار الآمن المجهز

الملفات الجديدة:

- `.github/workflows/v32-owner-sign.yml`
- `scripts/ci-owner-sign.py`
- `scripts/owner-signing-preflight.py`
- `tests/test_owner_signing.py`

لا يعيد Workflow البناء؛ يسترجع Artifact هندسيًا ناجحًا محددًا بـ Run ID وCommit SHA، ويتحقق من مصدره، واسم Workflow، والفرع، وحدث البناء، وعدم كونه PR أو Fork، وبصمة الأرشيف وAPK. يرفض اجتياز المسار أو الأسماء المتكررة داخل ZIP. يستخرج فقط Manifest وAPK غير الموقع إلى الذاكرة/مجلد مؤقت.

ثم يتحقق من شهادة PrivateKeyEntry بالمفتاح المقدم **قبل التوقيع**؛ يجب أن تطابق الشهادة التاريخية الثابتة وشهادة APK المثبت التي أدخلها المالك. يتحقق من Package ID ورقم إصدار أعلى من المثبت وARM64 وكل مكتبات ELF بحد 16 KiB وZIP alignment. يوقع باستخدام كلمات مرور من متغيرات البيئة، ويعيد فحص الشهادة والتوقيع والهوية والبصمة. أي اختلاف يوقف التسليم.

المفتاح المؤقت داخل RUNNER_TEMP بصلاحية 0600، خارج مجلد Artifacts، ويُحذف في النجاح والفشل العادي؛ توجد خطوة تنظيف `always()` إضافية. إيقاف runner قسريًا ليس ضمان مسح تشفيري، ولذلك يستخدم runner مؤقتًا. لا تُطبع كلمات المرور أو Base64 أو المفتاح. Base64 ترميز نقل وليس تشفيرًا. المخرجات تقتصر على APK موقع وتقرير عام وبصمات وفحص شهادة؛ لا إصدار Production أو GitHub Release آلي.

الفرع المسموح وحده: `work-v32-unified-scientific-core` داخل المستودع الأصلي. الصلاحيات `contents: read` و`actions: read`. لا `pull_request_target` ولا فتح أسرار لطلبات PR. بوابة environment `owner-signing` لازمة.

## المطلوب من المالك: خطوات واضحة

### 1. استخراج APK المرجعي من التطبيق المثبت

المسار الموثوق المجهز يحتاج كمبيوتر مع Android SDK Build Tools وADB وJava JDK؛ لا يحتاج رفع المفتاح إلى المحادثة. وصّل الهاتف مع USB debugging على الكمبيوتر الموثوق ثم افحص الحزم:

```sh
adb shell pm list packages
adb shell pm path com.makeuphouse.advisor
```

إذا أعاد الأمر مسارًا يبدأ `package:/data/app/.../base.apk`، انسخ المسار الفعلي بعد `package:` واستعمله:

```sh
adb pull /data/app/ACTUAL_PATH/base.apk INSTALLED_REFERENCE.apk
```

لا تستخدم المسار التوضيحي كما هو. إذا كانت الحزمة `com.makeuphouse.advisor.engineering`، استخرجها أيضًا بهذا الاسم وسجل أنها Engineering. لا تعتبر ملف APK قديمًا في Downloads دليلًا على المثبت الآن. فحص `apksigner verify --verbose --print-certs INSTALLED_REFERENCE.apk` و`aapt dump badging INSTALLED_REFERENCE.apk` يعطي الشهادة والهوية والإصدار. لا تحذف التطبيق أو بياناته لتجاوز اختلاف توقيع.

### 2. مقارنة نسختي JKS محليًا

انسخ النسختين إلى مجلد خاص على الكمبيوتر باسمين مختلفين؛ احتفظ بالأصلين. لا ترفع ملف كلمات المرور أو JKS إلى GitHub Repository أو المحادثة. افتح نسخة المصدر الحالية وشغّل:

```sh
python3 scripts/owner-signing-preflight.py /PRIVATE/key-A.jks /PRIVATE/key-B.jks --reference-apk /PRIVATE/INSTALLED_REFERENCE.apk --build-tools /YOUR/ANDROID/SDK/build-tools/36.0.0 --report /PRIVATE/OWNER_PUBLIC_SIGNING_PREFLIGHT.json
```

على Windows استخدم `py` ومسارات Windows الفعلية. سيطلب كلمة مرور كل مخزن محليًا دون إظهارها. يعرض فقط بصمات الملفين وأسماء Aliases وبصمات الشهادات؛ التقرير عام لا يحتوي المفتاح أو كلمة المرور. يمكن إرسال هذا التقرير العام للمراجعة. اختلاف بصمة JKS لا يعني بالضرورة اختلاف الشهادة؛ افحص كل شهادة. إذا اختلفت شهادة APK المثبت، يتوقف مسار التحديث حتى استعادة مفتاحه الحقيقي. لا يُحل ذلك بمفتاح جديد أو إعادة تسمية الحزمة.

### 3. إنشاء بيئة GitHub المحمية

من متصفح الهاتف يمكن تنفيذ الإعداد الإداري التالي، لكن التحقق بمفتاح JKS والنقل المباشر المجهز هنا يحتاجان الكمبيوتر المذكور:

1. افتح المستودع → Settings → Environments → New environment → `owner-signing`.
2. فعّل Required reviewers واختر المالك/المراجع المخول. إذا فعّلت منع المراجعة الذاتية، يجب وجود مراجع موثوق آخر يستطيع الموافقة؛ لا تجعل مهمة المالك نفسه مستحيلة.
3. Deployment branches: Selected branches، وأضف الاسم الكامل `work-v32-unified-scientific-core` فقط. احمِ الفرع من تعديل غير موثوق وForce Push.
4. راجع كود Workflow والسكربت قبل إدخال الأسرار، ولا توافق على طلب توقيع لتغيير غير معروف.
5. Environment variables: `OWNER_SIGNING_ENABLED` بقيمة `true` بعد إتمام الخطوات.
6. Environment secrets المطلوبة بأسمائها الفعلية:

   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

لا تضعها Repository variables عامة، ولا في ملف request. إذا كانت موجودة بالفعل بأسماء مختلفة، لا تنسخها علنًا؛ يمكن ربط الأسماء في Workflow بعد فحص مسارها المعتمد. لا يوجد مسار سابق مثبت في المصدر الحالي لإعادة استخدامه تلقائيًا. لم نقرأ قيم Secrets، ولا نتيح استخراجها. وجود أسماء أسرار قديمة في Settings يحتاج تحقق المالك؛ غياب Workflow من المصدر لا يثبت عدم وجود Secrets على GitHub.

### 4. نقل الأسرار دون طباعتها

بعد نجاح المقارنة، ثبت/استخدم GitHub CLI موثوقًا على الكمبيوتر وسجّل الدخول بحساب المالك محليًا `gh auth login`. اختر **نسخة JKS واحدة فقط** وشغّل:

```sh
python3 scripts/owner-signing-preflight.py /PRIVATE/verified-owner.jks --reference-apk /PRIVATE/INSTALLED_REFERENCE.apk --build-tools /YOUR/ANDROID/SDK/build-tools/36.0.0 --report /PRIVATE/OWNER_PUBLIC_SIGNING_UPLOAD.json --set-github-secrets
```

هذا الخيار الصريح يفحص حماية البيئة والمراجع والفرع، ويرفض النقل قبل مطابقة الشهادة والهوية. يطلب تأكيدًا محليًا وكلمة مرور المفتاح الخاص؛ Enter يعني أنها كلمة مرور المخزن نفسها. ينقل القيم مباشرة إلى `gh secret set` عبر stdin، دون ملف Base64 مؤقت أو طباعتها. لا يغير المخزن ولا ينشئ مفتاحًا. لا تكتب كلمات المرور في أوامر shell أو المحادثة، ولا تستخدم مواقع تحويل JKS/Base64.

### 5. طلب توقيع Artifact مكتمل

لتجنب تعديل default/main لمجرد تسجيل workflow_dispatch، يوجد Trigger آمن عند Commit ملف طلب **عام لا يحتوي أسرارًا** إلى الفرع المخصص:

`.github/owner-signing-request.json`

مثال للـ OCR Artifact المستعاد الناجح (ليست هوية الهاتف مثبتة بعد):

```json
{
  "engineering_run_id": 45831293938,
  "expected_source_sha": "899df0253dabe0e023ac661386cb80d387973441",
  "installed_certificate_sha256": "REPLACE_WITH_VERIFIED_INSTALLED_CERTIFICATE",
  "installed_version_code": "REPLACE_WITH_VERIFIED_INSTALLED_VERSION_CODE"
}
```

لا تحفظ المثال قبل استبدال القيم من التقرير المتحقق. يمكن للمالك إنشاء هذا الملف من Add file في واجهة GitHub على الهاتف ثم Commit إلى فرع التطوير. ستظهر مهمة تنتظر موافقة بيئة التوقيع. تحقق من Run ID وSHA والمصدر ثم وافق. عند وجود Artifact أحدث، استبدل مرجعه بأحدث بناء ناجح متحقق؛ لا تعِد البناء للتوقيع فقط.

يدعم Workflow أيضًا workflow_dispatch بعد تسجيله بالطريقة التي يوافق عليها المالك؛ GitHub يشترط عادة وجود ملف ذلك الحدث على default branch. لم ندمج الفرع في main ولم نتجاوز ذلك. مسار push-request لا يحتاج هذا الدمج.

## النتيجة المتوقعة وحدود القبول

Artifact الناتج اسمه `makeup-house-v32-owner-signed-RUN_ID`، ويحتوي APK و`SIGNED_RELEASE_MANIFEST.json` و`SIGNATURE_VERIFICATION.txt` و`SHA256SUMS.txt`. لا يحتوي المفتاح ولا كلمات المرور. التوقيع لا يمنح قبولًا إنتاجيًا؛ الحوار العلمي وOCR/VLM وSamsung والتحديث والمحافظة على البيانات/الأوزان تحتاج اختبارات منفصلة.

السكربت لا يدعي ترحيل بيانات الهاتف: لا يحمل نسخة بيانات ولا يحذف أوزانًا، لكنه يسجل اختبار التحديث الفعلي **NOT TESTED**. قبل تجربة التحديث، احتفظ بنسخة احتياطية موثوقة وفق التطبيق. لا تطلب إزالة النسخة المثبتة.

## أدلة التحقق الهندسي

اختبارات Python تتحقق من رفض Artifact متلاعب أو مصدر/Fork/PR/فرع خاطئ أو Hash مخالف. اختبار إضافي أنشأ مفتاح اختبار مؤقتًا داخل مجلد نظام مؤقت، واستخرج شهادته فعليًا بـ keytool ثم أثبت رفضه كشهادة المالك. ليس مفتاح إصدار بديلًا، وحُذف عند انتهاء الاختبار. الاختبارات لا تعني توفر أو اختبار مفتاح المالك.

المصادر الأولية المراجعة 2026-11-26:

- https://developer.android.com/tools/apksigner
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/rest/actions/artifacts
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch

## سجل التحقق المحلي

`python3 -m unittest discover -s tests -p test_owner_signing.py -v` → **10/10 PASS**، بلا اختبارات متخطاة. يتضمن ذلك keytool حقيقيًا بمخزن مؤقت، وتشغيل preflight الفعلي والتأكد من عدم رفع أسرار افتراضيًا أو ظهور كلمة المرور في التقرير/المخرجات. YAML ببيئة owner-signing تم تحليله بنجاح، لكن تشغيل مهمة توقيع GitHub الفعلية **NOT TESTED** حتى إعداد المالك.

تمت مطابقة بيانات GitHub الحقيقية للبناء الناجح `45831293938` مع مرجع المصدر `899df0253dabe0e023ac661386cb80d387973441` ومسار Workflow والفرع والمستودع باستخدام تحقق السكربت. لا يستلزم هذا الفحص وصولًا إلى أي سر.

## أحدث Artifact صالح للتوقيع عند اكتمال مطابقة المالك

Run45881131718، source917d85c96488512681c1100c8af4eb78133e8391، Artifact15147271806، version3.2.0-dev.3/code8. استخدم هذا المرجع بدل مثال OCR السابق عند إعداد طلب التوقيع. تبقى شهادة المثبت ورقم إصداره من تقريرك المتحقق، ولا تضع قيمًا مفترضة. APK غير الموقع SHA256:b30c0e2ba88bc9a79a63c1fbbf7858a90d8dca7cfe579ddb2759470c6cbecce6. لم تُنشأ أي مهمة توقيع فعلية أو مفتاح بديل.
