package com.smartstock.ui;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.content.res.ResourcesCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.checkbox.MaterialCheckBox;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Settings;
import com.smartstock.data.Workflows;
import com.smartstock.pdf.ReportPdf;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/** A4 landscape PDF: options -> generate (background) -> preview -> print / save / share. */
public class PrintActivity extends BaseActivity {
    public static final String EXTRA_SESSION = "session_id";

    Models.Session session;
    List<String> groups = new ArrayList<>();
    LinearLayout content;
    File pdf;
    int pages;
    PdfRenderer renderer;
    ParcelFileDescriptor pfd;
    ActivityResultLauncher<String> savePdf;
    volatile boolean cancelled;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        savePdf = registerForActivityResult(new ActivityResultContracts.CreateDocument("application/pdf"), this::saveTo);
        content = scaffold("الطباعة — A4 عمودي", true);
        long sid = getIntent().getLongExtra(EXTRA_SESSION, activeSessionId());
        Bg.db(this, () -> new Object[]{repo.session(sid), repo.groups(sid)}, r -> {
            session = (Models.Session) r[0];
            if (session == null) { noSession(); return; }
            @SuppressWarnings("unchecked") List<String> g = (List<String>) r[1];
            groups = g;
            options();
        }, null);
    }

    void mergeButton() {
        content.addView(Ui.button(this, "طباعة مجمّعة لعدة جوالات (دمج ملفات)", Ui.Style.GOLD, R.drawable.ic_sessions,
                v -> startActivity(new android.content.Intent(this, MergeActivity.class))), Ui.matchWrap(this, 12));
    }

    void noSession() {
        content.removeAllViews();
        content.addView(Ui.text(this, "لا توجد جلسة جرد نشطة على هذا الجوال. يمكنك دمج ملفات Excel المصدَّرة من عدة جوالات وطباعتها في تقرير واحد.", 15, R.color.text, false));
        mergeButton();
    }

    void options() {
        content.removeAllViews();
        if (session.isMerged()) {
            content.addView(Ui.chip(this, "تقرير مجمّع: " + session.fileName, R.color.gold, R.color.navy));
        }
        com.google.android.material.card.MaterialCardView c = Ui.card(this);
        LinearLayout box = Ui.box(c);
        box.addView(Ui.text(this, "محتوى التقرير", 16, R.color.navy, true));
        RadioGroup rg = new RadioGroup(this);
        String[] labels = {"جميع الأصناف (الافتراضي)", "الأصناف المجرودة فقط", "الأصناف غير المجرودة", "الأصناف ذات الكمية الموجبة", "مجموعة محددة", "التقرير النهائي فقط"};
        ReportPdf.Scope[] scopes = ReportPdf.Scope.values();
        int[] ids = new int[labels.length];
        for (int i = 0; i < labels.length; i++) {
            RadioButton rb = new RadioButton(this);
            rb.setText(labels[i]);
            rb.setId(ids[i] = android.view.View.generateViewId());
            rg.addView(rb);
        }
        rg.check(ids[0]);
        box.addView(rg);
        Spinner gs = new Spinner(this);
        List<String> gl = new ArrayList<>();
        for (String g : groups) gl.add(g.isEmpty() ? "(بدون مجموعة)" : g);
        gs.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, gl));
        box.addView(gs);
        TextInputLayout cur = Ui.field(this, "اسم العملة (للعرض فقط)", session.currency.isEmpty() ? Settings.currency(this) : session.currency, false);
        box.addView(cur, Ui.matchWrap(this, 10));
        MaterialCheckBox sub = new MaterialCheckBox(this);
        sub.setText("إظهار مجموع كل صفحة");
        sub.setChecked(true);
        box.addView(sub);
        box.addView(Ui.text(this, "الأعمدة المطبوعة: اسم الصنف • العبوة / حبة • الباركود • الكمية • التكلفة • إجمالي تكلفة الصف. لا تُطبع المجموعة والوحدة والتاريخ والملاحظات (تبقى في ملف Excel). الورق: A4 عمودي.", 12, R.color.text_muted, false), Ui.matchWrap(this, 8));
        content.addView(c);
        content.addView(Ui.button(this, "إنشاء التقرير ومعاينته", Ui.Style.PRIMARY, R.drawable.ic_print, v -> {
            ReportPdf.Options o = new ReportPdf.Options();
            int idx = 0;
            for (int i = 0; i < ids.length; i++) if (ids[i] == rg.getCheckedRadioButtonId()) idx = i;
            o.scope = scopes[idx];
            if (o.scope == ReportPdf.Scope.GROUP) {
                if (groups.isEmpty()) { Ui.info(this, "الطباعة", "لا توجد مجموعات."); return; }
                o.group = groups.get(Math.max(0, gs.getSelectedItemPosition()));
            }
            o.currency = Ui.edit(cur).getText().toString().trim();
            o.pageSubtotals = sub.isChecked();
            generate(o);
        }), Ui.matchWrap(this, 12));
        if (!session.isMerged()) mergeButton();
    }

    void generate(ReportPdf.Options o) {
        Ui.Progress p = Ui.progress(this, "جاري إنشاء ملف PDF…");
        long sid = session.id;
        closeRenderer();
        Bg.work(this, () -> {
            File out = new File(getCacheDir(), "report_" + sid + ".pdf");
            ReportPdf w = new ReportPdf(ResourcesCompat.getFont(this, R.font.noto_arabic), ResourcesCompat.getFont(this, R.font.noto_arabic_bold));
            return w.write(repo, sid, o, out, new ReportPdf.Progress() {
                @Override public void onProgress(int done, int total) { Bg.main(() -> p.set("جاري إنشاء ملف PDF… " + done + " / " + total, done, total)); }
                @Override public boolean isCancelled() { return cancelled; }
            });
        }, r -> { p.dismiss(); preview(r, o); }, e -> { p.dismiss(); Ui.error(this, e); });
    }

    void preview(ReportPdf.Result r, ReportPdf.Options o) {
        pdf = r.file;
        pages = r.pages;
        content.removeAllViews();
        String cur = o.currency.isEmpty() ? "" : " " + o.currency;
        content.addView(Ui.text(this, ReportPdf.scopeLabel(o) + " • " + r.pages + " صفحة • " + r.rows + " صنف • القيمة " + Num.money(r.sumValue) + cur, 14, R.color.navy, true));
        LinearLayout actions = Ui.hbox(this);
        LinearLayout.LayoutParams p = Ui.weight(1); p.setMarginEnd(Ui.dp(this, 6));
        actions.addView(Ui.button(this, "طباعة", Ui.Style.PRIMARY, R.drawable.ic_print, v -> print()), p);
        LinearLayout.LayoutParams p2 = Ui.weight(1); p2.setMarginEnd(Ui.dp(this, 6));
        actions.addView(Ui.button(this, "حفظ PDF", Ui.Style.OUTLINE, R.drawable.ic_save, v -> savePdf.launch(pdfName())), p2);
        actions.addView(Ui.button(this, "مشاركة", Ui.Style.OUTLINE, R.drawable.ic_share, v -> ExportActivity.share(this, pdf, pdfName(), "application/pdf")), Ui.weight(1));
        content.addView(actions, Ui.matchWrap(this, 8));
        content.addView(Ui.button(this, "تغيير خيارات الطباعة", Ui.Style.TEXT, 0, v -> options()));
        try {
            pfd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(pfd);
        } catch (Exception e) { Ui.error(this, e); return; }
        RecyclerView rv = new RecyclerView(this);
        rv.setLayoutManager(new LinearLayoutManager(this));
        rv.setAdapter(new PageAdapter());
        content.addView(rv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 520)));
    }

    String pdfName() { return Workflows.safeFileName(session.name) + "_A4.pdf"; }

    final class PageAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        @NonNull @Override public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup p, int t) {
            LinearLayout l = Ui.vbox(PrintActivity.this, 4);
            ImageView iv = new ImageView(PrintActivity.this);
            iv.setAdjustViewBounds(true);
            iv.setBackgroundColor(Color.WHITE);
            TextView tv = Ui.text(PrintActivity.this, "", 12, R.color.text_muted, false);
            l.addView(iv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            l.addView(tv);
            l.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            return new RecyclerView.ViewHolder(l) {};
        }
        @Override public void onBindViewHolder(@NonNull RecyclerView.ViewHolder h, int pos) {
            LinearLayout l = (LinearLayout) h.itemView;
            ImageView iv = (ImageView) l.getChildAt(0);
            ((TextView) l.getChildAt(1)).setText("صفحة " + (pos + 1) + " من " + pages);
            if (renderer == null) return;
            synchronized (PrintActivity.this) {
                try (PdfRenderer.Page page = renderer.openPage(pos)) {
                    int w = Math.max(600, getResources().getDisplayMetrics().widthPixels - Ui.dp(PrintActivity.this, 40));
                    int hgt = Math.round(w * page.getHeight() / (float) page.getWidth());
                    Bitmap bmp = Bitmap.createBitmap(w, hgt, Bitmap.Config.ARGB_8888);
                    bmp.eraseColor(Color.WHITE);
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    iv.setImageBitmap(bmp);
                } catch (Exception ignored) {}
            }
        }
        @Override public int getItemCount() { return renderer == null ? 0 : renderer.getPageCount(); }
    }

    void print() {
        if (pdf == null) return;
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        String job = "SMART STOCK — " + session.name;
        PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait())
                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
        pm.print(job, new FileAdapter(pdf, pdfName(), pages), attrs);
    }

    /** Streams the already generated vector PDF to the Android print framework. */
    static final class FileAdapter extends PrintDocumentAdapter {
        final File file; final String name; final int pages;
        FileAdapter(File f, String n, int p) { file = f; name = n; pages = p; }
        @Override public void onLayout(PrintAttributes old, PrintAttributes now, CancellationSignal cs, LayoutResultCallback cb, Bundle extras) {
            if (cs.isCanceled()) { cb.onLayoutCancelled(); return; }
            cb.onLayoutFinished(new PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(pages).build(), !now.equals(old));
        }
        @Override public void onWrite(PageRange[] range, ParcelFileDescriptor dest, CancellationSignal cs, WriteResultCallback cb) {
            try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                byte[] b = new byte[1 << 16]; int n;
                while ((n = in.read(b)) > 0) { if (cs.isCanceled()) { cb.onWriteCancelled(); return; } out.write(b, 0, n); }
                cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
            } catch (Exception e) {
                cb.onWriteFailed(e.getMessage());
            }
        }
    }

    void saveTo(Uri uri) {
        if (uri == null || pdf == null) return;
        Bg.work(this, () -> {
            try (OutputStream o = getContentResolver().openOutputStream(uri, "wt")) {
                if (o == null) throw new java.io.IOException("تعذر فتح الوجهة");
                Workflows.copyTo(pdf, o);
            }
            return true;
        }, ok -> Ui.info(this, "تم الحفظ", "تم حفظ ملف PDF."), null);
    }

    void closeRenderer() {
        synchronized (this) {
            try { if (renderer != null) renderer.close(); } catch (Exception ignored) {}
            try { if (pfd != null) pfd.close(); } catch (Exception ignored) {}
            renderer = null; pfd = null;
        }
    }

    @Override protected void onDestroy() {
        cancelled = true;
        closeRenderer();
        super.onDestroy();
    }
}
