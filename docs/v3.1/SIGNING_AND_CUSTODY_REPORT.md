# التوقيع والحيازة

VERIFIED حديثًا بواسطة apksigner: شهادة APK القديم `b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386`، RSA4096، توقيعv2/v3، APK SHA `9ce93846d79f354374e6d8cd7f69c49f1d3aa351c251cf01676ba36656eaa358`.

VERIFIED: بصمة JKS المرفق تطابق السجل التاريخي؛ لم تُستخدم كلمة مرور ولم يُفتح private key. المفتاح خارج المستودع والحزمة النهائية. لم ينشأ مفتاح دائم بديل.

BLOCKED: توقيع release الجديد يحتاج المالك على جهازه؛ لا تطلب كلمة السر في المحادثة. الناتج الحالي UNSIGNED غير قابل للتثبيت مباشرة، وDEBUG artifact تقني بتوقيع مختلف وليس تحديثًا دائمًا.

حُدث scripts/sign-release.sh ليقرأ versionName، يرفض الكتابة فوق ملف موجود، يحافظ على16KB alignment، ويتحقق آليًا من بصمة المالك قبل نشر الملف الناتج. syntax PASSED؛ توقيع فعلي بمفتاح المالك الجديد NOT TESTED.

```sh
scripts/sign-release.sh MAKEUP_HOUSE_ADVISOR_3.1.0_RC1_UNSIGNED.apk /private/path/makeuphouse-release.jks makeuphouse
```

يتطلب Android Build Tools36 وتحديد ANDROID_HOME. أدخل كلمة المرور في الطرفية المحلية فقط؛ أبق نسختين آمنتين من المفتاح خارج الهاتف وكلمة مروره منفصلة. تحقق من الشهادة، ثم ثبّت فوق الإصدار القديم دون uninstall.
