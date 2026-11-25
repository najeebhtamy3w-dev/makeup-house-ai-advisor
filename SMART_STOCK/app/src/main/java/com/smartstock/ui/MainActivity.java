package com.smartstock.ui;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;

/** Home: current session statistics + the 8 main actions. */
public class MainActivity extends BaseActivity {

    LinearLayout statsBox;
    ActivityResultLauncher<String[]> pickXlsx;

    static final String[] XLSX_TYPES = {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel", "application/octet-stream"};

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        pickXlsx = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) startActivity(new Intent(this, ImportActivity.class).setData(uri));
        });
        LinearLayout c = scaffold(getString(R.string.app_full_name), false);
        toolbar.setTitle("SMART STOCK — الجرد الذكي");

        MaterialCardView stats = Ui.card(this);
        stats.setCardBackgroundColor(Ui.color(this, R.color.navy));
        statsBox = Ui.box(stats);
        c.addView(stats, Ui.matchWrap(this, 0));

        // 8 actions in a 2-column grid
        Object[][] actions = {
                {"استيراد Excel", R.drawable.ic_import, (Runnable) this::importExcel},
                {"جرد الأصناف", R.drawable.ic_barcode, (Runnable) () -> needSession(CountActivity.class)},
                {"كشف الأصناف", R.drawable.ic_list, (Runnable) () -> needSession(ItemsActivity.class)},
                {"التقارير", R.drawable.ic_report, (Runnable) () -> needSession(ReportsActivity.class)},
                {"تصدير Excel", R.drawable.ic_export, (Runnable) () -> needSession(ExportActivity.class)},
                {"الطباعة", R.drawable.ic_print, (Runnable) () -> needSession(PrintActivity.class)},
                {"جلسات الجرد", R.drawable.ic_sessions, (Runnable) () -> startActivity(new Intent(this, SessionsActivity.class))},
                {"الإعدادات والنسخ الاحتياطي", R.drawable.ic_settings, (Runnable) () -> startActivity(new Intent(this, SettingsActivity.class))},
        };
        LinearLayout row = null;
        for (int i = 0; i < actions.length; i++) {
            if (i % 2 == 0) { row = Ui.hbox(this); c.addView(row, Ui.matchWrap(this, 10)); }
            MaterialCardView tile = tile((String) actions[i][0], (Integer) actions[i][1], i == 1);
            Runnable r = (Runnable) actions[i][2];
            tile.setOnClickListener(v -> r.run());
            LinearLayout.LayoutParams p = Ui.weight(1);
            if (i % 2 == 0) p.setMarginEnd(Ui.dp(this, 10));
            row.addView(tile, p);
        }
        TextView foot = Ui.text(this, "يعمل دون إنترنت • البيانات محفوظة على هذا الهاتف فقط • الإصدار " + appVersion(), 12, R.color.text_muted, false);
        foot.setGravity(Gravity.CENTER);
        foot.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        c.addView(foot, Ui.matchWrap(this, 18));
    }

    MaterialCardView tile(String label, int icon, boolean highlight) {
        MaterialCardView t = Ui.card(this);
        LinearLayout box = Ui.box(t);
        box.setGravity(Gravity.CENTER);
        box.setMinimumHeight(Ui.dp(this, 112));
        if (highlight) t.setCardBackgroundColor(Ui.color(this, R.color.gold));
        ImageView iv = new ImageView(this);
        iv.setImageResource(icon);
        iv.setColorFilter(Ui.color(this, R.color.navy));
        box.addView(iv, new LinearLayout.LayoutParams(Ui.dp(this, 36), Ui.dp(this, 36)));
        TextView tv = Ui.text(this, label, 15, R.color.navy, true);
        tv.setGravity(Gravity.CENTER);
        tv.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        box.addView(tv, Ui.matchWrap(this, 8));
        t.setClickable(true);
        t.setFocusable(true);
        return t;
    }

    @Override protected void onResume() {
        super.onResume();
        refresh();
    }

    void refresh() {
        long sid = activeSessionId();
        Bg.db(this, () -> {
            if (sid < 0) return null;
            Models.Session s = repo.session(sid);
            if (s == null) return null;
            return new Object[]{s, repo.stats(sid)};
        }, r -> render(r == null ? null : (Models.Session) r[0], r == null ? null : (Models.Stats) r[1]), null);
    }

    void render(Models.Session s, Models.Stats st) {
        statsBox.removeAllViews();
        if (s == null) {
            statsBox.addView(Ui.text(this, "لا توجد جلسة جرد نشطة", 18, R.color.gold, true));
            statsBox.addView(Ui.text(this, "استورد ملف Excel لبدء جرد جديد، أو افتح جلسة سابقة.", 14, R.color.card, false));
            return;
        }
        LinearLayout head = Ui.hbox(this);
        TextView name = Ui.text(this, s.name, 18, R.color.gold, true);
        head.addView(name, Ui.weight(1));
        head.addView(Ui.chip(this, s.isFinished() ? "منتهية" : "نشطة", s.isFinished() ? R.color.text_muted : R.color.success, R.color.card));
        statsBox.addView(head);
        String sub = (s.shop.isEmpty() ? "" : s.shop + " • ") + "تاريخ الجرد " + s.countDate;
        statsBox.addView(Ui.text(this, sub, 13, R.color.divider, false));
        LinearProgressIndicator bar = new LinearProgressIndicator(this);
        bar.setMax(Math.max(1, st.items));
        bar.setProgress(st.counted);
        bar.setIndicatorColor(Ui.color(this, R.color.gold));
        bar.setTrackColor(Ui.color(this, R.color.navy_light));
        bar.setTrackThickness(Ui.dp(this, 8));
        bar.setTrackCornerRadius(Ui.dp(this, 4));
        statsBox.addView(bar, Ui.matchWrap(this, 10));
        String cur = s.currency.isEmpty() ? "" : " " + s.currency;
        String[][] cells = {
                {"عدد الأصناف", String.valueOf(st.items)}, {"المجرودة", String.valueOf(st.counted)}, {"المتبقية", String.valueOf(st.uncounted)},
                {"إجمالي الكميات", Num.qty(st.sumQty)}, {"إجمالي القيمة", Num.money(st.sumValue) + cur}, {"نسبة الإنجاز", st.percent() + "%"}};
        LinearLayout r = null;
        for (int i = 0; i < cells.length; i++) {
            if (i % 3 == 0) { r = Ui.hbox(this); statsBox.addView(r, Ui.matchWrap(this, 10)); }
            LinearLayout cell = Ui.vbox(this, 0);
            TextView v = Ui.text(this, cells[i][1], i == 4 ? 15 : 18, R.color.card, true);
            v.setSingleLine(false);
            cell.addView(v);
            cell.addView(Ui.text(this, cells[i][0], 12, R.color.divider, false));
            r.addView(cell, Ui.weight(1));
        }
        if (st.invalidCost > 0)
            statsBox.addView(Ui.text(this, "⚠ " + st.invalidCost + " صنف بتكلفة غير صالحة (لا تدخل في القيمة)", 12, R.color.gold, false), Ui.matchWrap(this, 8));
    }

    void importExcel() {
        pickXlsx.launch(XLSX_TYPES);
    }

    void needSession(Class<?> cls) {
        withActiveSession(s -> startActivity(new Intent(this, cls)));
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent.getData();
        if (u != null) startActivity(new Intent(this, ImportActivity.class).setData(u));
    }
}
