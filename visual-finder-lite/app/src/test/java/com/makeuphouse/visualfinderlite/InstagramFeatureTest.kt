package com.makeuphouse.visualfinderlite

import com.makeuphouse.visualfinderlite.insta.InstagramLinks
import com.makeuphouse.visualfinderlite.insta.NameSuggester
import com.makeuphouse.visualfinderlite.insta.ProductNameGuesser
import com.makeuphouse.visualfinderlite.insta.ResultTitles
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class InstagramFeatureTest {

    /** Real titles captured from live Yandex similar-image pages (2026-11-28), 40 per product. */
    private val fixture: JSONArray by lazy {
        JSONArray(javaClass.classLoader!!.getResource("yandex_similar_titles_12_products.json")!!.readText())
    }

    companion object {
        /** What a person would accept as "the right product" for each test photo. */
        val EXPECTED = mapOf(
            "cream" to listOf("mixa"), "shampoo" to listOf("cadum"), "serum" to listOf("essence"),
            "sunscreen" to listOf("avene"), "mascara" to listOf("essence", "lash princess"),
            "hair-conditioner" to listOf("herbal essences"), "body-lotion" to listOf("johnson"),
            "perfume" to listOf("baccarat", "kurkdjian"), "shower-gel" to listOf("marseillais"),
            "lipstick" to listOf("nyx"), "deodorant" to listOf("narta"), "toothpaste" to listOf("signal"),
        )
    }

    @Test fun guessesTheRightProduct_forAll12RealProducts() {
        val report = StringBuilder()
        var hits = 0
        for (i in 0 until fixture.length()) {
            val o = fixture.getJSONObject(i)
            val titles = (0 until o.getJSONArray("titles").length()).map { o.getJSONArray("titles").getString(it) }
            val g = ProductNameGuesser.guess(titles)!!
            val ok = EXPECTED.getValue(o.getString("category")).any { g.phrase.contains(it) }
            if (ok) hits++
            report.append("${o.getString("category")}: '${g.phrase}' ${g.support}/${g.total} ${g.suggestions}\n")
            assertTrue("suggestions start with the phrase", g.suggestions.first() == g.phrase)
            assertTrue("no pure-number suggestions", g.suggestions.none { s -> s.split(' ').last().all(Char::isDigit) && s.split(' ').size == 2 })
        }
        println(report)
        assertEquals("all 12 products recognised\n$report", 12, hits)
    }

    @Test fun guesser_handlesEdgeCases() {
        assertNull(ProductNameGuesser.guess(emptyList()))
        assertNull(ProductNameGuesser.guess(listOf("шампунь для волос", "купить дешево")))  // no Latin words
        val g = ProductNameGuesser.guess(listOf("Avène Eau Thermale", "AVENE spray 50ml", "avene cream buy online"))!!
        assertEquals("avene", g.brand) // diacritics + case folded
        assertFalse(ProductNameGuesser.tokens("Price 400ml SPF 50 buy now").filterNotNull().any { it == "400ml" || it == "buy" })
    }

    @Test fun extractsTitles_fromAllYandexEncodings() {
        val raw = """..."alt":"Cadum Shampooing 2 en 1",..."alt":"Mixa Crème 400 ml"..."""
        val ent = """data-state="{&quot;alt&quot;:&quot;Cadum Shampooing 2 en 1&quot;,&quot;alt&quot;:&quot;NYX Lip &amp; Co&quot;}""""
        val esc = """{"alt":"Signal Toothpaste"}"""
        assertEquals(listOf("Cadum Shampooing 2 en 1", "Mixa Crème 400 ml"), ResultTitles.extract(raw))
        assertEquals(listOf("Cadum Shampooing 2 en 1", "NYX Lip & Co"), ResultTitles.extract(ent))
        assertEquals(listOf("Signal Toothpaste"), ResultTitles.extract(esc))
        assertTrue(ResultTitles.extract("<html>no results</html>").isEmpty())
    }

    @Test fun instagramLinks() {
        assertEquals("essencelashprincess", InstagramLinks.hashtag("Essence Lash-Princess!"))
        assertEquals("avene", InstagramLinks.hashtag("Avène"))
        assertEquals("essencelashprincess", InstagramLinks.hashtag("essence lash princess false"))
        assertEquals("مكياج_عيون", InstagramLinks.hashtag("مكياج_عيون"))
        assertEquals("https://www.instagram.com/explore/tags/nyxlingerie/", InstagramLinks.tagUrl("NYX Lingerie"))
        assertEquals("https://www.instagram.com/explore/search/keyword/?q=essence%20lash%20princess",
            InstagramLinks.keywordUrl("  essence   lash princess "))
        assertTrue(InstagramLinks.keywordUrl("كريم ميكسا")!!.contains("q=%D9%83"))
        assertNull(InstagramLinks.tagUrl("!!!")); assertNull(InstagramLinks.keywordUrl("   "))
    }

    @Test fun similarUrlOf_onlyAcceptsYandexCbirResults() {
        val search = "https://yandex.com/images/touch/search?rpt=imageview&url=https%3A%2F%2Favatars.mds.yandex.net%2Fget-images-cbir%2F1%2Fabc%2Forig&cbir_id=1%2Fabcdefghij&cbir_page=search-&lr=87"
        val s = NameSuggester.similarUrlOf(search)!!
        assertTrue(s.startsWith("https://yandex.com/images/touch/search?"))
        assertTrue(s.contains("cbir_page=similar")); assertTrue(s.contains("cbir_id=1%2Fabcdefghij"))
        assertFalse(s.contains("lr=")); assertFalse(s.contains("cbir_page=search"))
        assertNull(NameSuggester.similarUrlOf("https://yandex.com/images/touch/"))
        assertNull(NameSuggester.similarUrlOf("https://evil.example/?cbir_id=1%2Fabcdefghij"))
        assertNull(NameSuggester.similarUrlOf("https://yandex.com.evil.org/x?cbir_id=1%2Fabcdefghij"))
        assertNull(NameSuggester.similarUrlOf(null))
    }
}
