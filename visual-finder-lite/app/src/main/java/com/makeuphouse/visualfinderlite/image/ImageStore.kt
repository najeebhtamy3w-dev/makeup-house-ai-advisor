package com.makeuphouse.visualfinderlite.image

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/**
 * Private, bounded work folder (cache/vf_work). Holds at most: one pending camera capture and
 * one prepared search image. Everything else is deleted by [cleanup]. Nothing here is ever
 * written to shared storage, and the user's own gallery files are never modified.
 */
class ImageStore(private val context: Context) {
    val dir: File = File(context.cacheDir, "vf_work").apply { mkdirs() }

    fun newCaptureFile(): File = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    fun newPreparedFile(): File = File(dir, "search_${System.currentTimeMillis()}.jpg")

    fun uriFor(file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.files", file)

    /** Deletes every work file whose absolute path is not in [keep]. Returns number deleted. */
    fun cleanup(keep: Collection<String?>): Int {
        val keepSet = keep.filterNotNull().toSet()
        var n = 0
        dir.listFiles()?.forEach { f ->
            if (f.absolutePath !in keepSet && f.delete()) n++
        }
        return n
    }

    fun count(): Int = dir.listFiles()?.size ?: 0
}
