package com.makeuphouse.visualfinderlite.lens

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Google Lens hand-off — official, free, user-initiated:
 *  1) Android share of the photo to the Google app (Lens) when it is installed (best results; no web CAPTCHA),
 *  2) otherwise Google Images inside the app, where the photo is auto-attached when the user taps the camera icon.
 * Why Lens: measured on 12 products, Yandex returned 0 instagram.com results; Lens indexes Instagram posts.
 */
object GoogleLens {
    const val GOOGLE_APP = "com.google.android.googlequicksearchbox"
    const val WEB_URL = "https://images.google.com/"
    /** Word the user adds in Lens "Add to your search" to keep Instagram posts. */
    const val INSTAGRAM_QUERY = "instagram"

    fun isGoogleAppInstalled(c: Context): Boolean =
        runCatching { c.packageManager.getPackageInfo(GOOGLE_APP, 0) }.isSuccess

    fun shareIntent(image: Uri): Intent = Intent(Intent.ACTION_SEND)
        .setType("image/jpeg")
        .putExtra(Intent.EXTRA_STREAM, image)
        .setPackage(GOOGLE_APP)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .apply { clipData = ClipData.newRawUri("product", image) }
}
