package com.makeuphouse.visualfinderlite.web

/**
 * Decides whether downloaded bytes are really an image (magic numbers), so the app never
 * saves an HTML error page with a ".jpg" name. Pure JVM; unit tested.
 */
object ImageSniffer {
    data class Kind(val mime: String, val ext: String)

    val JPEG = Kind("image/jpeg", "jpg")
    val PNG = Kind("image/png", "png")
    val WEBP = Kind("image/webp", "webp")
    val GIF = Kind("image/gif", "gif")
    val AVIF = Kind("image/avif", "avif")
    val HEIC = Kind("image/heic", "heic")
    val BMP = Kind("image/bmp", "bmp")

    fun detect(b: ByteArray): Kind? {
        if (b.size < 12) return null
        fun at(i: Int, vararg v: Int) = v.indices.all { (b[i + it].toInt() and 0xFF) == v[it] }
        fun ascii(i: Int, s: String) = s.indices.all { b[i + it].toInt().toChar() == s[it] }
        return when {
            at(0, 0xFF, 0xD8, 0xFF) -> JPEG
            at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) -> PNG
            ascii(0, "RIFF") && ascii(8, "WEBP") -> WEBP
            ascii(0, "GIF87a") || ascii(0, "GIF89a") -> GIF
            ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis")) -> AVIF
            ascii(4, "ftyp") && (ascii(8, "heic") || ascii(8, "heix") || ascii(8, "mif1") || ascii(8, "msf1")) -> HEIC
            ascii(0, "BM") -> BMP
            else -> null
        }
    }

    private val IMAGE_EXT = Regex("""\.(jpe?g|png|webp|gif|avif|heic|bmp)(\?|#|$)""", RegexOption.IGNORE_CASE)

    /** Cheap guess from the URL alone (used before a network check). */
    fun urlLooksLikeImage(url: String): Boolean {
        val path = url.substringBefore('#')
        return IMAGE_EXT.containsMatchIn(path) ||
            path.contains("avatars.mds.yandex.net/get-") ||
            path.contains("avatars.mds.yandex.net/i?id=") ||
            Regex("""im\d-tub-\w+\.yandex\.net/i\?id=""").containsMatchIn(path)
    }

    /** Safe, unique file name: MH_20261128_104512_123.jpg */
    fun fileName(kind: Kind, nowMillis: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = nowMillis }
        fun p(n: Int, w: Int = 2) = n.toString().padStart(w, '0')
        return "MH_${c.get(1)}${p(c.get(2) + 1)}${p(c.get(5))}_${p(c.get(11))}${p(c.get(12))}${p(c.get(13))}_${p(c.get(14), 3)}.${kind.ext}"
    }
}
