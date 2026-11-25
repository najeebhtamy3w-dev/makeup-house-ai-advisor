package com.smartstock.ui;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Backup;
import com.smartstock.data.Models;
import com.smartstock.data.Workflows;

import java.io.File;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Export a real XLSX: the stored original workbook with only quantity + row total updated
 * (total column created if missing). The file is verified against the database before saving.
 */
public class ExportActivity extends BaseActivity {
    public static final String EXTRA_SESSION = "session_id";
    static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    Models.Session session;
    LinearLayout content;
    TextInputLayout nameField;
    TextView status;
    Workflows.ExportReport last;
    ActivityResultLauncher<String> create;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        create = registerForActivityResult(new ActivityResultContracts.CreateDocument(XLSX), this::saveTo);
        content = scaffold("تصدير ملف Excel", true);
        long sid = getIntent().getLongExtra(EXTRA_SESSION, activeSessionId());
        Bg.db(this, () -> new Object[]{repo.session(sid), repo.stats(sid)}, r -> {
            session = (Models.Session) r[0];
            if (session == null) { finish(); return; }
            if (session.isMerged()) {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(this).setTitle("تقرير مجمّع")
                        .setMessage("التقرير المجمّع مخصص للطباعة فقط. ملفات Excel الأصلية موجودة في كل جوال.")
                        .setCancelable(false).setPositiveButton("حسنًا", (d, w) -> finish()).show();
                return;
            }
            render((Models.Stats) r[1]);
        }, null);
    }

    void render(Models.Stats st) {
        String cur = session.currency.isEmpty() ? "" : " " + session.currency;
        MaterialCardView c = Ui.card(this);
        LinearLayout box = Ui.box(c);
        box.addView(Ui.text(this, session.name, 17, R.color.navy, true));
        box.addView(Ui.kv(this, "الملف الأصلي", session.fileName, false));
        box.addView(Ui.kv(this, "الورقة", session.sheetName, false));
        box.addView(Ui.kv(this, "الأصناف / المجرودة", st.items + " / " + st.counted, false));
        box.addView(Ui.kv(this, "إجمالي الكميات", Num.qty(st.sumQty), false));
        if (st.added > 0) box.addView(Ui.kv(this, "أصناف مُضافة (صفوف جديدة)", String.valueOf(st.added), false));
        box.addView(Ui.kv(this, "إجمالي القيمة", Num.money(st.sumValue) + cur, true));
        box.addView(Ui.text(this, "يُحدَّث عمود الكمية وعمود إجمالي تكلفة الصف فقط" + (session.totalCreated ? " (سيُنشأ عمود الإجمالي)" : "")
                + ". تبقى جميع الأعمدة والأوراق الأخرى كما هي، ولا يُعدَّل الملف الأصلي.", 13, R.color.text_muted, false), Ui.matchWrap(this, 8));
        if (session.lastExport != null && !session.lastExport.isEmpty())
            box.addView(Ui.text(this, "آخر تصدير: " + session.lastExport, 12, R.color.text_muted, false));
        content.addView(c);

        String date = new SimpleDateFormat("yyyy-MM-dd_HHmm", Locale.US).format(new Date());
        nameField = Ui.field(this, "اسم الملف", Workflows.safeFileName(session.name) + "_" + date + ".xlsx", false);
        content.addView(nameField, Ui.matchWrap(this, 12));
        status = Ui.text(this, "", 14, R.color.success, false);
        content.addView(status, Ui.matchWrap(this, 8));
        content.addView(Ui.button(this, "حفظ في ذاكرة الهاتف", Ui.Style.PRIMARY, R.drawable.ic_save, v -> prepare(() -> create.launch(fileName()))), Ui.matchWrap(this, 10));
        content.addView(Ui.button(this, "مشاركة عبر التطبيقات", Ui.Style.OUTLINE, R.drawable.ic_share, v -> prepare(() -> share(this, last.file, fileName(), XLSX))), Ui.matchWrap(this, 6));
    }

    String fileName() {
        String n = Ui.edit(nameField).getText().toString().trim();
        if (n.isEmpty()) n = Workflows.safeFileName(session.name);
        n = Workflows.safeFileName(n.replaceAll("(?i)\\.xlsx$", ""));
        if (n.equalsIgnoreCase(session.fileName.replaceAll("(?i)\\.xlsx$", ""))) n = n + "_جرد"; // never reuse the original name by accident
        return n + ".xlsx";
    }

    /** Always rebuilds from the latest database state, then verifies, then runs next. */
    void prepare(Runnable next) {
        Ui.Progress p = Ui.progress(this, "جاري إنشاء الملف والتحقق منه…");
        long sid = session.id;
        Bg.work(this, () -> Workflows.exportVerified(this, sid), r -> {
            p.dismiss();
            last = r;
            String cur = session.currency.isEmpty() ? "" : " " + session.currency;
            status.setText("✓ تم التحقق: " + r.rows + " صنف — الكميات " + Num.qty(r.sumQty) + " — القيمة " + Num.money(r.sumValue) + cur + " مطابقة لقاعدة البيانات.");
            next.run();
        }, e -> { p.dismiss(); Ui.error(this, e); });
    }

    void saveTo(Uri uri) {
        if (uri == null || last == null) return;
        Bg.work(this, () -> {
            try (OutputStream o = getContentResolver().openOutputStream(uri, "wt")) {
                if (o == null) throw new java.io.IOException("تعذر فتح الوجهة للكتابة");
                Workflows.copyTo(last.file, o);
            }
            String note = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date()) + " — " + fileName();
            repo.setLastExport(session.id, note);
            return note;
        }, note -> Ui.info(this, "تم التصدير", "تم حفظ الملف بنجاح:\n" + fileName() + "\n\nيمكن فتحه مباشرة في Microsoft Excel."), null);
    }

    /** Shares a private file through FileProvider (copy into cache/share). */
    static void share(Activity a, File f, String name, String mime) {
        Bg.work(a, () -> {
            File dir = new File(a.getCacheDir(), "share");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File out = new File(dir, name);
            Backup.copyFile(f, out);
            return out;
        }, out -> {
            Uri u = FileProvider.getUriForFile(a, a.getPackageName() + ".files", out);
            Intent i = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, u)
                    .putExtra(Intent.EXTRA_SUBJECT, name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            a.startActivity(Intent.createChooser(i, "مشاركة " + name));
        }, null);
    }
}
