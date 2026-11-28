package com.makeuphouse.visualfinderlite.web

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Saves a chosen result image into Pictures/MakeupHouse via MediaStore (no storage permission
 * needed on Android 10+). The bytes are sniffed first: HTML/error pages are rejected, and the
 * file gets the extension/MIME of its REAL format. Unique timestamped names avoid collisions
 * (MediaStore also de-duplicates on its own).
 */
class ImageDownloader(private val context: Context, private val userAgent: String) {
    sealed class Failure(msg: String) : Exception(msg) {
        class NotImage : Failure("not an image")
        class Network(m: String) : Failure(m)
        class Storage(m: String) : Failure(m)
        class Unsupported : Failure("unsupported scheme")
    }

    data class Saved(val uri: Uri, val name: String, val mime: String, val bytes: Long)

    fun download(url: String, referer: String?): Saved {
        return when {
            url.startsWith("data:", ignoreCase = true) -> saveDataUrl(url)
            url.startsWith("https://", true) || url.startsWith("http://", true) -> saveHttp(url, referer, 0)
            else -> throw Failure.Unsupported()
        }
    }

    private fun saveHttp(url: String, referer: String?, depth: Int): Saved {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", userAgent)
            conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            referer?.let { conn.setRequestProperty("Referer", it) }
            runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()?.let { conn.setRequestProperty("Cookie", it) }
            val code = conn.responseCode
            if (code in 300..399) { // follow redirects manually (also http->https), max 5
                val loc = conn.getHeaderField("Location") ?: throw Failure.Network("redirect without location")
                if (depth >= 5) throw Failure.Network("too many redirects")
                return saveHttp(URL(URL(url), loc).toString(), referer, depth + 1)
            }
            if (code != 200) throw Failure.Network("HTTP $code")
            return BufferedInputStream(conn.inputStream).use { save(it) }
        } catch (e: Failure) {
            throw e
        } catch (e: IOException) {
            throw Failure.Network(e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

    private fun saveDataUrl(url: String): Saved {
        val comma = url.indexOf(',')
        if (comma < 0 || !url.substring(0, comma).contains(";base64")) throw Failure.Unsupported()
        val bytes = try { Base64.decode(url.substring(comma + 1), Base64.DEFAULT) } catch (e: IllegalArgumentException) { throw Failure.NotImage() }
        return save(BufferedInputStream(bytes.inputStream()))
    }

    private fun save(input: BufferedInputStream): Saved {
        input.mark(64)
        val head = ByteArray(32)
        val n = input.readNBytesCompat(head)
        input.reset()
        val kind = ImageSniffer.detect(head.copyOf(n)) ?: throw Failure.NotImage()
        val name = ImageSniffer.fileName(kind, System.currentTimeMillis())
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, kind.mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MakeupHouse")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = try { resolver.insert(collection, values) } catch (e: Exception) { null }
            ?: throw Failure.Storage("insert failed")
        try {
            var total = 0L
            resolver.openOutputStream(uri)?.use { os ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val r = input.read(buf); if (r < 0) break
                    total += r
                    if (total > MAX_BYTES) throw Failure.Storage("too large")
                    os.write(buf, 0, r)
                }
            } ?: throw Failure.Storage("open failed")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            return Saved(uri, name, kind.mime, total)
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            if (e is Failure) throw e
            val msg = e.message.orEmpty()
            throw if (msg.contains("ENOSPC") || msg.contains("No space", true)) Failure.Storage("no space")
            else Failure.Network(e.javaClass.simpleName)
        }
    }

    private fun InputStream.readNBytesCompat(b: ByteArray): Int {
        var off = 0
        while (off < b.size) { val r = read(b, off, b.size - off); if (r < 0) break; off += r }
        return off
    }

    companion object { const val MAX_BYTES = 60L * 1024 * 1024 }
}
