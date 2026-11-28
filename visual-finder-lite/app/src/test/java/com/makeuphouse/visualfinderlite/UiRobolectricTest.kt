package com.makeuphouse.visualfinderlite

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.net.ConnectivityManager
import android.net.Uri
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.makeuphouse.visualfinderlite.image.ImagePreparer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File

/**
 * Runs the real activities on a simulated Android 16 (API 36) device with Arabic locale and a
 * Galaxy-S22-Ultra-like screen (384x823dp, xxhdpi). Native graphics => real image decoding and
 * real screenshots (saved to app/build/vfl-evidence/screens/).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "ar-w384dp-h823dp-xxhdpi")
class UiRobolectricTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val outDir = File(System.getProperty("vfl.out") ?: "build/vfl-evidence", "screens").apply { mkdirs() }

    /** FileProvider caches its path strategy statically; Robolectric uses a new data dir per test in one JVM. */
    @org.junit.Before fun resetFileProviderCache() {
        runCatching {
            val f = androidx.core.content.FileProvider::class.java.getDeclaredField("sCache"); f.isAccessible = true
            (f.get(null) as MutableMap<*, *>).clear()
        }
    }

    private fun shot(v: View, name: String) {
        val b = Bitmap.createBitmap(v.width.coerceAtLeast(1), v.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        v.draw(Canvas(b)); File(outDir, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun idle() { repeat(30) { ShadowLooper.idleMainLooper(); Thread.sleep(40) } }

    private fun waitFor(cond: () -> Boolean) { val end = System.currentTimeMillis() + 15000; while (!cond() && System.currentTimeMillis() < end) idle() }

    /** Writes a real JPEG (product-like) into a file and returns a file:// uri. */
    private fun sampleImage(name: String, w: Int = 3000, h: Int = 4000): Uri {
        val src = System.getProperty("vfl.images")?.takeIf { it.isNotEmpty() }?.let { File(it, "mascara.jpg") }?.takeIf { it.exists() }
        val f = File(app.cacheDir, name)
        if (src != null) src.copyTo(f, overwrite = true) else {
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); b.eraseColor(0xFF7A1E35.toInt())
            f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        }
        return Uri.fromFile(f)
    }

    @Test fun mainScreen_emptyState_isArabicRtl() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            sc.onActivity { a ->
                val root = a.findViewById<View>(R.id.root)
                assertEquals(View.LAYOUT_DIRECTION_RTL, a.findViewById<View>(R.id.btnCapture).layoutDirection)
                assertEquals("تصوير المنتج", a.findViewById<Button>(R.id.btnCapture).text.toString())
                assertEquals("اختيار صورة من المعرض", a.findViewById<Button>(R.id.btnGallery).text.toString())
                assertEquals(View.GONE, a.findViewById<View>(R.id.btnSearch).visibility)
                assertEquals(View.VISIBLE, a.findViewById<View>(R.id.previewEmpty).visibility)
                shot(root.rootView, "01_main_empty")
            }
        }
    }

    @Test fun pickImage_showsPreview_searchButton_survivesRotation_andCleansTemp() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            lateinit var vm: MainViewModel
            sc.onActivity { a -> vm = ViewModelProvider(a)[MainViewModel::class.java]; vm.onPicked(sampleImage("big.jpg")) }
            waitFor { vm.state.value.imagePath != null }
            val first = vm.state.value.imagePath!!
            sc.onActivity { a ->
                idle()
                assertEquals(View.VISIBLE, a.findViewById<View>(R.id.btnSearch).visibility)
                assertEquals("البحث عن صور مشابهة", a.findViewById<Button>(R.id.btnSearch).text.toString())
                assertEquals("إعادة التصوير", a.findViewById<Button>(R.id.btnCapture).text.toString())
                assertNotNull(a.findViewById<ImageView>(R.id.preview).drawable)
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(first, o)
                assertTrue("downscaled to <=1600", maxOf(o.outWidth, o.outHeight) <= 1600)
                shot(a.findViewById<View>(R.id.root).rootView, "02_main_with_image")
            }
            sc.recreate() // rotation / activity re-creation
            sc.onActivity { a ->
                idle()
                val vm2 = ViewModelProvider(a)[MainViewModel::class.java]
                assertEquals(first, vm2.state.value.imagePath)
                assertEquals(View.VISIBLE, a.findViewById<View>(R.id.btnSearch).visibility)
            }
            // replace image several times -> temp folder stays bounded
            repeat(5) { i ->
                sc.onActivity { a -> ViewModelProvider(a)[MainViewModel::class.java].onPicked(sampleImage("p$i.jpg")) }
                waitFor { vm.state.value.imagePath != null && vm.state.value.busy == null }
            }
            waitFor { vm.store.count() <= 1 }
            assertNotEquals(first, vm.state.value.imagePath)
            assertFalse("old prepared file deleted", File(first).exists())
            assertTrue("bounded temp files", vm.store.count() <= 2)
        }
    }

    @Test fun corruptImage_showsArabicError_noCrash() {
        val bad = File(app.cacheDir, "broken.jpg").apply { writeText("<html>not an image</html>") }
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            lateinit var vm: MainViewModel
            sc.onActivity { a -> vm = ViewModelProvider(a)[MainViewModel::class.java]; vm.onPicked(Uri.fromFile(bad)) }
            waitFor { vm.state.value.error != null }
            sc.onActivity { a ->
                idle()
                assertEquals(MainViewModel.Error.DECODE, vm.state.value.error)
                assertEquals(View.VISIBLE, a.findViewById<View>(R.id.errorBox).visibility)
                assertTrue(a.findViewById<TextView>(R.id.errorText).text.contains("تعذّر قراءة"))
                shot(a.findViewById<View>(R.id.root).rootView, "03_error_corrupt")
            }
        }
    }

    @Test fun cancelPick_andCancelCapture_doNotCrash() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            sc.onActivity { a ->
                val vm = ViewModelProvider(a)[MainViewModel::class.java]
                vm.onPicked(null)
                val uri = vm.newCaptureUri(); assertNotNull(uri)
                vm.onCaptureResult(false)
                assertNull(vm.pendingCapture); assertNull(vm.state.value.imagePath)
            }
        }
    }

    @Test fun search_withoutInternet_showsErrorAndRetry() {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        shadowOf(cm).setDefaultNetworkActive(false)
        shadowOf(cm).setActiveNetworkInfo(null)
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            lateinit var vm: MainViewModel
            sc.onActivity { a -> vm = ViewModelProvider(a)[MainViewModel::class.java]; vm.onPicked(sampleImage("n.jpg")) }
            waitFor { vm.state.value.imagePath != null }
            sc.onActivity { a ->
                vm.search(); idle()
                assertEquals(MainViewModel.Error.NO_INTERNET, vm.state.value.error)
                assertEquals(View.VISIBLE, a.findViewById<View>(R.id.btnRetry).visibility)
                shot(a.findViewById<View>(R.id.root).rootView, "04_error_offline")
            }
        }
    }

    @Test fun searchScreen_loadsSimilarUrl_withHardenedSettings() {
        val url = "https://yandex.com/images/touch/search?rpt=imageview&cbir_page=similar&url=x&cbir_id=1%2Fabcdefghij"
        ActivityScenario.launch<SearchActivity>(SearchActivity.results(app, url)).use { sc ->
            sc.onActivity { a ->
                val web = a.findViewById<WebView>(R.id.web)
                assertEquals(url, shadowOf(web).lastLoadedUrl)
                assertTrue(web.settings.javaScriptEnabled)
                assertFalse(web.settings.allowFileAccess)
                assertFalse(web.settings.allowContentAccess)
                assertEquals("رجوع", a.findViewById<Button>(R.id.navBack).text.toString())
                shot(a.findViewById<View>(R.id.root).rootView, "05_search_toolbar")
            }
        }
    }

    @Test fun manualMode_autoAttachesProductImageOnce() {
        val img = Uri.parse("content://com.makeuphouse.visualfinderlite.files/work/search_1.jpg")
        ActivityScenario.launch<SearchActivity>(SearchActivity.manual(app, img)).use { sc ->
            sc.onActivity { a ->
                val web = a.findViewById<WebView>(R.id.web)
                assertEquals("https://yandex.com/images/touch/", shadowOf(web).lastLoadedUrl)
                val chrome = shadowOf(web).webChromeClient!!
                var got: Array<Uri>? = null
                val cb = ValueCallback<Array<Uri>> { got = it }
                val params = object : WebChromeClient.FileChooserParams() {
                    override fun getMode() = MODE_OPEN; override fun getAcceptTypes() = arrayOf("image/*")
                    override fun isCaptureEnabled() = false; override fun getTitle() = null
                    override fun getFilenameHint() = null; override fun createIntent() = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).setType("image/*")
                }
                assertTrue(chrome.onShowFileChooser(web, cb, params))
                assertArrayEquals(arrayOf(img), got)
                // second time: normal system chooser (no silent re-use)
                got = null
                assertTrue(chrome.onShowFileChooser(web, cb, params))
                assertNull(got)
            }
        }
    }

    /** Robolectric's default network has no INTERNET capability; give the simulated phone a working connection. */
    private fun online() {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val caps = org.robolectric.shadows.ShadowNetworkCapabilities.newInstance()
        shadowOf(caps).addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, caps)
    }

    private fun withImage(sc: ActivityScenario<MainActivity>): MainViewModel {
        lateinit var vm: MainViewModel
        sc.onActivity { a -> vm = ViewModelProvider(a)[MainViewModel::class.java]; vm.onPicked(sampleImage("lens.jpg")) }
        waitFor { vm.state.value.imagePath != null }
        return vm
    }

    @Test fun lensButton_withGoogleApp_sharesPhotoToLens() {
        shadowOf(app.packageManager).installPackage(android.content.pm.PackageInfo().apply { packageName = "com.google.android.googlequicksearchbox" })
        online()
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            val vm = withImage(sc)
            sc.onActivity { a ->
                idle()
                val b = a.findViewById<Button>(R.id.btnLens)
                assertEquals(View.VISIBLE, b.visibility)
                assertEquals("بحث في Google Lens (يشمل إنستغرام)", b.text.toString())
                shot(a.findViewById<View>(R.id.root).rootView, "08_main_with_lens_button")
                b.performClick(); idle()
                val i = shadowOf(a).nextStartedActivity
                assertEquals(android.content.Intent.ACTION_SEND, i.action)
                assertEquals("com.google.android.googlequicksearchbox", i.`package`)
                assertEquals("image/jpeg", i.type)
                val stream = androidx.core.content.IntentCompat.getParcelableExtra(i, android.content.Intent.EXTRA_STREAM, Uri::class.java)!!
                assertEquals("content", stream.scheme)
                assertTrue(stream.toString().endsWith(File(vm.state.value.imagePath!!).name))
                assertTrue(i.flags and android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
                val clip = app.getSystemService(android.content.ClipboardManager::class.java).primaryClip!!
                assertEquals("instagram", clip.getItemAt(0).text.toString())
            }
        }
    }

    @Test fun lensButton_withoutGoogleApp_opensGoogleImagesWithAutoAttach() {
        online()
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            withImage(sc)
            sc.onActivity { a ->
                idle()
                a.findViewById<Button>(R.id.btnLens).performClick(); idle()
                val i = shadowOf(a).nextStartedActivity
                assertEquals(SearchActivity::class.java.name, i.component!!.className)
                assertEquals("https://images.google.com/", i.getStringExtra("url"))
                assertTrue(i.getStringExtra("hint")!!.contains("instagram"))
                ActivityScenario.launch<SearchActivity>(i).use { s2 ->
                    s2.onActivity { sa ->
                        val web = sa.findViewById<WebView>(R.id.web)
                        assertEquals("https://images.google.com/", shadowOf(web).lastLoadedUrl)
                        assertEquals(View.VISIBLE, sa.findViewById<View>(R.id.banner).visibility)
                        var got: Array<Uri>? = null
                        val params = object : WebChromeClient.FileChooserParams() {
                            override fun getMode() = MODE_OPEN; override fun getAcceptTypes() = arrayOf("image/*")
                            override fun isCaptureEnabled() = false; override fun getTitle() = null
                            override fun getFilenameHint() = null; override fun createIntent() = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).setType("image/*")
                        }
                        assertTrue(shadowOf(web).webChromeClient!!.onShowFileChooser(web, { got = it }, params))
                        assertEquals("content", got!!.single().scheme)
                        shot(sa.findViewById<View>(R.id.root).rootView, "09_lens_web_fallback")
                    }
                }
            }
        }
    }

    @Test fun lensButton_offline_showsError() {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            val vm = withImage(sc)
            shadowOf(cm).setDefaultNetworkActive(false); shadowOf(cm).setActiveNetworkInfo(null)
            sc.onActivity { a ->
                a.findViewById<Button>(R.id.btnLens).performClick(); idle()
                assertEquals(MainViewModel.Error.NO_INTERNET, vm.state.value.error)
                assertNull(shadowOf(a).nextStartedActivity)
            }
        }
    }

    @Test fun preparer_stripsMetadata_andKeepsQuality() {
        val src = sampleImage("q.jpg")
        val out = File(app.cacheDir, "q_out.jpg")
        ImagePreparer.prepare(app.contentResolver, src, out)
        val head = out.readBytes().copyOf(64)
        assertEquals(0xFF.toByte(), head[0]); assertEquals(0xD8.toByte(), head[1])
        val s = String(out.readBytes(), Charsets.ISO_8859_1)
        assertFalse("no EXIF/GPS block", s.contains("Exif\u0000\u0000") && s.contains("GPS"))
    }
}
