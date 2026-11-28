package com.makeuphouse.visualfinderlite.insta

import java.net.URLEncoder
import java.text.Normalizer

/** Public Instagram web links (the Instagram app opens them through Android App Links). */
object InstagramLinks {
    const val PACKAGE = "com.instagram.android"

    /**
     * "Essence Lash Princess False" -> "essencelashprincess": first 3 words only (long tags have few posts);
     * keeps Arabic letters; drops symbols/diacritics.
     */
    fun hashtag(text: String): String {
        val words = text.trim().split(Regex("\\s+")).take(3).joinToString(" ")
        val d = Normalizer.normalize(words, Normalizer.Form.NFD).replace(Regex("""\p{Mn}+"""), "")
        return d.lowercase().replace(Regex("""[^\p{L}\p{N}_]+"""), "").take(60)
    }

    fun tagUrl(text: String): String? = hashtag(text).takeIf { it.isNotEmpty() }
        ?.let { "https://www.instagram.com/explore/tags/${URLEncoder.encode(it, "UTF-8")}/" }

    fun keywordUrl(text: String): String? = text.trim().replace(Regex("\\s+"), " ").takeIf { it.isNotEmpty() }
        ?.let { "https://www.instagram.com/explore/search/keyword/?q=${URLEncoder.encode(it, "UTF-8").replace("+", "%20")}" }
}
