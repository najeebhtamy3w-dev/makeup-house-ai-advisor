package com.makeuphouse.visualfinderlite

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.View
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.makeuphouse.visualfinderlite.web.ImageDownloader
import com.makeuphouse.visualfinderlite.web.ImageSniffer
import com.makeuphouse.visualfinderlite.yandex.YandexContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Shows the ORIGINAL Yandex pages (no redesign) inside a hardened WebView and adds what a bare
 * WebView lacks: saving images (Yandex's ↓ button opens the original image in a new tab, which a
 * WebView would otherwise ignore), long-press "save image", file-chooser auto-attach for the
 * manual fallback, CAPTCHA hint, error page, back/reload/open-in-browser/home.
 */
class SearchActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var banner: TextView
    private lateinit var errorBox: View
    private lateinit var pageProgress: ProgressBar
    private var pendingImage: Uri? = null       // manual mode: image to auto-attach once
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var ua: String   // read on the main thread only

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_search)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.updatePadding(top = b.top, bottom = b.bottom, left = b.left, right = b.right); insets
        }
        web = findViewById(R.id.web)
        banner = findViewById(R.id.banner)
        errorBox = findViewById(R.id.errorBox)
        pageProgress = findViewById(R.id.pageProgress)

        web.settings.apply {
            javaScriptEnabled = true          // required by Yandex Images
            domStorageEnabled = true
            allowFileAccess = false           // security: no file:// access
            allowContentAccess = false
            setSupportMultipleWindows(true)   // to catch target=_blank (Yandex "download" button)
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            builtInZoomControls = true; displayZoomControls = false
        }
        ua = web.settings.userAgentString
        // No addJavascriptInterface: no JS bridge at all.
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener(Downloads())
        web.setOnLongClickListener { onLongPress() }

        findViewById<Button>(R.id.navBack).setOnClickListener { goBack() }
        findViewById<Button>(R.id.navReload).setOnClickListener { reload() }
        findViewById<Button>(R.id.btnErrorRetry).setOnClickListener { reload() }
        findViewById<Button>(R.id.navBrowser).setOnClickListener { openExternal(web.url ?: startUrl()) }
        findViewById<Button>(R.id.navHome).setOnClickListener { finish() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })

        val manual = intent.getStringExtra(EXTRA_MODE) == MODE_MANUAL
        if (manual) {
            pendingImage = if (savedInstanceState?.getBoolean(KEY_CONSUMED) == true) null
                else IntentCompat.getParcelableExtra(intent, EXTRA_IMAGE, Uri::class.java)
            showBanner(intent.getStringExtra(EXTRA_HINT) ?: getString(R.string.hint_manual))
        } else showBanner(getString(R.string.hint_results))

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(startUrl())
    }

    private fun startUrl(): String = intent.getStringExtra(EXTRA_URL) ?: YandexContract.HOME_URL

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
        outState.putBoolean(KEY_CONSUMED, pendingImage == null)
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null); fileCallback = null
        (web.parent as? android.view.ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    private fun goBack() { if (web.canGoBack()) web.goBack() else finish() }
    private fun reload() { errorBox.visibility = View.GONE; if (web.url == null) web.loadUrl(startUrl()) else web.reload() }

    private fun showBanner(text: String, onClick: (() -> Unit)? = null) {
        banner.text = text; banner.visibility = View.VISIBLE
        banner.setOnClickListener { if (onClick != null) onClick() else banner.visibility = View.GONE }
    }

    private fun openExternal(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (e: ActivityNotFoundException) { Toast.makeText(this, R.string.dl_unsupported, Toast.LENGTH_SHORT).show() }
    }

    // ---------- Saving images ----------

    private fun onLongPress(): Boolean {
        val hit = web.hitTestResult
        val url = hit.extra ?: return false
        if (hit.type == WebView.HitTestResult.IMAGE_TYPE || hit.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
            AlertDialog.Builder(this)
                .setTitle(R.string.dl_title).setMessage(R.string.dl_message)
                .setPositiveButton(R.string.dl_menu_save) { _, _ -> download(url) }
                .setNegativeButton(R.string.dl_cancel, null).show()
            return true
        }
        return false
    }

    /** A link Yandex opens in a new tab: original image ("download" ↓ / "open image") or a source site. */
    private fun onNewWindow(url: String) {
        lifecycleScope.launch {
            val isImage = ImageSniffer.urlLooksLikeImage(url) || withContext(Dispatchers.IO) { headIsImage(url) }
            if (isImage) {
                AlertDialog.Builder(this@SearchActivity)
                    .setTitle(R.string.dl_title).setMessage(R.string.dl_message)
                    .setPositiveButton(R.string.dl_save) { _, _ -> download(url) }
                    .setNeutralButton(R.string.dl_open_page) { _, _ -> web.loadUrl(url) }
                    .setNegativeButton(R.string.dl_cancel, null).show()
            } else if (url.startsWith("https://") || url.startsWith("http://")) {
                web.loadUrl(url)
            } else handleSpecialScheme(url)
        }
    }

    private fun headIsImage(url: String): Boolean = runCatching {
        if (!url.startsWith("http")) return false
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "HEAD"; c.connectTimeout = 6000; c.readTimeout = 6000
            c.setRequestProperty("User-Agent", ua)
            c.contentType.orEmpty().startsWith("image/")
        } finally { c.disconnect() }
    }.getOrDefault(false)

    private fun download(url: String) {
        Toast.makeText(this, R.string.dl_in_progress, Toast.LENGTH_SHORT).show()
        val referer = web.url
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { ImageDownloader(applicationContext, ua).download(url, referer) } }
            r.onSuccess { saved ->
                Toast.makeText(this@SearchActivity, R.string.dl_done, Toast.LENGTH_LONG).show()
                showBanner(getString(R.string.dl_done) + "  •  " + getString(R.string.dl_view) + " ›") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(saved.uri, saved.mime)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    } catch (_: ActivityNotFoundException) { }
                }
            }.onFailure { e ->
                val msg = when (e) {
                    is ImageDownloader.Failure.NotImage -> R.string.dl_not_image
                    is ImageDownloader.Failure.Storage -> R.string.err_storage
                    is ImageDownloader.Failure.Unsupported -> R.string.dl_unsupported
                    else -> R.string.dl_failed
                }
                AlertDialog.Builder(this@SearchActivity).setMessage(msg).setPositiveButton(android.R.string.ok, null).show()
            }
        }
    }

    private inner class Downloads : DownloadListener {
        override fun onDownloadStart(url: String, userAgent: String?, cd: String?, mime: String?, length: Long) {
            if (mime?.startsWith("image/") == true || ImageSniffer.urlLooksLikeImage(url) || url.startsWith("data:image")) download(url)
            else if (url.startsWith("blob:")) Toast.makeText(this@SearchActivity, R.string.dl_unsupported, Toast.LENGTH_LONG).show()
            else openExternal(url)
        }
    }

    // ---------- Navigation ----------

    private fun handleSpecialScheme(url: String): Boolean {
        try {
            val i = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, Uri.parse(url))
            // Hardening: never let a web page target a specific/internal component.
            i.addCategory(Intent.CATEGORY_BROWSABLE); i.component = null; i.selector = null
            startActivity(i)
        } catch (e: Exception) {
            if (url.startsWith("intent:")) runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }
                .getOrNull()?.takeIf { it.startsWith("https://") }?.let { web.loadUrl(it) }
        }
        return true
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            return when (request.url.scheme?.lowercase()) {
                "https", "http" -> false
                "about", "data", "blob", "javascript" -> false
                else -> handleSpecialScheme(url)
            }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            errorBox.visibility = View.GONE
            if (YandexContract.isCaptchaUrl(url)) showBanner(getString(R.string.captcha_hint))
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) errorBox.visibility = View.VISIBLE
        }
        // onReceivedSslError intentionally NOT overridden: the default cancels the load (no SSL bypass).
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) {
            pageProgress.progress = p
            pageProgress.visibility = if (p >= 100) View.INVISIBLE else View.VISIBLE
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false // block pop-ups not started by the user
            // Short-lived WebView that only captures the target URL, then is discarded.
            val catcher = WebView(this@SearchActivity)
            catcher.webViewClient = object : WebViewClient() {
                private var done = false
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean = capture(v, r.url.toString())
                override fun onPageStarted(v: WebView, url: String?, f: Bitmap?) { if (url != null && url != "about:blank") capture(v, url) }
                private fun capture(v: WebView, url: String): Boolean {
                    if (!done) { done = true; onNewWindow(url); v.post { v.stopLoading(); v.destroy() } }
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = catcher
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            val auto = pendingImage
            if (auto != null) { // manual-assisted mode: attach the product photo automatically, once
                pendingImage = null
                callback.onReceiveValue(arrayOf(auto))
                return true
            }
            fileCallback = callback
            return try { chooser.launch(params.createIntent()); true }
            catch (e: ActivityNotFoundException) { fileCallback = null; callback.onReceiveValue(null); true }
        }
    }

    companion object {
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_URL = "url"
        private const val EXTRA_IMAGE = "image"
        private const val MODE_RESULTS = "results"
        private const val MODE_MANUAL = "manual"
        private const val KEY_CONSUMED = "consumed"
        private const val EXTRA_HINT = "hint"

        fun results(c: Context, url: String) = Intent(c, SearchActivity::class.java)
            .putExtra(EXTRA_MODE, MODE_RESULTS).putExtra(EXTRA_URL, url)

        /** Opens [url] (Yandex or Google Images) and auto-attaches [image] the first time the page asks for a file. */
        fun manual(c: Context, image: Uri, url: String = YandexContract.HOME_URL, hint: String? = null) =
            Intent(c, SearchActivity::class.java)
            .putExtra(EXTRA_MODE, MODE_MANUAL).putExtra(EXTRA_IMAGE, image).putExtra(EXTRA_URL, url)
            .apply { if (hint != null) putExtra(EXTRA_HINT, hint) }
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
