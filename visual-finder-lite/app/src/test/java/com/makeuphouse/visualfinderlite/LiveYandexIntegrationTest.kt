package com.makeuphouse.visualfinderlite

import com.makeuphouse.visualfinderlite.yandex.YandexContract
import com.makeuphouse.visualfinderlite.yandex.YandexUploader
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * REAL network test of the production upload code against live Yandex (not a mock).
 * Skipped unless -Pvfl.live=true. Writes evidence JSON to app/build/vfl-evidence/.
 */
class LiveYandexIntegrationTest {
    private val ua = "Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36"
    private val jar = object : YandexUploader.CookieJar {
        val m = mutableMapOf<String, String>()
        override fun get(url: String) = m.values.joinToString("; ").ifEmpty { null }
        override fun put(url: String, setCookie: String) { val kv = setCookie.substringBefore(';'); m[kv.substringBefore('=')] = kv }
    }
    private lateinit var images: List<File>
    private lateinit var out: File

    @Before fun setUp() {
        assumeTrue("live tests disabled", System.getProperty("vfl.live") == "true")
        images = File(System.getProperty("vfl.images")).listFiles { f -> f.name.endsWith(".jpg") }!!.sortedBy { it.name }
        assertTrue("need >= 10 product images", images.size >= 10)
        out = File(System.getProperty("vfl.out")).apply { mkdirs() }
    }

    private fun get(url: String): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", ua); c.connectTimeout = 15000; c.readTimeout = 30000
        jar.get(url)?.let { c.setRequestProperty("Cookie", it) }
        val code = c.responseCode
        val body = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
        c.disconnect()
        // Yandex A/B variants embed the same JSON either raw or HTML-entity-encoded (&quot;).
        return code to body.replace("&quot;", "\"").replace("\\u0022", "\"")
    }

    private fun hashPart(id: String) = id.substringAfter('/').dropLast(4)

    @Test fun productBenchmark_allImages() {
        val arr = JSONArray(); val hashes = mutableSetOf<String>()
        for (img in images) {
            val t0 = System.currentTimeMillis()
            val up = YandexUploader(ua, jar).upload(img)
            val t1 = System.currentTimeMillis()
            val url = YandexContract.similarUrl(up)
            val (code, html) = get(url)
            val t2 = System.currentTimeMillis()
            val captcha = Regex("showcaptcha|smartcaptcha|checkcaptcha", RegexOption.IGNORE_CASE).containsMatchIn(html)
            val results = Regex("\"origUrl\":\"").findAll(html).count()
            arr.put(JSONObject().put("image", img.name).put("cbir_id", up.cbirId).put("upload_ms", t1 - t0)
                .put("page_ms", t2 - t1).put("http", code).put("captcha", captcha).put("similar_results", results)
                .put("page_mentions_this_cbir_id", html.contains(up.cbirId.substringAfter('/'))))
            assertEquals(200, code); assertFalse(captcha); assertTrue("results for ${img.name}", results >= 10)
            assertTrue("distinct hash per product", hashes.add(hashPart(up.cbirId)))
            Thread.sleep(1500)
        }
        File(out, "live_benchmark.json").writeText(arr.toString(1))
    }

    /** Full production chain: photo -> upload -> similar page -> product name for Instagram. */
    @Test fun instagramName_fromLiveResults_forAllImages() {
        val arr = JSONArray(); var hits = 0
        for (img in images) {
            val up = YandexUploader(ua, jar).upload(img)
            val similar = com.makeuphouse.visualfinderlite.insta.NameSuggester.similarUrlOf(YandexContract.similarUrl(up))!!
            val g = com.makeuphouse.visualfinderlite.insta.NameSuggester.fetchGuess(similar, ua, jar.get(similar))
            val expected = InstagramFeatureTest.EXPECTED[img.nameWithoutExtension].orEmpty()
            val ok = g != null && expected.any { g.phrase.contains(it) }
            if (ok) hits++
            arr.put(JSONObject().put("image", img.name).put("phrase", g?.phrase).put("support", g?.support).put("total", g?.total)
                .put("suggestions", JSONArray(g?.suggestions.orEmpty())).put("expected_any_of", JSONArray(expected)).put("correct", ok)
                .put("hashtag", g?.let { com.makeuphouse.visualfinderlite.insta.InstagramLinks.hashtag(it.phrase) }))
            Thread.sleep(1500)
        }
        File(out, "live_instagram_names.json").writeText(arr.toString(1))
        assertTrue("at least 11/12 correct, got $hits", hits >= 11)
    }

    @Test fun fallbackEndpoint_isUsedWhenPrimaryBreaks() {
        val up = YandexUploader(ua, jar, primaryUrl = "https://yandex.com/images-apphost/this-endpoint-does-not-exist")
            .upload(images.first())
        assertTrue(YandexContract.validId(up.cbirId))
        val (code, html) = get(YandexContract.similarUrl(up))
        assertEquals(200, code); assertTrue(Regex("\"origUrl\":\"").findAll(html).count() >= 10)
        File(out, "live_fallback.json").writeText(JSONObject().put("cbir_id", up.cbirId).put("http", code).toString())
    }

    @Test fun twentyConsecutiveCycles_neverReuseThePreviousImage() {
        val arr = JSONArray(); var prev: String? = null
        for (i in 0 until 20) {
            val img = images[i % images.size]
            val up = YandexUploader(ua, jar).upload(img)
            val (code, html) = get(YandexContract.similarUrl(up))
            val captcha = Regex("showcaptcha|smartcaptcha", RegexOption.IGNORE_CASE).containsMatchIn(html)
            val n = Regex("\"origUrl\":\"").findAll(html).count()
            arr.put(JSONObject().put("cycle", i + 1).put("image", img.name).put("cbir_id", up.cbirId).put("http", code).put("captcha", captcha).put("results", n))
            assertEquals(200, code); assertFalse(captcha); assertTrue(n >= 10)
            assertNotEquals("cycle ${i + 1} reused previous image", prev, hashPart(up.cbirId))
            prev = hashPart(up.cbirId)
            Thread.sleep(1500)
        }
        File(out, "live_20_cycles.json").writeText(arr.toString(1))
    }
}
