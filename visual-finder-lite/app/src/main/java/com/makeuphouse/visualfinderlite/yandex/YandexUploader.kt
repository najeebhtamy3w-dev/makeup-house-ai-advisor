package com.makeuphouse.visualfinderlite.yandex

import android.webkit.CookieManager
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/**
 * Sends the prepared image to Yandex — and only to Yandex — when the user taps "search".
 * Uses the same endpoints the Yandex Images web page uses, so the result is an ordinary
 * Yandex search page. Cookies are shared with the in-app WebView so a CAPTCHA solved there
 * also covers the upload.
 */
class YandexUploader(
    private val userAgent: String,
    private val cookies: CookieJar = WebViewCookieJar,
    private val primaryUrl: String = YandexContract.UPLOAD_URL,
    private val legacyUrl: String = YandexContract.LEGACY_UPLOAD_URL,
) {
    /** Abstracted so the exact production code can be exercised against live Yandex from JVM tests. */
    interface CookieJar { fun get(url: String): String?; fun put(url: String, setCookie: String) }

    object WebViewCookieJar : CookieJar {
        override fun get(url: String): String? = runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()
        override fun put(url: String, setCookie: String) { runCatching { CookieManager.getInstance().apply { setCookie(url, setCookie); flush() } } }
    }

    sealed class Failure(msg: String, cause: Throwable? = null) : Exception(msg, cause) {
        class Offline(c: Throwable) : Failure("offline", c)
        class Timeout(c: Throwable) : Failure("timeout", c)
        class Rejected(msg: String) : Failure(msg)
    }

    fun upload(file: File): YandexContract.Upload {
        val bytes = file.readBytes()
        var last: Throwable? = null
        try {
            post(primaryUrl, "image/jpeg", bytes)?.let { body ->
                YandexContract.parseUploadResponse(body)?.let { return it }
            }
        } catch (e: Failure) { if (e !is Failure.Rejected) throw e; last = e }
        // Fallback endpoint (multipart "upfile"), used if the primary one changes shape.
        val boundary = "----vfl" + System.nanoTime()
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"upfile\"; filename=\"product.jpg\"\r\n" +
            "Content-Type: image/jpeg\r\n\r\n"
        val tail = "\r\n--$boundary--\r\n"
        val multipart = head.toByteArray() + bytes + tail.toByteArray()
        try {
            post(legacyUrl, "multipart/form-data; boundary=$boundary", multipart)?.let { body ->
                YandexContract.parseLegacyResponse(body)?.let { return it }
            }
        } catch (e: Failure) { if (e !is Failure.Rejected) throw e; last = e }
        throw (last as? Failure) ?: Failure.Rejected("unrecognised response")
    }

    private fun post(url: String, contentType: String, body: ByteArray): String? {
        val conn = (URL(url).openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 45_000
            conn.doOutput = true
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", userAgent)
            conn.setRequestProperty("Content-Type", contentType)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Origin", YandexContract.HOST)
            conn.setRequestProperty("Referer", YandexContract.HOME_URL)
            cookies.get(YandexContract.HOST)?.let { conn.setRequestProperty("Cookie", it) }
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            conn.headerFields["Set-Cookie"]?.forEach { cookies.put(YandexContract.HOST, it) }
            if (code != 200) throw Failure.Rejected("HTTP $code")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: SocketTimeoutException) {
            throw Failure.Timeout(e)
        } catch (e: UnknownHostException) {
            throw Failure.Offline(e)
        } catch (e: Failure) {
            throw e
        } catch (e: IOException) {
            throw Failure.Rejected(e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

}
