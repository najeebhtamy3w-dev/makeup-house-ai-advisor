package com.smartstock.ui;

import android.net.Uri;
import android.os.Bundle;
import android.widget.LinearLayout;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Backup;
import com.smartstock.data.Settings;
import com.smartstock.data.Workflows;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Preferences + full local backup / verified restore. */
public class SettingsActivity extends BaseActivity {

    ActivityResultLauncher<String> createBackup;
    ActivityResultLauncher<String[]> openBackup;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        createBackup = registerForActivityResult(new ActivityResultContracts.CreateDocument("application/zip"), this::writeBackup);
        openBackup = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::readBackup);
        LinearLayout c = scaffold("الإعدادات والنسخ الاحتياطي", true);

        MaterialCardView prefs = Ui.card(this);
        LinearLayout pb = Ui.box(prefs);
        pb.addView(Ui.text(this, "الجرد", 16, R.color.navy, true));
        MaterialSwitch sound = new MaterialSwitch(this);
        sound.setText("تنبيه صوتي عند المسح والحفظ");
        sound.setChecked(Settings.sound(this));
        sound.setOnCheckedChangeListener((v, on) -> Settings.setSound(this, on));
        MaterialSwitch vib = new MaterialSwitch(this);
        vib.setText("اهتزاز عند المسح والحفظ");
        vib.setChecked(Settings.vibrate(this));
        vib.setOnCheckedChangeListener((v, on) -> Settings.setVibrate(this, on));
        pb.addView(sound); pb.addView(vib);
        TextInputLayout cur = Ui.field(this, "اسم العملة الافتراضي في التقارير (بدون تحويل)", Settings.currency(this), false);
        TextInputLayout large = Ui.field(this, "طلب تأكيد عند كمية أكبر من", String.valueOf(Settings.largeQty(this)), true);
        pb.addView(cur, Ui.matchWrap(this, 8));
        pb.addView(large, Ui.matchWrap(this, 8));
        pb.addView(Ui.button(this, "حفظ الإعدادات", Ui.Style.PRIMARY, R.drawable.ic_save, v -> {
            Settings.setCurrency(this, Ui.edit(cur).getText().toString());
            try { Settings.setLargeQty(this, Math.max(1, Integer.parseInt(Ui.edit(large).getText().toString().trim()))); } catch (Exception ignored) {}
            android.widget.Toast.makeText(this, "تم الحفظ", android.widget.Toast.LENGTH_SHORT).show();
        }), Ui.matchWrap(this, 8));
        c.addView(prefs);

        MaterialCardView bk = Ui.card(this);
        LinearLayout bb = Ui.box(bk);
        bb.addView(Ui.text(this, "النسخ الاحتياطي والاستعادة", 16, R.color.navy, true));
        bb.addView(Ui.text(this, "تشمل النسخة: جميع الجلسات والأصناف والكميات وحالات الجرد وسجل العمليات وملفات Excel الأصلية والإعدادات، مع بصمة SHA-256 لكل ملف. ملف Excel المصدَّر وحده ليس نسخة احتياطية كاملة.", 13, R.color.text_muted, false));
        bb.addView(Ui.button(this, "إنشاء نسخة احتياطية", Ui.Style.PRIMARY, R.drawable.ic_save, v ->
                createBackup.launch("SMART_STOCK_backup_" + new SimpleDateFormat("yyyy-MM-dd_HHmm", Locale.US).format(new Date()) + ".zip")), Ui.matchWrap(this, 10));
        bb.addView(Ui.button(this, "استعادة نسخة احتياطية", Ui.Style.OUTLINE, R.drawable.ic_restore, v ->
                openBackup.launch(new String[]{"application/zip", "application/octet-stream", "application/x-zip-compressed"})), Ui.matchWrap(this, 6));
        c.addView(bk, Ui.matchWrap(this, 12));

        MaterialCardView about = Ui.card(this);
        LinearLayout ab = Ui.box(about);
        ab.addView(Ui.text(this, "حول التطبيق", 16, R.color.navy, true));
        ab.addView(Ui.kv(this, "الإصدار", appVersion(), false));
        ab.addView(Ui.kv(this, "قاعدة البيانات", "الإصدار " + com.smartstock.data.Db.VERSION, false));
        ab.addView(Ui.text(this, "يعمل بالكامل دون إنترنت. لا حسابات ولا إعلانات ولا تتبع. لا تُرسل أي بيانات خارج الهاتف. الخط: Noto Sans Arabic (رخصة OFL).", 13, R.color.text_muted, false));
        c.addView(about, Ui.matchWrap(this, 12));
    }

    void writeBackup(Uri uri) {
        if (uri == null) return;
        Ui.Progress p = Ui.progress(this, "جاري إنشاء النسخة الاحتياطية…");
        Bg.db(this, () -> {
            try (OutputStream o = getContentResolver().openOutputStream(uri, "wt")) {
                if (o == null) throw new java.io.IOException("تعذر فتح الوجهة");
                Backup.create(this, o, appVersion());
            }
            return true;
        }, ok -> { p.dismiss(); Ui.info(this, "تم", "تم إنشاء النسخة الاحتياطية بنجاح. احفظها في مكان آمن (بطاقة ذاكرة أو حاسوب)."); },
                e -> { p.dismiss(); Ui.error(this, e); });
    }

    void readBackup(Uri uri) {
        if (uri == null) return;
        Ui.Progress p = Ui.progress(this, "جاري فحص النسخة الاحتياطية…");
        Bg.db(this, () -> {
            File f;
            try (InputStream in = getContentResolver().openInputStream(uri)) { f = Workflows.stage(this, in); }
            try { return Backup.validate(this, f); } finally { //noinspection ResultOfMethodCallIgnored
                f.delete(); }
        }, plan -> { p.dismiss(); confirmRestore(plan); }, e -> { p.dismiss(); Ui.error(this, e); });
    }

    void confirmRestore(Backup.Plan plan) {
        StringBuilder b = new StringBuilder("✓ النسخة سليمة (البصمات وقاعدة البيانات والإجماليات مطابقة).\n\n");
        b.append("تاريخ النسخة: ").append(plan.createdAt).append(" • إصدار التطبيق ").append(plan.appVersion).append("\n");
        b.append("عدد الجلسات: ").append(plan.sessions.size()).append("\n");
        for (Backup.SessionCheck s : plan.sessions)
            b.append("• ").append(s.name).append(": ").append(s.counted).append("/").append(s.items).append(" مجرود، القيمة ").append(Num.money(Num.parseStored(s.sumValue))).append("\n");
        b.append("\n⚠ ستُستبدل جميع البيانات الحالية في التطبيق بمحتوى هذه النسخة. ستُحفظ نسخة أمان من بياناتك الحالية داخل التطبيق قبل الاستبدال.");
        new MaterialAlertDialogBuilder(this).setTitle("استعادة نسخة احتياطية").setMessage(b.toString())
                .setPositiveButton("استبدال البيانات الحالية", (d, w) -> new MaterialAlertDialogBuilder(this).setTitle("تأكيد نهائي")
                        .setMessage("هل أنت متأكد؟ ستُستبدل البيانات الحالية.")
                        .setPositiveButton("نعم، استعد", (d2, w2) -> apply(plan)).setNegativeButton("إلغاء", null).show())
                .setNegativeButton("إلغاء", null).show();
    }

    void apply(Backup.Plan plan) {
        Ui.Progress p = Ui.progress(this, "جاري الاستعادة والتحقق…");
        Bg.db(this, () -> { Backup.apply(this, plan, appVersion()); return true; },
                ok -> { p.dismiss(); Ui.info(this, "تمت الاستعادة", "تمت استعادة البيانات والتحقق من تطابق الكميات والإجماليات."); },
                e -> { p.dismiss(); Ui.error(this, e); });
    }
}
