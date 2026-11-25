package com.smartstock.ui;

import android.app.Activity;
import java.util.concurrent.TimeUnit;

/** Public helpers for tests in other packages. */
public final class UiFlowShots {
    private UiFlowShots() {}
    public static void shot(Activity a, String name) { UiFlowTest.shot(a, name); }
    public static void shotDialog(android.app.Dialog d, String name) {
        String dir = System.getProperty("smartstock.out", "");
        if (dir.isEmpty()) return;
        java.io.File f = new java.io.File(dir, "ui_screens"); f.mkdirs();
        android.view.View v = d.getWindow().getDecorView();
        int w = 1000, h = 2000;
        v.measure(android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.AT_MOST));
        v.layout(0, 0, w, v.getMeasuredHeight());
        android.graphics.Bitmap b = android.graphics.Bitmap.createBitmap(w, Math.max(1, v.getMeasuredHeight()), android.graphics.Bitmap.Config.ARGB_8888);
        b.eraseColor(0xFF9E9E9E);
        v.draw(new android.graphics.Canvas(b));
        try (java.io.FileOutputStream o = new java.io.FileOutputStream(new java.io.File(f, name + ".png"))) { b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, o); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    public static void drain() throws Exception {
        Bg.DB.submit(() -> {}).get(30, TimeUnit.SECONDS);
        Bg.WORK.submit(() -> {}).get(60, TimeUnit.SECONDS);
    }
}
