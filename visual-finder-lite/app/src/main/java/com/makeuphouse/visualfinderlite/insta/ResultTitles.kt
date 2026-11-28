package com.makeuphouse.visualfinderlite.insta

/**
 * Pulls the result-image titles ("alt" texts) out of a Yandex results page. Yandex serves A/B variants
 * where the embedded JSON is raw, HTML-entity encoded (&quot;) or "-escaped — all handled here.
 */
object ResultTitles {
    private val ALT = Regex(""""alt":"((?:[^"\\]|\\.){3,240})"""")

    fun extract(html: String, max: Int = 80): List<String> {
        val s = html.replace("&quot;", "\"").replace("\\u0022", "\"").replace("&amp;", "&")
            .replace("&#39;", "'").replace("&#x27;", "'")
        return ALT.findAll(s).map { m ->
            m.groupValues[1].replace("\\\"", "\"").replace("\\/", "/").replace(Regex("""\\u([0-9a-fA-F]{4})""")) {
                it.groupValues[1].toInt(16).toChar().toString()
            }.trim()
        }.filter { it.isNotBlank() }.distinct().take(max).toList()
    }
}
