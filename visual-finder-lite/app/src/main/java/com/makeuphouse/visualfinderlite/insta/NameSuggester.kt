package com.makeuphouse.visualfinderlite.insta

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder

/** Fetches the (already shown) Yandex similar-images page for this image and guesses the product name. */
object NameSuggester {

    /** Any Yandex CBIR results URL -> the same search on the "similar" tab, or null if it isn't a CBIR result. */
    fun similarUrlOf(url: String?): String? {
        if (url == null || !url.contains("cbir_id=")) return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val host = uri.host ?: return null
        if (!(host == "yandex.com" || host.endsWith(".yandex.com") || host == "yandex.ru" || host.endsWith(".yandex.ru"))) return null
        val params = uri.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }
            .map { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8") }
        val keep = params.filter { (k, _) -> k == "url" || k == "cbir_id" || k == "rpt" || k == "crop" }
        if (keep.none { it.first == "cbir_id" }) return null
        val q = (keep.filter { it.first != "rpt" } + ("rpt" to "imageview") + ("cbir_page" to "similar"))
            .joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        return "https://$host/images/touch/search?$q"
    }

    fun fetchGuess(similarUrl: String, userAgent: String, cookie: String?): ProductNameGuesser.Guess? {
        val c = URL(similarUrl).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 15_000; c.readTimeout = 30_000
            c.setRequestProperty("User-Agent", userAgent)
            cookie?.let { c.setRequestProperty("Cookie", it) }
            if (c.responseCode != 200) return null
            val html = c.inputStream.bufferedReader().use { it.readText() }
            return ProductNameGuesser.guess(ResultTitles.extract(html))
        } finally { c.disconnect() }
    }
}
