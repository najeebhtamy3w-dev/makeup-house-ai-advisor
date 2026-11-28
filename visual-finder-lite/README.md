# MAKEUP HOUSE — Visual Finder Lite 1.1.0

تطبيق Android خفيف (عربي، RTL): **صوّر المنتج ← ابحث ← صور Yandex المشابهة ← نزّل الصورة**، ثم **ابحث عن المنتج في إنستغرام** باسمه المستخرج تلقائيًا.

```
تصوير/اختيار ──► تجهيز (≤1600px، إزالة EXIF) ──► رفع إلى Yandex ──► cbir_id
                                                          │
         تنزيل إلى الصور/MakeupHouse ◄── WebView: Similar Images (صفحة Yandex الأصلية)
```

## الهيكل

| الملف | المسؤولية |
|---|---|
| `MainActivity.kt` | الشاشة الرئيسية، كاميرا النظام (TakePicture)، Photo Picker، المعاينة، الأخطاء |
| `MainViewModel.kt` | الحالة (تصمد مع التدوير وموت العملية)، التجهيز، الرفع، منع إعادة استخدام صورة قديمة |
| `image/ImagePreparer.kt` | فك الترميز بالحجم المستهدف، اتجاه EXIF، إعادة ترميز JPEG 92 (يزيل البيانات الوصفية) |
| `image/ImageStore.kt` | مجلد مؤقت خاص محدود + FileProvider + التنظيف |
| `yandex/YandexContract.kt` | الروابط، تحليل الاستجابات، رابط Similar (قابل للاختبار على JVM) |
| `yandex/YandexUploader.kt` | الرفع (نقطتا رفع + cookies مشتركة مع WebView) |
| `SearchActivity.kt` | WebView محصّن: رجوع/تحديث/متصفح/رئيسية، التقاط زر التنزيل، ضغط مطوّل، File Chooser، CAPTCHA |
| `web/ImageDownloader.kt` | تنزيل إلى MediaStore مع فحص magic bytes |
| `web/ImageSniffer.kt` | كشف صيغة الصورة الحقيقية وتوليد الأسماء |
| `util/Network.kt` | فحص الاتصال |
| `insta/ResultTitles.kt` | استخراج عناوين النتائج من صفحة Yandex (كل صيغ الترميز) |
| `insta/ProductNameGuesser.kt` | تخمين «الماركة + خط المنتج» من تكرار الكلمات عبر العناوين |
| `insta/NameSuggester.kt` | جلب صفحة Similar للصورة الحالية وتشغيل التخمين |
| `insta/InstagramLinks.kt` | روابط إنستغرام (بحث بالكلمات / هاشتاق) |

**الأذونات:** `INTERNET`، `ACCESS_NETWORK_STATE` فقط.
**المكتبات:** activity-ktx، core-ktx، coroutines فقط.

## البناء

المتطلبات: JDK 17+ (مُختبر على 21)، Android SDK 36 (`platforms;android-36`، `build-tools;36.0.0`).

```bash
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleDebug        # → app/build/outputs/apk/debug/MAKEUP-HOUSE-VISUAL-FINDER-LITE-1.1.0-debug.apk
./gradlew testDebugUnitTest lintDebug
```

### التوقيع الهندسي الثابت (لتحديثات Debug دون إلغاء التثبيت)
المفتاح `vfl-engineering-debug.jks` **ليس في المستودع**، لأن المستودع عام. ضع ملف `keystore.properties` (المُسلَّم بشكل خاص) في جذر `visual-finder-lite/` ليشير إلى مسار المفتاح، أو استخدم متغيرات البيئة:
`VFL_KEYSTORE`، `VFL_KEYSTORE_PASSWORD`، `VFL_KEY_ALIAS`، `VFL_KEY_PASSWORD`.
بدون المفتاح سيُبنى التطبيق بمفتاح debug الافتراضي، ولن يُحدِّث النسخة المثبتة (يلزم حذفها أولًا).
بصمة الشهادة SHA-256: `e7935845b61a4c05396990e5f4818df93445c62697ad4b872438b7069b5add1c`

### التحديث المستقبلي
ارفع `versionCode` و`versionName` في `app/build.gradle.kts`، ثم ابنِ بنفس المفتاح، ثم ثبّت فوق النسخة القديمة.
إذا غيّرت Yandex نقطة الرفع، فالتعديل محصور في `yandex/YandexContract.kt`. شغّل الاختبارات الحية للتحقق.

## التقارير
`ENGINEERING_SELF_REVIEW.md` · `YANDEX_INTEGRATION_BENCHMARK.md` · `TEST_REPORT.md` · `DEVICE_ACCEPTANCE_CHECKLIST.md` · `FINAL_RELEASE_REPORT.md` · `evidence/` (لقطات، ونتائج JSON حية).

> ظهور الصورة في نتائج Yandex لا يعني إذنًا باستخدامها تجاريًا. تحقّق من حقوق كل صورة قبل نشرها.
