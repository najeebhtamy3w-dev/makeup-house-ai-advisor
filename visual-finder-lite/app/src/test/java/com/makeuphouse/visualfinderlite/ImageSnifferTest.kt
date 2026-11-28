package com.makeuphouse.visualfinderlite

import com.makeuphouse.visualfinderlite.image.ScaleMath
import com.makeuphouse.visualfinderlite.web.ImageSniffer
import org.junit.Assert.*
import org.junit.Test

class ImageSnifferTest {
    private fun bytes(vararg v: Int) = ByteArray(16) { if (it < v.size) v[it].toByte() else 0 }
    private fun ascii(s: String) = (s.toByteArray() + ByteArray(16)).copyOf(16)

    @Test fun detectsRealFormats() {
        assertEquals(ImageSniffer.JPEG, ImageSniffer.detect(bytes(0xFF, 0xD8, 0xFF, 0xE0)))
        assertEquals(ImageSniffer.PNG, ImageSniffer.detect(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)))
        assertEquals(ImageSniffer.WEBP, ImageSniffer.detect(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")))
        assertEquals(ImageSniffer.GIF, ImageSniffer.detect(ascii("GIF89a")))
        assertEquals(ImageSniffer.AVIF, ImageSniffer.detect(ascii("\u0000\u0000\u0000\u001CftypavifXX")))
        assertEquals(ImageSniffer.HEIC, ImageSniffer.detect(ascii("\u0000\u0000\u0000\u0018ftypheicXX")))
    }

    @Test fun rejectsHtmlPretendingToBeJpg() {
        assertNull(ImageSniffer.detect(ascii("<!DOCTYPE html><html>")))
        assertNull(ImageSniffer.detect(ascii("{\"error\":1}")))
        assertNull(ImageSniffer.detect(ByteArray(4)))
    }

    @Test fun urlHeuristics() {
        assertTrue(ImageSniffer.urlLooksLikeImage("https://incibeauty.com/photos/9/e/d/9ed.jpg"))
        assertTrue(ImageSniffer.urlLooksLikeImage("https://x.com/a.WEBP?w=1"))
        assertTrue(ImageSniffer.urlLooksLikeImage("https://avatars.mds.yandex.net/get-mpic/5289362/img_id1.png/orig"))
        assertTrue(ImageSniffer.urlLooksLikeImage("https://avatars.mds.yandex.net/i?id=abc-1-1"))
        assertFalse(ImageSniffer.urlLooksLikeImage("https://drdelemichael.com/page.html?utm=1"))
    }

    @Test fun uniqueFileNamesWithRealExtension() {
        val a = ImageSniffer.fileName(ImageSniffer.PNG, 1_795_862_765_000L)
        val b = ImageSniffer.fileName(ImageSniffer.PNG, 1_795_862_765_001L)
        assertTrue(a.matches(Regex("""MH_\d{8}_\d{6}_\d{3}\.png""")))
        assertNotEquals(a, b)
    }

    @Test fun scaleMath() {
        assertEquals(1200 to 1600, ScaleMath.target(3000, 4000))
        assertEquals(1600 to 1200, ScaleMath.target(12000, 9000)) // 108 MP
        assertEquals(800 to 600, ScaleMath.target(800, 600))      // never upscales
        assertEquals(1600 to 1, ScaleMath.target(10000, 2))
    }
}
