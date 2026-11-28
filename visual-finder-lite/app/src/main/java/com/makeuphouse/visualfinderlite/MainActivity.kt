package com.makeuphouse.visualfinderlite

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val vm: MainViewModel by viewModels()

    private lateinit var preview: ImageView
    private lateinit var previewEmpty: TextView
    private lateinit var progress: View
    private lateinit var progressText: TextView
    private lateinit var btnSearch: Button
    private lateinit var btnCapture: Button
    private lateinit var btnGallery: Button
    private lateinit var errorBox: View
    private lateinit var errorText: TextView
    private lateinit var btnManual: Button
    private var shownPath: String? = null

    // System camera app via intent: no CAMERA permission needed, best native quality.
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        vm.onCaptureResult(ok)
    }

    // Android Photo Picker: no storage permission needed.
    private val pickImage = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        vm.onPicked(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        setTheme(R.style.Theme_VisualFinder)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(top = b.top, bottom = b.bottom, left = b.left, right = b.right); insets
        }

        preview = findViewById(R.id.preview)
        previewEmpty = findViewById(R.id.previewEmpty)
        progress = findViewById(R.id.progress)
        progressText = findViewById(R.id.progressText)
        btnSearch = findViewById(R.id.btnSearch)
        btnCapture = findViewById(R.id.btnCapture)
        btnGallery = findViewById(R.id.btnGallery)
        errorBox = findViewById(R.id.errorBox)
        errorText = findViewById(R.id.errorText)
        btnManual = findViewById(R.id.btnManual)

        btnCapture.setOnClickListener { capture() }
        btnGallery.setOnClickListener { pick() }
        btnSearch.setOnClickListener { vm.search() }
        findViewById<Button>(R.id.btnRetry).setOnClickListener { retry() }
        btnManual.setOnClickListener { vm.manualFallback() }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { vm.state.collect(::render) }
                launch { vm.eventFlow.collect(::handle) }
            }
        }
    }

    private fun capture() {
        val probe = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        if (probe.resolveActivity(packageManager) == null) { vm.noCamera(); return }
        try { takePicture.launch(vm.newCaptureUri()) } catch (e: ActivityNotFoundException) { vm.onCaptureResult(false); vm.noCamera() }
    }

    private fun pick() {
        pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    private fun retry() {
        val e = vm.state.value.error
        vm.dismissError()
        when (e) {
            MainViewModel.Error.DECODE, MainViewModel.Error.NO_CAMERA, MainViewModel.Error.STORAGE -> Unit
            else -> vm.search()
        }
    }

    private fun render(s: MainViewModel.UiState) {
        val has = s.imagePath != null
        if (s.imagePath != shownPath) {
            shownPath = s.imagePath
            if (has) {
                val opts = BitmapFactory.Options().apply { inSampleSize = 1 }
                preview.setImageBitmap(BitmapFactory.decodeFile(s.imagePath, opts))
            } else preview.setImageDrawable(null)
        }
        preview.visibility = if (has) View.VISIBLE else View.GONE
        previewEmpty.visibility = if (has) View.GONE else View.VISIBLE
        btnSearch.visibility = if (has) View.VISIBLE else View.GONE
        btnCapture.setText(if (has) R.string.btn_recapture else R.string.btn_capture)
        btnGallery.setText(if (has) R.string.btn_other_image else R.string.btn_gallery)

        val busy = s.busy != null
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        progressText.setText(if (s.busy == MainViewModel.Busy.UPLOADING) R.string.status_uploading else R.string.status_preparing)
        btnSearch.isEnabled = !busy; btnCapture.isEnabled = !busy; btnGallery.isEnabled = !busy

        errorBox.visibility = if (s.error != null) View.VISIBLE else View.GONE
        s.error?.let {
            errorText.setText(when (it) {
                MainViewModel.Error.NO_INTERNET -> R.string.err_no_internet
                MainViewModel.Error.UPLOAD -> R.string.err_upload
                MainViewModel.Error.TIMEOUT -> R.string.err_timeout
                MainViewModel.Error.DECODE -> R.string.err_decode
                MainViewModel.Error.STORAGE -> R.string.err_storage
                MainViewModel.Error.NO_CAMERA -> R.string.err_no_camera
            })
        }
        btnManual.visibility = if (s.canFallback) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.btnRetry).visibility =
            if (s.error == MainViewModel.Error.DECODE || s.error == MainViewModel.Error.NO_CAMERA) View.GONE else View.VISIBLE
    }

    private fun handle(e: MainViewModel.Event) {
        when (e) {
            is MainViewModel.Event.OpenResults -> startActivity(SearchActivity.results(this, e.url))
            is MainViewModel.Event.OpenManual -> startActivity(SearchActivity.manual(this, e.imageUri))
            is MainViewModel.Event.Toast -> Toast.makeText(this, e.resId, Toast.LENGTH_SHORT).show()
        }
    }
}
