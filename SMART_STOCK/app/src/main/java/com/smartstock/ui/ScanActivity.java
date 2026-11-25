package com.smartstock.ui;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.client.android.BeepManager;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.camera.CameraSettings;
import com.smartstock.R;
import com.smartstock.data.Settings;

import java.util.Arrays;
import java.util.List;

/**
 * Offline camera barcode reader (ZXing, fully on-device — no model download, no network).
 * Returns exactly one code per opening; later frames are ignored, so a code can't be read twice.
 */
public class ScanActivity extends BaseActivity {
    public static final String EXTRA_CODE = "code";

    static final List<BarcodeFormat> FORMATS = Arrays.asList(
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF,
            BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX);

    DecoratedBarcodeView view;
    BeepManager beep;
    boolean done, torch;
    long openedAt;
    ActivityResultLauncher<String> perm;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        perm = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) start();
            else {
                Ui.info(this, "صلاحية الكاميرا", "لا يمكن مسح الباركود بالكاميرا بدون صلاحية الكاميرا. يمكنك كتابة الباركود يدويًا أو استخدام قارئ خارجي.");
                view.postDelayed(this::finish, 2500);
            }
        });
        FrameLayout root = new FrameLayout(this);
        view = new DecoratedBarcodeView(this);
        view.setStatusText("وجّه الكاميرا نحو الباركود");
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout bar = Ui.hbox(this);
        bar.setPadding(Ui.dp(this, 16), Ui.dp(this, 16), Ui.dp(this, 16), Ui.dp(this, 28));
        MaterialButton flash = Ui.button(this, "الفلاش", Ui.Style.GOLD, R.drawable.ic_flash, v -> toggleTorch());
        MaterialButton close = Ui.button(this, "إغلاق", Ui.Style.OUTLINE, R.drawable.ic_close, v -> finish());
        close.setTextColor(0xFFFFFFFF);
        close.setIconTint(android.content.res.ColorStateList.valueOf(0xFFFFFFFF));
        close.setStrokeColor(android.content.res.ColorStateList.valueOf(0xFFFFFFFF));
        LinearLayout.LayoutParams p1 = Ui.weight(1); p1.setMarginEnd(Ui.dp(this, 10));
        bar.addView(flash, p1);
        bar.addView(close, Ui.weight(1));
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(bar, bp);
        setContentView(root);
        applyInsets(root);

        beep = new BeepManager(this);
        beep.setBeepEnabled(Settings.sound(this));
        beep.setVibrateEnabled(Settings.vibrate(this));

        view.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(FORMATS));
        CameraSettings cs = view.getBarcodeView().getCameraSettings();
        cs.setAutoFocusEnabled(true);
        cs.setContinuousFocusEnabled(true);
        cs.setBarcodeSceneModeEnabled(true);
        view.getBarcodeView().setCameraSettings(cs);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) start();
        else perm.launch(Manifest.permission.CAMERA);
    }

    void start() {
        openedAt = SystemClock.uptimeMillis();
        torch = Settings.torch(this);
        if (torch) view.setTorchOn();
        view.decodeContinuous(callback);
        view.resume();
    }

    final BarcodeCallback callback = r -> {
        if (done || r == null || r.getText() == null || r.getText().trim().isEmpty()) return;
        if (SystemClock.uptimeMillis() - openedAt < 250) return; // ignore a stale frame right after opening
        done = true;                                             // exactly one result per opening
        view.pause();
        beep.playBeepSoundAndVibrate();
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_CODE, r.getText().trim()));
        finish();
    };

    void toggleTorch() {
        torch = !torch;
        if (torch) view.setTorchOn(); else view.setTorchOff();
        Settings.setTorch(this, torch);
    }

    @Override protected void onResume() {
        super.onResume();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED && !done) view.resume();
    }

    @Override protected void onPause() {
        super.onPause();
        view.pause();
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        return view.onKeyDown(keyCode, event) || super.onKeyDown(keyCode, event);
    }
}
