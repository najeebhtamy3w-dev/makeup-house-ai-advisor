package com.smartstock.ui;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Background execution. DB: one thread for all database writes/reads (serialised, no races).
 * WORK: heavy file work (Excel parsing, PDF, export) so the UI never freezes.
 */
public final class Bg {
    private Bg() {}

    public static final ExecutorService DB = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "ss-db"); t.setPriority(Thread.NORM_PRIORITY + 1); return t; });
    public static final ExecutorService WORK = Executors.newSingleThreadExecutor(r -> new Thread(r, "ss-work"));
    static final Handler MAIN = new Handler(Looper.getMainLooper());

    public interface Task<T> { T run() throws Exception; }
    public interface Done<T> { void ok(T t); }
    public interface Fail { void err(Exception e); }

    public static <T> void db(Activity a, Task<T> t, Done<T> d, Fail f) { submit(DB, a, t, d, f); }

    public static <T> void work(Activity a, Task<T> t, Done<T> d, Fail f) { submit(WORK, a, t, d, f); }

    static <T> void submit(ExecutorService ex, Activity a, Task<T> t, Done<T> d, Fail f) {
        ex.execute(() -> {
            try {
                T r = t.run();
                MAIN.post(() -> { if (alive(a) && d != null) d.ok(r); });
            } catch (Exception e) {
                MAIN.post(() -> { if (alive(a)) { if (f != null) f.err(e); else Ui.error(a, e); } });
            } catch (OutOfMemoryError oom) {
                MAIN.post(() -> { if (alive(a)) Ui.error(a, new Exception("الذاكرة غير كافية لإكمال العملية")); });
            }
        });
    }

    public static void main(Runnable r) { MAIN.post(r); }

    static boolean alive(Activity a) { return a == null || (!a.isFinishing() && !a.isDestroyed()); }
}
