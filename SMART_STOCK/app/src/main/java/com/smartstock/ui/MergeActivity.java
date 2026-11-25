package com.smartstock.ui;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.data.Repository;
import com.smartstock.data.Settings;
import com.smartstock.data.Workflows;

import java.io.File;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Multi-phone consolidation: pick the Excel files exported by each phone, merge them into one
 * read-only report session and print it as if it were one file, with one grand total.
 */
public class MergeActivity extends BaseActivity {

    final List<Repository.MergeInput> inputs = new ArrayList<>();
    LinearLayout content, list;
    TextInputLayout name, shop, date, cur;
    ActivityResultLauncher<String[]> pick;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        pick = registerForActivityResult(new ActivityResultContracts.OpenMultipleDocuments(), this::add);
        content = scaffold("طباعة مجمّعة لعدة جوالات", true);

        MaterialCardView info = Ui.card(this);
        LinearLayout ib = Ui.box(info);
        ib.addView(Ui.text(this, "كيف تعمل؟", 16, R.color.navy, true));
        ib.addView(Ui.text(this, "1) في كل جوال: «تصدير Excel» بعد انتهاء الجرد.\n2) انقل الملفات إلى هذا الجوال (واتساب، بلوتوث، كابل...).\n3) أضف الملفات هنا ثم اضغط «دمج وإنشاء التقرير».\n\nتُطبع الأصناف كلها في كشف واحد بإجمالي كلي واحد، مع صفحة تفاصيل لكل ملف. لا تتأثر جلسة الجرد الحالية.", 14, R.color.text, false));
        content.addView(info);

        content.addView(Ui.button(this, "إضافة ملفات Excel", Ui.Style.GOLD, R.drawable.ic_import,
                v -> pick.launch(MainActivity.XLSX_TYPES)), Ui.matchWrap(this, 12));
        list = Ui.vbox(this, 0);
        content.addView(list, Ui.matchWrap(this, 6));

        MaterialCardView form = Ui.card(this);
        LinearLayout fb = Ui.box(form);
        fb.addView(Ui.text(this, "بيانات التقرير المجمّع", 16, R.color.navy, true));
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        name = Ui.field(this, "اسم التقرير", "جرد مجمّع " + today, false);
        shop = Ui.field(this, "اسم المحل (اختياري)", getSharedPreferences(Settings.FILE, 0).getString("last_shop", ""), false);
        date = Ui.field(this, "تاريخ الجرد", today, false);
        cur = Ui.field(this, "اسم العملة (للعرض فقط)", Settings.currency(this), false);
        fb.addView(name, Ui.matchWrap(this, 10));
        fb.addView(shop, Ui.matchWrap(this, 8));
        fb.addView(date, Ui.matchWrap(this, 8));
        fb.addView(cur, Ui.matchWrap(this, 8));
        content.addView(form, Ui.matchWrap(this, 12));
        content.addView(Ui.button(this, "دمج وإنشاء التقرير", Ui.Style.SUCCESS, R.drawable.ic_print, v -> merge()), Ui.matchWrap(this, 12));
        render();
    }

    String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        String p = u.getLastPathSegment();
        return p == null ? "ملف.xlsx" : p.substring(p.lastIndexOf('/') + 1);
    }

    void add(List<Uri> uris) {
        if (uris == null || uris.isEmpty()) return;
        Ui.Progress p = Ui.progress(this, "جاري قراءة الملفات…");
        Bg.work(this, () -> {
            List<String> errors = new ArrayList<>();
            int i = 0;
            for (Uri u : uris) {
                String fn = displayName(u);
                int k = ++i;
                Bg.main(() -> p.set("جاري قراءة " + fn + " (" + k + " / " + uris.size() + ")", k, uris.size()));
                File staged = null;
                try (InputStream in = getContentResolver().openInputStream(u)) {
                    if (in == null) throw new java.io.IOException("تعذر فتح الملف");
                    staged = Workflows.stage(this, in);
                    Repository.MergeInput m;
                    synchronized (inputs) { m = Workflows.readForMerge(staged, fn, new ArrayList<>(inputs)); }
                    synchronized (inputs) { inputs.add(m); }
                } catch (Exception e) {
                    errors.add("• " + fn + ": " + (e.getMessage() == null ? e.toString() : e.getMessage()));
                } finally {
                    if (staged != null) //noinspection ResultOfMethodCallIgnored
                        staged.delete();
                }
            }
            return errors;
        }, errors -> {
            p.dismiss();
            render();
            if (!errors.isEmpty()) Ui.info(this, "بعض الملفات لم تُضف", String.join("\n\n", errors));
        }, e -> { p.dismiss(); Ui.error(this, e); });
    }

    void render() {
        list.removeAllViews();
        if (inputs.isEmpty()) {
            list.addView(Ui.text(this, "لم تُضف ملفات بعد.", 14, R.color.text_muted, false));
            return;
        }
        int total = 0;
        for (int i = 0; i < inputs.size(); i++) {
            Repository.MergeInput m = inputs.get(i);
            total += m.result.rows.size();
            MaterialCardView c = Ui.card(this);
            LinearLayout box = Ui.box(c);
            LinearLayout head = Ui.hbox(this);
            head.addView(Ui.text(this, (i + 1) + ". " + m.label, 15, R.color.navy, true), Ui.weight(1));
            final int idx = i;
            head.addView(Ui.button(this, "إزالة", Ui.Style.TEXT, R.drawable.ic_close, v -> { inputs.remove(idx); render(); }));
            box.addView(head);
            box.addView(Ui.text(this, Workflows.mergeInfo(m), 13, R.color.text, false));
            list.addView(c, Ui.matchWrap(this, 6));
        }
        TextView sum = Ui.text(this, "المجموع: " + inputs.size() + " ملفات • " + total + " صنف", 14, R.color.success, true);
        list.addView(sum, Ui.matchWrap(this, 6));
    }

    void merge() {
        if (inputs.size() < 2) { Ui.info(this, "الدمج", "أضف ملفين على الأقل."); return; }
        String n = Ui.edit(name).getText().toString().trim();
        if (n.isEmpty()) { Ui.edit(name).setError("اكتب اسم التقرير"); return; }
        String sh = Ui.edit(shop).getText().toString().trim(), d = Ui.edit(date).getText().toString().trim(), c = Ui.edit(cur).getText().toString().trim();
        Ui.Progress p = Ui.progress(this, "جاري دمج الملفات…");
        List<Repository.MergeInput> copy = new ArrayList<>(inputs);
        Bg.db(this, () -> Workflows.createMerged(this, n, sh, d, c, copy,
                (done, total) -> Bg.main(() -> p.set("جاري الدمج… " + done + " / " + total, done, total))), sid -> {
            p.dismiss();
            startActivity(new Intent(this, PrintActivity.class).putExtra(PrintActivity.EXTRA_SESSION, sid));
            finish();
        }, e -> { p.dismiss(); Ui.error(this, e); });
    }
}
