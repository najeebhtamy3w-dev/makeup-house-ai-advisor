package com.makeuphouse.visualfinderlite

import android.app.Application
import android.net.Uri
import android.webkit.WebSettings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.makeuphouse.visualfinderlite.image.ImagePreparer
import com.makeuphouse.visualfinderlite.image.ImageStore
import com.makeuphouse.visualfinderlite.util.Network
import com.makeuphouse.visualfinderlite.yandex.YandexContract
import com.makeuphouse.visualfinderlite.yandex.YandexUploader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** State survives rotation (ViewModel) and process death (SavedStateHandle). */
class MainViewModel(app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {

    enum class Busy { PREPARING, UPLOADING }
    enum class Error { NO_INTERNET, UPLOAD, TIMEOUT, DECODE, STORAGE, NO_CAMERA }

    data class UiState(
        val imagePath: String? = null,
        val busy: Busy? = null,
        val error: Error? = null,
        val canFallback: Boolean = false,
    )

    sealed class Event {
        data class OpenResults(val url: String) : Event()
        data class OpenManual(val imageUri: Uri) : Event()
        data class OpenLens(val imageUri: Uri) : Event()
        data class Toast(val resId: Int) : Event()
    }

    val store = ImageStore(app)
    private val _state = MutableStateFlow(UiState(imagePath = saved.get<String>(KEY_IMAGE)?.takeIf { File(it).exists() }))
    val state: StateFlow<UiState> = _state
    private val events = Channel<Event>(Channel.BUFFERED)
    val eventFlow = events.receiveAsFlow()
    private var job: Job? = null

    /** Upload cache: one prepared file -> one Yandex upload. A new photo always gets a new file. */
    private var uploadedFor: String? = saved.get(KEY_UPLOADED_FOR)
    private var uploadedUrl: String? = saved.get(KEY_UPLOADED_URL)

    var pendingCapture: String?
        get() = saved.get(KEY_CAPTURE)
        set(v) { saved[KEY_CAPTURE] = v }

    init {
        // Bounded temp storage: on every start, drop anything that is not the current image or a pending capture.
        viewModelScope.launch(Dispatchers.IO) { store.cleanup(listOf(_state.value.imagePath, pendingCapture)) }
    }

    fun newCaptureUri(): Uri {
        val f = store.newCaptureFile()
        pendingCapture = f.absolutePath
        return store.uriFor(f)
    }

    fun onCaptureResult(success: Boolean) {
        val path = pendingCapture
        pendingCapture = null
        if (path == null) return
        val f = File(path)
        if (!success || !f.exists() || f.length() == 0L) {
            f.delete(); events.trySend(Event.Toast(R.string.msg_capture_cancelled)); return
        }
        prepare(store.uriFor(f), deleteAfter = f)
    }

    fun onPicked(uri: Uri?) {
        if (uri == null) { events.trySend(Event.Toast(R.string.msg_pick_cancelled)); return }
        prepare(uri, deleteAfter = null)
    }

    fun noCamera() = _state.tryEmitError(Error.NO_CAMERA)

    private fun prepare(source: Uri, deleteAfter: File?) {
        job?.cancel()
        _state.value = _state.value.copy(busy = Busy.PREPARING, error = null, canFallback = false)
        job = viewModelScope.launch {
            val out = store.newPreparedFile()
            val result = withContext(Dispatchers.IO) {
                runCatching { ImagePreparer.prepare(getApplication<Application>().contentResolver, source, out); out }
                    .also { deleteAfter?.delete() }
            }
            result.onSuccess { file ->
                saved[KEY_IMAGE] = file.absolutePath
                withContext(Dispatchers.IO) { store.cleanup(listOf(file.absolutePath, pendingCapture)) }
                _state.value = UiState(imagePath = file.absolutePath)
            }.onFailure { e ->
                out.delete()
                _state.value = _state.value.copy(busy = null,
                    error = if (e is ImagePreparer.StorageFailed) Error.STORAGE else Error.DECODE)
            }
        }
    }

    fun search() {
        val path = _state.value.imagePath ?: return
        if (_state.value.busy != null) return
        val app = getApplication<Application>()
        if (!Network.isOnline(app)) { _state.tryEmitError(Error.NO_INTERNET, fallback = false); return }
        if (uploadedFor == path && uploadedUrl != null) { events.trySend(Event.OpenResults(uploadedUrl!!)); return }
        _state.value = _state.value.copy(busy = Busy.UPLOADING, error = null, canFallback = false)
        job = viewModelScope.launch {
            val r = withContext(Dispatchers.IO) {
                runCatching {
                    val ua = WebSettings.getDefaultUserAgent(app)
                    YandexContract.similarUrl(YandexUploader(ua).upload(File(path)))
                }
            }
            r.onSuccess { url ->
                uploadedFor = path; uploadedUrl = url
                saved[KEY_UPLOADED_FOR] = path; saved[KEY_UPLOADED_URL] = url
                _state.value = _state.value.copy(busy = null)
                events.send(Event.OpenResults(url))
            }.onFailure { e ->
                val err = when (e) {
                    is YandexUploader.Failure.Offline -> Error.NO_INTERNET
                    is YandexUploader.Failure.Timeout -> Error.TIMEOUT
                    else -> Error.UPLOAD
                }
                _state.value = _state.value.copy(busy = null, error = err, canFallback = true)
            }
        }
    }

    fun manualFallback() {
        val path = _state.value.imagePath ?: return
        events.trySend(Event.OpenManual(store.uriFor(File(path))))
    }

    /** Google Lens hand-off (no upload by this app: Google app / Google page does it on the user's tap). */
    fun lens() {
        val path = _state.value.imagePath ?: return
        if (!Network.isOnline(getApplication())) { _state.tryEmitError(Error.NO_INTERNET, fallback = false); return }
        events.trySend(Event.OpenLens(store.uriFor(File(path))))
    }

    fun dismissError() { _state.value = _state.value.copy(error = null) }

    private fun MutableStateFlow<UiState>.tryEmitError(e: Error, fallback: Boolean = false) {
        value = value.copy(busy = null, error = e, canFallback = fallback)
    }

    companion object {
        private const val KEY_IMAGE = "image"
        private const val KEY_CAPTURE = "capture"
        private const val KEY_UPLOADED_FOR = "uploadedFor"
        private const val KEY_UPLOADED_URL = "uploadedUrl"
    }
}
