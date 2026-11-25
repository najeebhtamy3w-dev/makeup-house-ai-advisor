package com.smartstock.ui;

import android.app.DatePickerDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.ColumnMap;
import com.smartstock.core.Field;
import com.smartstock.core.XlsxImporter;
import com.smartstock.core.XlsxPackage;
import com.smartstock.data.Repository;
import com.smartstock.data.Settings;
import com.smartstock.data.Workflows;

import java.io.File;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Import wizard: stage a private copy -> choose sheet -> detect columns by NAME (manual mapping if
 * uncertain) -> streaming read with progress -> summary -> create the session.
 */
public class ImportActivity extends BaseActivity {

    LinearLayout content;
    File staged;
    String fileName = "ملف.xlsx";
    XlsxPackage pkg;
    XlsxPackage.SheetRef sheet;
    XlsxImporter.HeaderScan scan;
    XlsxImporter.Result result;
    volatile boolean cancelled;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        content = scaffold("استيراد ملف Excel", true);
        Uri uri = incomingUri(getIntent());
        if (uri == null) { Ui.info(this, "استيراد", "لم يتم تحديد ملف."); finish(); return; }
        fileName = displayName(uri);
        Ui.Progress p = Ui.progress(this, "جاري نسخ الملف وقراءة بنيته…");
        Bg.work(this, () -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new java.io.IOException("تعذر فتح الملف");
                staged = Workflows.stage(this, in);
            }
            if (fileName.toLowerCase(Locale.ROOT).endsWith(".xls")) throw new java.io.IOException("صيغة xls القديمة غير مدعومة. احفظ الملف في Excel بصيغة xlsx ثم أعد الاستيراد.");
            pkg = new XlsxPackage(staged, Workflows.PARSER);
            return pkg.defaultSheet();
        }, s -> { p.dismiss(); if (s != null) chooseSheet(s); else askSheet(); }, e -> { p.dismiss(); fail(e); });
    }

    static Uri incomingUri(Intent i) {
        if (i == null) return null;
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) return i.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            //noinspection deprecation
            return i.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        return i.getData();
    }

    String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        String p = u.getLastPathSegment();
        return p == null ? "ملف.xlsx" : p.substring(p.lastIndexOf('/') + 1);
    }

    void fail(Exception e) {
        new MaterialAlertDialogBuilder(this).setTitle("تعذر استيراد الملف").setMessage(e.getMessage() == null ? e.toString() : e.getMessage())
                .setCancelable(false).setPositiveButton("حسنًا", (d, w) -> finish()).show();
    }

    void askSheet() {
        String[] names = new String[pkg.sheets.size()];
        for (int i = 0; i < names.length; i++) names[i] = pkg.sheets.get(i).name + (pkg.sheets.get(i).hidden ? " (مخفية)" : "");
        new MaterialAlertDialogBuilder(this).setTitle("لم يتم العثور على ورقة «تصدير بلاس» — اختر ورقة الأصناف")
                .setCancelable(false)
                .setItems(names, (d, w) -> chooseSheet(pkg.sheets.get(w)))
                .setNegativeButton("إلغاء", (d, w) -> finish()).show();
    }

    void chooseSheet(XlsxPackage.SheetRef s) {
        sheet = s;
        Ui.Progress p = Ui.progress(this, "جاري التعرف على الأعمدة…");
        Bg.work(this, () -> XlsxImporter.scanHeader(pkg, s), h -> {
            p.dismiss();
            scan = h;
            if (h.match.needsManualMapping) mapping(h.match.map, h.match.problems);
            else readAll(h.match.map);
        }, e -> { p.dismiss(); fail(e); });
    }

    // ------------------------------------------------------------------ manual column mapping (once)

    void mapping(ColumnMap suggested, List<String> problems) {
        LinearLayout box = Ui.vbox(this, 18);
        TextView why = Ui.text(this, "تعذر تحديد بعض الأعمدة بصورة مؤكدة:\n• " + String.join("\n• ", problems) + "\n\nحدد العمود المناسب لكل حقل:", 14, R.color.text, false);
        box.addView(why);
        List<String> labels = new ArrayList<>();
        labels.add("— غير موجود —");
        for (int c = 0; c < scan.headers.size(); c++) {
            String h = scan.headers.get(c);
            labels.add(ColumnMap.colLetters(c) + " — " + (h == null || h.isEmpty() ? "(بدون عنوان)" : h));
        }
        List<Spinner> spinners = new ArrayList<>();
        for (Field f : Field.values()) {
            TextView l = Ui.text(this, f.label + (f.required ? " *" : (f == Field.TOTAL ? " (يُنشأ تلقائيًا إن لم يوجد)" : " (اختياري)")), 14, R.color.navy, true);
            box.addView(l, Ui.matchWrap(this, 10));
            Spinner sp = new Spinner(this);
            sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
            Integer col = suggested.get(f);
            sp.setSelection(col == null ? 0 : col + 1);
            box.addView(sp);
            spinners.add(sp);
        }
        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        sv.addView(box);
        androidx.appcompat.app.AlertDialog d = new MaterialAlertDialogBuilder(this).setTitle("ربط الأعمدة")
                .setView(sv).setCancelable(false)
                .setPositiveButton("متابعة", null)
                .setNegativeButton("إلغاء", (x, w) -> finish()).create();
        d.setOnShowListener(x -> d.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            ColumnMap m = new ColumnMap();
            Field[] fs = Field.values();
            for (int i = 0; i < fs.length; i++) {
                int pos = spinners.get(i).getSelectedItemPosition();
                if (pos > 0) m.set(fs[i], pos - 1);
            }
            String err = m.validate();
            if (err != null) { Ui.info(this, "ربط الأعمدة", err); return; }
            d.dismiss();
            readAll(m);
        }));
        d.show();
    }

    // ------------------------------------------------------------------ read

    void readAll(ColumnMap map) {
        Ui.Progress p = Ui.progress(this, "جاري قراءة الأصناف…");
        Bg.work(this, () -> XlsxImporter.read(pkg, sheet, scan.headerRow, map, scan.headers, new XlsxImporter.Progress() {
            @Override public void onRows(int n) { Bg.main(() -> p.set("جاري قراءة الأصناف… " + n + " صف", 0, 0)); }
            @Override public boolean isCancelled() { return cancelled; }
        }), r -> { p.dismiss(); result = r; summary(); }, e -> { p.dismiss(); fail(e); });
    }

    // ------------------------------------------------------------------ summary + session details

    void summary() {
        content.removeAllViews();
        com.google.android.material.card.MaterialCardView card = Ui.card(this);
        LinearLayout box = Ui.box(card);
        box.addView(Ui.text(this, "ملخص الاستيراد", 18, R.color.navy, true));
        box.addView(Ui.divider(this));
        String[] lines = Workflows.summaryText(result, fileName).split("\n");
        for (String l : lines) {
            int i = l.indexOf(": ");
            if (i > 0) box.addView(Ui.kv(this, l.substring(0, i), l.substring(i + 2), l.startsWith("عدد الأصناف")));
        }
        content.addView(card);
        if (!result.warnings.isEmpty()) {
            com.google.android.material.card.MaterialCardView w = Ui.card(this);
            w.setStrokeColor(Ui.color(this, R.color.warning));
            LinearLayout wb = Ui.box(w);
            wb.addView(Ui.text(this, "تنبيهات", 16, R.color.warning, true));
            for (String s : result.warnings) wb.addView(Ui.text(this, "• " + s, 14, R.color.text, false), Ui.matchWrap(this, 4));
            content.addView(w, Ui.matchWrap(this, 12));
        }

        com.google.android.material.card.MaterialCardView form = Ui.card(this);
        LinearLayout fb = Ui.box(form);
        fb.addView(Ui.text(this, "بيانات جلسة الجرد", 16, R.color.navy, true));
        String base = fileName.replaceAll("(?i)\\.xlsx?$", "");
        TextInputLayout name = Ui.field(this, "اسم جلسة الجرد", "جرد " + base, false);
        TextInputLayout shop = Ui.field(this, "اسم المحل (اختياري)", getSharedPreferences(Settings.FILE, 0).getString("last_shop", ""), false);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        TextInputLayout date = Ui.field(this, "تاريخ الجرد", today, false);
        Ui.edit(date).setFocusable(false);
        Ui.edit(date).setOnClickListener(v -> pickDate(Ui.edit(date)));
        TextInputLayout cur = Ui.field(this, "اسم العملة في التقرير (اختياري — بدون تحويل)", Settings.currency(this), false);
        MaterialSwitch dec = new MaterialSwitch(this);
        dec.setText("السماح بالكميات العشرية في هذه الجلسة");
        fb.addView(name, Ui.matchWrap(this, 10));
        fb.addView(shop, Ui.matchWrap(this, 8));
        fb.addView(date, Ui.matchWrap(this, 8));
        fb.addView(cur, Ui.matchWrap(this, 8));
        fb.addView(dec, Ui.matchWrap(this, 8));
        content.addView(form, Ui.matchWrap(this, 12));

        content.addView(Ui.button(this, "بدء الجرد", Ui.Style.SUCCESS, R.drawable.ic_check, v -> {
            String n = Ui.edit(name).getText().toString().trim();
            if (n.isEmpty()) { Ui.edit(name).setError("اكتب اسم الجلسة"); return; }
            Repository.SessionDraft d = new Repository.SessionDraft();
            d.name = n;
            d.shop = Ui.edit(shop).getText().toString().trim();
            d.countDate = Ui.edit(date).getText().toString().trim();
            d.currency = Ui.edit(cur).getText().toString().trim();
            d.allowDecimal = dec.isChecked();
            d.fileName = fileName;
            create(d);
        }), Ui.matchWrap(this, 14));
        content.addView(Ui.button(this, "إلغاء", Ui.Style.OUTLINE, 0, v -> finish()), Ui.matchWrap(this, 4));
    }

    void pickDate(android.widget.EditText e) {
        Calendar c = Calendar.getInstance();
        try { c.setTime(new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(e.getText().toString())); } catch (Exception ignored) {}
        new DatePickerDialog(this, (v, y, m, d) -> e.setText(String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, d)),
                c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show();
    }

    void create(Repository.SessionDraft d) {
        Ui.Progress p = Ui.progress(this, "جاري إنشاء جلسة الجرد…");
        int total = result.rows.size();
        Bg.db(this, () -> Workflows.createSession(this, staged, result, d,
                (done, n) -> Bg.main(() -> p.set("جاري حفظ الأصناف… " + done + " / " + n, done, n))), sid -> {
            p.dismiss();
            Settings.setActiveSession(this, sid);
            getSharedPreferences(Settings.FILE, 0).edit().putString("last_shop", d.shop).apply();
            if (!d.currency.isEmpty()) Settings.setCurrency(this, d.currency);
            cleanup();
            startActivity(new Intent(this, CountActivity.class));
            finish();
        }, e -> { p.dismiss(); Ui.error(this, e); });
        if (total == 0) p.dismiss();
    }

    void cleanup() {
        if (pkg != null) pkg.close();
        if (staged != null) //noinspection ResultOfMethodCallIgnored
            staged.delete();
    }

    @Override protected void onDestroy() {
        cancelled = true;
        if (isFinishing() && result == null) cleanup();
        else if (pkg != null) pkg.close();
        super.onDestroy();
    }

    @SuppressWarnings("unused") static void hide(View v) { v.setVisibility(View.GONE); }
}
