package com.makeuphouse.visualfinderlite.yandex

import org.json.JSONObject
import java.net.URLEncoder

/**
 * Everything the app knows about Yandex Images URLs and upload responses.
 * Pure JVM code (no Android types) so it is covered by unit tests.
 *
 * Verified against the live service on 2026-11-28 (see YANDEX_INTEGRATION_BENCHMARK.md):
 *  - POST raw image bytes to [UPLOAD_URL] -> JSON { cbir_id, sizes.orig.path, ... }
 *  - Fallback: multipart field "upfile" to [LEGACY_UPLOAD_URL] -> JSON blocks[0].params { cbirId, originalImageUrl }
 *  - Open [similarUrl] -> mobile "Similar images" tab for THAT uploaded image.
 */
object YandexContract {
    const val HOST = "https://yandex.com"
    const val HOME_URL = "$HOST/images/touch/"

    const val UPLOAD_URL =
        "$HOST/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir"

    const val LEGACY_UPLOAD_URL =
        "$HOST/images/search?rpt=imageview&format=json&request=" +
            "%7B%22blocks%22%3A%5B%7B%22block%22%3A%22b-page_type_search-by-image__link%22%7D%5D%7D"

    /** Hosts that belong to the Yandex search experience (kept inside the in-app browser). */
    private val YANDEX_HOST = Regex("""(^|\.)(yandex\.(com|ru|by|kz|uz|com\.tr|com\.am|com\.ge|az|fr|eu)|ya\.ru|yastatic\.net|yandex\.net)$""")

    data class Upload(val cbirId: String, val imageUrl: String)

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    /** Direct link to the "Similar images" tab of a fresh upload. */
    fun similarUrl(u: Upload): String =
        "$HOST/images/touch/search?rpt=imageview&cbir_page=similar&url=${enc(u.imageUrl)}&cbir_id=${enc(u.cbirId)}"

    /** Parses the image-download (apphost) response. Returns null if the shape is not recognised. */
    fun parseUploadResponse(body: String): Upload? = runCatching {
        val o = JSONObject(body)
        val id = o.optString("cbir_id").trim()
        val url = o.optJSONObject("sizes")?.optJSONObject("orig")?.optString("path").orEmpty().trim()
        if (validId(id) && url.startsWith("https://")) Upload(id, url) else null
    }.getOrNull()

    /** Parses the legacy "search?rpt=imageview&format=json" multipart response. */
    fun parseLegacyResponse(body: String): Upload? = runCatching {
        val blocks = JSONObject(body).optJSONArray("blocks") ?: return@runCatching null
        for (i in 0 until blocks.length()) {
            val p = blocks.optJSONObject(i)?.optJSONObject("params") ?: continue
            val id = p.optString("cbirId").trim()
            val url = p.optString("originalImageUrl").trim()
            if (validId(id) && url.startsWith("https://")) return@runCatching Upload(id, url)
            // older shape: params.url = "cbir_id=...&rpt=imageview&url=..."
            val q = p.optString("url")
            if (q.contains("cbir_id=")) {
                val map = q.split('&').mapNotNull { kv -> kv.split('=', limit = 2).takeIf { it.size == 2 } }
                    .associate { it[0] to java.net.URLDecoder.decode(it[1], "UTF-8") }
                val id2 = map["cbir_id"].orEmpty(); val url2 = map["url"].orEmpty()
                if (validId(id2) && url2.startsWith("https://")) return@runCatching Upload(id2, url2)
            }
        }
        null
    }.getOrNull()

    /** cbir ids look like "2212615/Bg2uyO4Uwyl-CzYpj3KvSw2850". */
    fun validId(id: String): Boolean = Regex("""^\d+/[A-Za-z0-9_\-]{8,}$""").matches(id)

    fun isYandexHost(host: String?): Boolean = host != null && YANDEX_HOST.containsMatchIn(host.lowercase())

    /** Yandex shows its SmartCaptcha on /showcaptcha or /checkcaptcha pages. */
    fun isCaptchaUrl(url: String?): Boolean = url != null && Regex("""/(showcaptcha|checkcaptcha)""").containsMatchIn(url)
}
