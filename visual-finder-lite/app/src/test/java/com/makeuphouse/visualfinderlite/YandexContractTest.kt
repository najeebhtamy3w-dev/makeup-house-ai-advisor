package com.makeuphouse.visualfinderlite

import com.makeuphouse.visualfinderlite.yandex.YandexContract
import org.junit.Assert.*
import org.junit.Test

class YandexContractTest {
    // Shape captured from the live endpoint on 2026-11-28 (trimmed).
    private val apphost = """{"cbir_id":"2212615/Bg2uyO4Uwyl-CzYpj3KvSw2850","namespace":"images-cbir",
        "sizes":{"orig":{"path":"https://avatars.mds.yandex.net/get-images-cbir/2212615/Bg2uyO4Uwyl-CzYpj3KvSw2850/orig","width":562,"height":750}}}"""
    private val legacy = """{"cnt":"pageview_candidate","blocks":[{"name":{"block":"b-page_type_search-by-image__link","mods":{}},
        "params":{"originalImageUrl":"https://avatars.mds.yandex.net/get-images-cbir/7096342/dCYRIhTSuk6n3zxZzVuJFA2848/orig","cbirId":"7096342/dCYRIhTSuk6n3zxZzVuJFA2848","bundles":[]},"html":""}]}"""

    @Test fun parsesApphostUpload() {
        val u = YandexContract.parseUploadResponse(apphost)!!
        assertEquals("2212615/Bg2uyO4Uwyl-CzYpj3KvSw2850", u.cbirId)
        assertTrue(u.imageUrl.endsWith("/orig"))
    }

    @Test fun parsesLegacyUpload() {
        val u = YandexContract.parseLegacyResponse(legacy)!!
        assertEquals("7096342/dCYRIhTSuk6n3zxZzVuJFA2848", u.cbirId)
    }

    @Test fun parsesLegacyQueryStringShape() {
        val body = """{"blocks":[{"params":{"url":"cbir_id=111%2FabcdefghIJ12&rpt=imageview&url=https%3A%2F%2Favatars.mds.yandex.net%2Fget-images-cbir%2F111%2FabcdefghIJ12%2Forig"}}]}"""
        val u = YandexContract.parseLegacyResponse(body)!!
        assertEquals("111/abcdefghIJ12", u.cbirId)
        assertEquals("https://avatars.mds.yandex.net/get-images-cbir/111/abcdefghIJ12/orig", u.imageUrl)
    }

    @Test fun rejectsGarbageAndCaptchaHtml() {
        assertNull(YandexContract.parseUploadResponse("<html>captcha</html>"))
        assertNull(YandexContract.parseUploadResponse("""{"cbir_id":"","sizes":{}}"""))
        assertNull(YandexContract.parseUploadResponse("""{"cbir_id":"../../etc","sizes":{"orig":{"path":"https://x"}}}"""))
        assertNull(YandexContract.parseUploadResponse("""{"cbir_id":"1/abcdefghij","sizes":{"orig":{"path":"http://insecure"}}}"""))
        assertNull(YandexContract.parseLegacyResponse("{}"))
    }

    @Test fun buildsSimilarUrlForTheNewImageOnly() {
        val u = YandexContract.parseUploadResponse(apphost)!!
        val url = YandexContract.similarUrl(u)
        assertTrue(url.startsWith("https://yandex.com/images/touch/search?"))
        assertTrue(url.contains("cbir_page=similar"))
        assertTrue(url.contains("rpt=imageview"))
        assertTrue(url.contains("cbir_id=2212615%2FBg2uyO4Uwyl-CzYpj3KvSw2850"))
        assertTrue(url.contains("url=https%3A%2F%2Favatars.mds.yandex.net%2Fget-images-cbir%2F2212615%2FBg2uyO4Uwyl-CzYpj3KvSw2850%2Forig"))
        // never the reference/sample id from the brief
        assertFalse(url.contains("jhaX-K6p-LNE9Y7d0VL9wQ718"))
        val other = YandexContract.similarUrl(YandexContract.Upload("1/abcdefghIJKL", "https://avatars.mds.yandex.net/a/orig"))
        assertNotEquals(url, other)
    }

    @Test fun hostAndCaptchaDetection() {
        assertTrue(YandexContract.isYandexHost("yandex.com"))
        assertTrue(YandexContract.isYandexHost("avatars.mds.yandex.net"))
        assertFalse(YandexContract.isYandexHost("yandex.com.evil.org"))
        assertTrue(YandexContract.isCaptchaUrl("https://yandex.com/showcaptcha?cc=1&retpath=x"))
        assertFalse(YandexContract.isCaptchaUrl("https://yandex.com/images/touch/search?rpt=imageview"))
    }
}
