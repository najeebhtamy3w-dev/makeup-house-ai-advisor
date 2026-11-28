package com.makeuphouse.visualfinderlite.image

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Creates the copy that is sent to Yandex:
 *  - ImageDecoder handles JPEG/PNG/WEBP/HEIF/AVIF(API 31+) and applies EXIF orientation itself,
 *  - decodes directly at the target size (no full-resolution bitmap -> no OOM on 50/108 MP photos),
 *  - re-encodes as JPEG q=92, which also strips EXIF/GPS metadata (privacy).
 * The source image is only read, never modified.
 */
object ImagePreparer {
    class DecodeFailed(cause: Throwable) : Exception(cause)
    class StorageFailed(cause: Throwable) : Exception(cause)

    fun prepare(resolver: ContentResolver, source: Uri, out: File): Bitmap {
        val bmp = try {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, source)) { decoder, info, _ ->
                val (w, h) = ScaleMath.target(info.size.width, info.size.height)
                decoder.setTargetSize(w, h)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.isMutableRequired = false
            }
        } catch (e: IOException) {
            throw DecodeFailed(e)
        } catch (e: IllegalArgumentException) {
            throw DecodeFailed(e)
        } catch (e: OutOfMemoryError) {
            throw DecodeFailed(e)
        }
        try {
            val tmp = File(out.parentFile, out.name + ".part")
            FileOutputStream(tmp).use { os ->
                if (!bmp.compress(Bitmap.CompressFormat.JPEG, 92, os)) throw IOException("compress failed")
                os.fd.sync()
            }
            if (!tmp.renameTo(out)) throw IOException("rename failed")
        } catch (e: IOException) {
            out.delete()
            throw StorageFailed(e)
        }
        return bmp
    }
}
