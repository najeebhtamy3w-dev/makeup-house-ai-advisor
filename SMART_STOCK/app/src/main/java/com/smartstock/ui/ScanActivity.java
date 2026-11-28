package com.smartstock.ui;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.media.AudioManager;
import android.media.Image;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Size;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.smartstock.R;
import com.smartstock.core.ScanConfirm;
import com.smartstock.data.Settings;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Offline camera barcode reader: Google ML Kit with the BUNDLED model (inside the APK — no
 * download, no network) on CameraX. Much more tolerant than ZXing of glare, shrink-wrap, curved
 * and small codes. High-resolution analysis, continuous autofocus, tap-to-focus, zoom and torch.
 * A 1D code is accepted after two identical reads (ScanConfirm); one result per opening.
 */
public class ScanActivity extends BaseActivity {
    public static final String EXTRA_CODE = "code";

    PreviewView preview;
    Camera camera;
    BarcodeScanner scanner;
    ExecutorService analysis;
    final ScanConfirm confirm = new ScanConfirm(1500);
    boolean torch;
    long openedAt;
    TextView hint;
    ActivityResultLauncher<String> perm;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        perm = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) start();
            else {
                Ui.info(this, "صلاحية الكاميرا", "لا يمكن مسح الباركود بالكاميرا بدون صلاحية الكاميرا. يمكنك كتابة الباركود يدويًا أو استخدام قارئ خارجي.");
                preview.postDelayed(this::finish, 2500);
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(this);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        root.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(new Guide(this), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        hint = Ui.text(this, "وجّه الكاميرا نحو الباركود • المس الشاشة للتركيز • استخدم التكبير للأكواد الصغيرة", 14, R.color.card, true);
        hint.setGravity(Gravity.CENTER);
        hint.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        hint.setShadowLayer(4, 0, 0, Color.BLACK);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        hp.topMargin = Ui.dp(this, 48);
        hint.setPadding(Ui.dp(this, 16), 0, Ui.dp(this, 16), 0);
        root.addView(hint, hp);

        LinearLayout bottom = Ui.vbox(this, 16);
        bottom.setPadding(Ui.dp(this, 16), Ui.dp(this, 8), Ui.dp(this, 16), Ui.dp(this, 28));
        LinearLayout zoomRow = Ui.hbox(this);
        TextView zl = Ui.text(this, "تكبير", 14, R.color.card, true);
        SeekBar zoom = new SeekBar(this);
        zoom.setMax(100);
        zoom.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean u) { if (camera != null) camera.getCameraControl().setLinearZoom(p / 100f); }
            public void onStartTrackingTouch(SeekBar s) {}
            public void onStopTrackingTouch(SeekBar s) {}
        });
        zoomRow.addView(zl);
        zoomRow.addView(zoom, Ui.weight(1));
        bottom.addView(zoomRow);
        LinearLayout bar = Ui.hbox(this);
        MaterialButton flash = Ui.button(this, "الفلاش", Ui.Style.GOLD, R.drawable.ic_flash, v -> toggleTorch());
        MaterialButton close = Ui.button(this, "إغلاق", Ui.Style.OUTLINE, R.drawable.ic_close, v -> finish());
        close.setTextColor(0xFFFFFFFF);
        close.setIconTint(android.content.res.ColorStateList.valueOf(0xFFFFFFFF));
        close.setStrokeColor(android.content.res.ColorStateList.valueOf(0xFFFFFFFF));
        LinearLayout.LayoutParams p1 = Ui.weight(1); p1.setMarginEnd(Ui.dp(this, 10));
        bar.addView(flash, p1);
        bar.addView(close, Ui.weight(1));
        bottom.addView(bar, Ui.matchWrap(this, 8));
        root.addView(bottom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(root);
        applyInsets(root);

        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(
                Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E,
                Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93, Barcode.FORMAT_ITF,
                Barcode.FORMAT_CODABAR, Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX).build());
        analysis = Executors.newSingleThreadExecutor();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) start();
        else perm.launch(Manifest.permission.CAMERA);
    }

    @SuppressLint("ClickableViewAccessibility")
    void start() {
        openedAt = SystemClock.uptimeMillis();
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(this);
        f.addListener(() -> {
            try {
                ProcessCameraProvider provider = f.get();
                Preview pv = new Preview.Builder().build();
                pv.setSurfaceProvider(preview.getSurfaceProvider());
                // high analysis resolution: thin bars of small/far codes stay readable
                ResolutionSelector rs = new ResolutionSelector.Builder()
                        .setResolutionStrategy(new ResolutionStrategy(new Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                        .build();
                ImageAnalysis ia = new ImageAnalysis.Builder().setResolutionSelector(rs)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                ia.setAnalyzer(analysis, this::analyze);
                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, pv, ia);
                torch = Settings.torch(this);
                if (torch && camera.getCameraInfo().hasFlashUnit()) camera.getCameraControl().enableTorch(true);
                focusCenter();
                preview.setOnTouchListener((v, e) -> {
                    if (e.getAction() == MotionEvent.ACTION_UP) focusAt(e.getX(), e.getY());
                    return true;
                });
            } catch (Exception e) {
                Ui.error(this, new Exception("تعذر تشغيل الكاميرا: " + e.getMessage()));
            }
        }, ContextCompat.getMainExecutor(this));
    }

    void focusCenter() { preview.post(() -> focusAt(preview.getWidth() / 2f, preview.getHeight() / 2f)); }

    void focusAt(float x, float y) {
        if (camera == null || preview.getWidth() == 0) return;
        MeteringPoint p = preview.getMeteringPointFactory().createPoint(x, y);
        camera.getCameraControl().startFocusAndMetering(new FocusMeteringAction.Builder(p, FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(3, TimeUnit.SECONDS).build());
    }

    @SuppressLint("UnsafeOptInUsageError")
    void analyze(ImageProxy proxy) {
        Image img = proxy.getImage();
        if (img == null || confirm.isDone() || SystemClock.uptimeMillis() - openedAt < 250) { proxy.close(); return; }
        InputImage in = InputImage.fromMediaImage(img, proxy.getImageInfo().getRotationDegrees());
        scanner.process(in).addOnSuccessListener(list -> handle(list)).addOnCompleteListener(t -> proxy.close());
    }

    void handle(List<Barcode> list) {
        for (Barcode b : list) {
            String v = b.getRawValue();
            int fmt = b.getFormat();
            boolean twoD = fmt == Barcode.FORMAT_QR_CODE || fmt == Barcode.FORMAT_DATA_MATRIX;
            String ok = confirm.offer(v, twoD, SystemClock.uptimeMillis());
            if (ok != null) { deliver(ok); return; }
        }
    }

    void deliver(String code) {
        runOnUiThread(() -> {
            if (isFinishing()) return;
            if (Settings.sound(this)) try { new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).startTone(ToneGenerator.TONE_PROP_BEEP, 120); } catch (Exception ignored) {}
            if (Settings.vibrate(this)) try {
                Vibrator vb = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vb != null) vb.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (Exception ignored) {}
            setResult(RESULT_OK, new Intent().putExtra(EXTRA_CODE, code));
            finish();
        });
    }

    void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torch = !torch;
        camera.getCameraControl().enableTorch(torch);
        Settings.setTorch(this, torch);
    }

    @Override protected void onDestroy() {
        if (analysis != null) analysis.shutdown();
        if (scanner != null) scanner.close();
        super.onDestroy();
    }

    /** Simple aiming frame. */
    static final class Guide extends View {
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Guide(Context c) { super(c); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(6); p.setColor(0xFFDFBF81); }
        @Override protected void onDraw(Canvas c) {
            float w = getWidth() * 0.82f, h = Math.min(getHeight() * 0.22f, w * 0.55f);
            RectF r = new RectF((getWidth() - w) / 2, (getHeight() - h) / 2, (getWidth() + w) / 2, (getHeight() + h) / 2);
            c.drawRoundRect(r, 24, 24, p);
        }
    }
}
