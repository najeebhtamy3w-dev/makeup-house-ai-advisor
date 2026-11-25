package com.smartstock.ui;

import android.app.Activity;
import java.util.concurrent.TimeUnit;

/** Public helpers for tests in other packages. */
public final class UiFlowShots {
    private UiFlowShots() {}
    public static void shot(Activity a, String name) { UiFlowTest.shot(a, name); }
    public static void drain() throws Exception {
        Bg.DB.submit(() -> {}).get(30, TimeUnit.SECONDS);
        Bg.WORK.submit(() -> {}).get(60, TimeUnit.SECONDS);
    }
}
