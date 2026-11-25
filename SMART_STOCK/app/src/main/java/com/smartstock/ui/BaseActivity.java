package com.smartstock.ui;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import androidx.core.widget.NestedScrollView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.android.material.appbar.MaterialToolbar;
import com.smartstock.R;
import com.smartstock.data.Db;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;
import com.smartstock.data.Settings;

import java.util.Locale;

/** Arabic RTL everywhere (independent of the phone language), shared toolbar and helpers. */
public abstract class BaseActivity extends AppCompatActivity {

    protected Repository repo;
    protected MaterialToolbar toolbar;

    @Override protected void attachBaseContext(Context base) {
        Configuration cfg = new Configuration(base.getResources().getConfiguration());
        Locale ar = new Locale("ar");
        cfg.setLocale(ar);
        cfg.setLayoutDirection(ar);
        super.attachBaseContext(base.createConfigurationContext(cfg));
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        repo = new Repository(Db.get(this));
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    }

    /** Root = toolbar + scrollable content column. Returns the content column. */
    protected LinearLayout scaffold(String title, boolean back) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        toolbar = toolbar(title, back);
        root.addView(toolbar);
        NestedScrollView sv = new NestedScrollView(this);
        sv.setFillViewport(true);
        LinearLayout content = Ui.vbox(this, 14);
        sv.addView(content, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        applyInsets(root);
        return content;
    }

    protected MaterialToolbar toolbar(String title, boolean back) {
        MaterialToolbar t = new MaterialToolbar(this);
        t.setBackgroundColor(Ui.color(this, R.color.navy));
        t.setTitle(title);
        t.setTitleTextColor(0xFFFFFFFF);
        t.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        if (back) {
            t.setNavigationIcon(R.drawable.ic_back);
            t.setNavigationIconTint(0xFFFFFFFF);
            t.setNavigationContentDescription("رجوع");
            t.setNavigationOnClickListener(v -> getOnBackPressedDispatcher().onBackPressed());
        }
        return t;
    }

    protected void applyInsets(View root) {
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            v.setPadding(s.left, s.top, s.right, s.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    protected long activeSessionId() { return Settings.activeSession(this); }

    /** Loads the active session on the DB thread; shows a message when there is none. */
    protected void withActiveSession(Bg.Done<Models.Session> d) {
        long sid = activeSessionId();
        Bg.db(this, () -> sid < 0 ? null : repo.session(sid), s -> {
            if (s == null) Ui.info(this, "لا توجد جلسة جرد نشطة", "ابدأ باستيراد ملف Excel أو افتح جلسة من «جلسات الجرد».");
            else d.ok(s);
        }, null);
    }

    protected String appVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
