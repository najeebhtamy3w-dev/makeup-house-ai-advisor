package com.smartstock.pdf;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;

import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Vector A4-landscape PDF (Android PdfDocument), Arabic RTL table. Rows are never split across pages,
 * headers repeat on every page, long names wrap, barcodes are never cut (font shrinks to fit).
 * Two streaming passes over the database (measure, then draw) keep memory constant for 50,000 items.
 */
public final class ReportPdf {

    public enum Scope { ALL, COUNTED, UNCOUNTED, POSITIVE, GROUP, SUMMARY_ONLY }

    public static final class Options {
        public Scope scope = Scope.ALL;
        public String group;          // for Scope.GROUP
        public String currency = "";  // label only, no conversion
        public boolean pageSubtotals = true;
    }

    public interface Progress { void onProgress(int done, int total); boolean isCancelled(); }

    /** Page output abstraction: vector PdfDocument on the device; bitmap pages in JVM tests. */
    public interface PageSink {
        Canvas begin(int pageNo, int width, int height);
        void end();
        void writeTo(File out) throws IOException;
        void close();
    }

    public static final class PdfSink implements PageSink {
        final PdfDocument doc = new PdfDocument();
        PdfDocument.Page page;
        @Override public Canvas begin(int n, int w, int h) { page = doc.startPage(new PdfDocument.PageInfo.Builder(w, h, n).create()); return page.getCanvas(); }
        @Override public void end() { doc.finishPage(page); page = null; }
        @Override public void writeTo(File out) throws IOException { try (FileOutputStream fo = new FileOutputStream(out)) { doc.writeTo(fo); } }
        @Override public void close() { doc.close(); }
    }

    public static final class Result { public File file; public int pages, rows; public BigDecimal sumQty, sumValue; }

    // A4 landscape in PostScript points
    static final int PW = 842, PH = 595, M = 28;
    static final float BODY = 9f, HEAD = 9.5f, PAD = 2.5f, MIN_ROW = 16f;
    // column widths from right to left: م, اسم الصنف, العبوة/حبة, الباركود, الكمية, التكلفة, إجمالي تكلفة الصف
    static final float[] W = {30, 292, 78, 128, 70, 86, 102};
    static final String[] H = {"م", "اسم الصنف", "العبوة / حبة", "الباركود", "الكمية", "التكلفة", "إجمالي تكلفة الصف"};
    static final float TOP_BLOCK = 54f, FOOT = 26f, SUBTOTAL_H = 20f;

    private final Typeface regular, bold;
    private final TextPaint body, bodyBold, small, title, big;
    private final Paint line, fill, frame;

    public ReportPdf(Typeface regular, Typeface bold) {
        this.regular = regular;
        this.bold = bold;
        body = tp(regular, BODY, Color.BLACK);
        bodyBold = tp(bold, HEAD, Color.BLACK);
        small = tp(regular, 8f, Color.rgb(60, 60, 60));
        title = tp(bold, 14f, Color.BLACK);
        big = tp(bold, 22f, Color.BLACK);
        line = new Paint(); line.setColor(Color.rgb(150, 150, 150)); line.setStrokeWidth(0.5f); line.setStyle(Paint.Style.STROKE);
        frame = new Paint(); frame.setColor(Color.BLACK); frame.setStrokeWidth(1.2f); frame.setStyle(Paint.Style.STROKE);
        fill = new Paint(); fill.setColor(Color.rgb(232, 232, 232)); fill.setStyle(Paint.Style.FILL);
    }

    static TextPaint tp(Typeface t, float size, int color) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(t); p.setTextSize(size); p.setColor(color);
        return p;
    }

    static StaticLayout layout(CharSequence s, TextPaint p, float width, Layout.Alignment a) {
        return StaticLayout.Builder.obtain(s, 0, s.length(), p, Math.max(1, (int) width))
                .setAlignment(a)
                .setTextDirection(TextDirectionHeuristics.RTL)
                .setIncludePad(false)
                .setLineSpacing(0f, 1f)
                .build();
    }

    /** Draws text inside a box (x = left edge). ALIGN_NORMAL is right-aligned for RTL text. */
    static float text(Canvas c, CharSequence s, TextPaint p, float x, float y, float w, Layout.Alignment a) {
        StaticLayout l = layout(s, p, w, a);
        c.save(); c.translate(x, y); l.draw(c); c.restore();
        return l.getHeight();
    }

    // ------------------------------------------------------------------ public entry

    public Result write(Repository repo, long sid, Options o, File out, Progress progress) throws Exception {
        return write(repo, sid, o, out, progress, new PdfSink());
    }

    public Result write(Repository repo, long sid, Options o, File out, Progress progress, PageSink doc) throws Exception {
        Models.Session s = repo.session(sid);
        Models.Filter filter = filterOf(o.scope);
        String group = o.scope == Scope.GROUP ? o.group : null;
        Models.Stats full = repo.stats(sid);
        Models.Stats scoped = o.scope == Scope.ALL || o.scope == Scope.SUMMARY_ONLY ? full : repo.stats(sid, filter, group);
        int total = o.scope == Scope.SUMMARY_ONLY ? 0 : scoped.items;

        // ---- pass 1: measure row heights and paginate (no row split across pages)
        final float tableTop = M + TOP_BLOCK, headerH = 22f;
        final float bottom = PH - M - FOOT - (o.pageSubtotals ? SUBTOTAL_H : 0);
        final List<Integer> pageStarts = new ArrayList<>();
        final float[] heights = new float[total];
        if (total > 0) {
            final int[] i = {0};
            final float[] y = {tableTop + headerH};
            pageStarts.add(0);
            repo.forEach(sid, filter, group, it -> {
                float h = rowHeight(it);
                heights[i[0]] = h;
                if (y[0] + h > bottom) { pageStarts.add(i[0]); y[0] = tableTop + headerH; }
                y[0] += h;
                i[0]++;
                if (progress != null && i[0] % 500 == 0) { progress.onProgress(i[0] / 2, total); if (progress.isCancelled()) throw new IOException("تم الإلغاء"); }
            });
        }
        int listPages = pageStarts.size();
        final List<Models.Part> parts = s.isMerged() ? repo.parts(sid) : null;
        final int dupAcross = s.isMerged() ? repo.crossFileDuplicateBarcodes(sid) : 0;
        int totalPages = listPages + (parts != null ? 1 : 0) + 1;
        String printed = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date());

        Result res = new Result();
        res.pages = totalPages; res.rows = total;
        try {
            // ---- pass 2: draw
            if (total > 0) {
                final Canvas[] page = {null};
                final int[] idx = {0}, pageNo = {0};
                final float[] y = {0};
                final BigDecimal[] pq = {BigDecimal.ZERO}, pv = {BigDecimal.ZERO};
                repo.forEach(sid, filter, group, it -> {
                    int i = idx[0];
                    if (pageNo[0] < listPages && i == pageStarts.get(pageNo[0])) {
                        if (page[0] != null) { if (o.pageSubtotals) subtotal(page[0], y[0], pq[0], pv[0]); doc.end(); }
                        pageNo[0]++;
                        page[0] = doc.begin(pageNo[0], PW, PH);
                        Canvas c = page[0];
                        pageTop(c, s, o, scopeLabel(o));
                        footer(c, pageNo[0], totalPages, printed);
                        y[0] = tableHeader(c, tableTop);
                        pq[0] = BigDecimal.ZERO; pv[0] = BigDecimal.ZERO;
                    }
                    drawRow(page[0], y[0], heights[i], i + 1, it);
                    y[0] += heights[i];
                    pq[0] = pq[0].add(it.qty);
                    BigDecimal t = it.total();
                    if (t != null) pv[0] = pv[0].add(t);
                    idx[0]++;
                    if (progress != null && idx[0] % 500 == 0) { progress.onProgress(total / 2 + idx[0] / 2, total); if (progress.isCancelled()) throw new IOException("تم الإلغاء"); }
                });
                if (page[0] != null) { if (o.pageSubtotals) subtotal(page[0], y[0], pq[0], pv[0]); doc.end(); }
            }
            // ---- merged report: one page with the totals of every source file (phone)
            if (parts != null) {
                Canvas pc = doc.begin(totalPages - 1, PW, PH);
                partsPage(pc, s, o, parts, full, dupAcross);
                footer(pc, totalPages - 1, totalPages, printed);
                doc.end();
            }
            // ---- final independent report page
            Canvas p = doc.begin(totalPages, PW, PH);
            summaryPage(p, s, o, full, scoped, printed);
            footer(p, totalPages, totalPages, printed);
            doc.end();
            doc.writeTo(out);
        } finally {
            doc.close();
        }
        res.file = out;
        res.sumQty = scoped.sumQty; res.sumValue = scoped.sumValue;
        return res;
    }

    static Models.Filter filterOf(Scope s) {
        switch (s) {
            case COUNTED: return Models.Filter.COUNTED;
            case UNCOUNTED: return Models.Filter.UNCOUNTED;
            case POSITIVE: return Models.Filter.POSITIVE;
            default: return Models.Filter.ALL;
        }
    }

    public static String scopeLabel(Options o) {
        switch (o.scope) {
            case COUNTED: return "الأصناف المجرودة فقط";
            case UNCOUNTED: return "الأصناف غير المجرودة";
            case POSITIVE: return "الأصناف ذات الكمية الموجبة";
            case GROUP: return "المجموعة: " + o.group;
            case SUMMARY_ONLY: return "التقرير النهائي فقط";
            default: return "جميع الأصناف";
        }
    }

    // ------------------------------------------------------------------ measuring

    float rowHeight(Models.Item it) {
        float wName = W[1] - 2 * PAD;
        float h;
        if (body.measureText(it.name) <= wName) h = lineH(body);
        else h = layout(it.name, body, wName, Layout.Alignment.ALIGN_NORMAL).getHeight();
        String pack = it.pack == null ? "" : it.pack;
        if (body.measureText(pack) > W[2] - 2 * PAD) h = Math.max(h, layout(pack, body, W[2] - 2 * PAD, Layout.Alignment.ALIGN_CENTER).getHeight());
        return Math.max(MIN_ROW, h + 2 * PAD + 1);
    }

    static float lineH(TextPaint p) { Paint.FontMetrics fm = p.getFontMetrics(); return fm.descent - fm.ascent; }

    // ------------------------------------------------------------------ drawing

    void pageTop(Canvas c, Models.Session s, Options o, String scope) {
        float right = PW - M, w = PW - 2 * M;
        text(c, "كشف جرد الأصناف — " + s.name, title, M, M, w, Layout.Alignment.ALIGN_NORMAL);
        String info = (s.shop == null || s.shop.isEmpty() ? "" : "المحل: " + s.shop + "   |   ") + "تاريخ الجرد: " + s.countDate + "   |   نطاق الكشف: " + scope
                + (o.currency == null || o.currency.isEmpty() ? "" : "   |   العملة: " + o.currency);
        text(c, info, small, M, M + 22, w, Layout.Alignment.ALIGN_NORMAL);
        text(c, "SMART STOCK — الجرد الذكي", small, M, M + 4, 200, Layout.Alignment.ALIGN_OPPOSITE);
        c.drawLine(M, M + TOP_BLOCK - 8, right, M + TOP_BLOCK - 8, frame);
    }

    float tableHeader(Canvas c, float top) {
        float h = 22f;
        float x = PW - M;
        c.drawRect(M, top, PW - M, top + h, fill);
        for (int k = 0; k < W.length; k++) {
            float left = x - W[k];
            float th = layout(H[k], bodyBold, W[k] - 2 * PAD, Layout.Alignment.ALIGN_CENTER).getHeight();
            text(c, H[k], bodyBold, left + PAD, top + (h - th) / 2, W[k] - 2 * PAD, Layout.Alignment.ALIGN_CENTER);
            c.drawRect(left, top, x, top + h, line);
            x = left;
        }
        c.drawRect(M, top, PW - M, top + h, frame);
        return top + h;
    }

    void drawRow(Canvas c, float top, float h, int serial, Models.Item it) {
        String[] v = {
                String.valueOf(serial),
                it.name,
                it.pack == null ? "" : it.pack,
                it.barcode == null ? "" : it.barcode,
                Num.qty(it.qty),
                it.cost == null ? "غير صالحة" : Num.money(it.cost),
                it.cost == null ? "—" : Num.money(it.total())
        };
        float x = PW - M;
        for (int k = 0; k < W.length; k++) {
            float left = x - W[k];
            float cw = W[k] - 2 * PAD;
            if (k == 1 || k == 2) {
                Layout.Alignment a = k == 1 ? Layout.Alignment.ALIGN_NORMAL : Layout.Alignment.ALIGN_CENTER;
                StaticLayout l = layout(v[k], body, cw, a);
                c.save(); c.translate(left + PAD, top + (h - l.getHeight()) / 2); l.draw(c); c.restore();
            } else {
                TextPaint p = body;
                if (body.measureText(v[k]) > cw) { // never cut a barcode/number: shrink to fit
                    p = new TextPaint(body);
                    float size = BODY;
                    while (size > 4f && p.measureText(v[k]) > cw) { size -= 0.25f; p.setTextSize(size); }
                }
                Paint.FontMetrics fm = p.getFontMetrics();
                float base = top + h / 2 - (fm.ascent + fm.descent) / 2;
                p.setTextAlign(Paint.Align.CENTER);
                c.drawText(v[k], left + W[k] / 2, base, p);
                p.setTextAlign(Paint.Align.LEFT);
            }
            c.drawRect(left, top, x, top + h, line);
            x = left;
        }
    }

    void subtotal(Canvas c, float top, BigDecimal q, BigDecimal v) {
        float h = SUBTOTAL_H;
        float right = PW - M;
        float wLabel = W[0] + W[1] + W[2] + W[3];
        c.drawRect(M, top, right, top + h, fill);
        c.drawRect(M, top, right, top + h, line);
        float lh = layout("مجموع هذه الصفحة", bodyBold, wLabel - 2 * PAD, Layout.Alignment.ALIGN_NORMAL).getHeight();
        text(c, "مجموع هذه الصفحة", bodyBold, right - wLabel + PAD, top + (h - lh) / 2, wLabel - 2 * PAD, Layout.Alignment.ALIGN_NORMAL);
        float xQty = right - wLabel - W[4];
        center(c, Num.qty(q), xQty, W[4], top, h, bodyBold);
        float xTot = M;
        center(c, Num.money(v), xTot, W[6], top, h, bodyBold);
    }

    void center(Canvas c, String s, float left, float w, float top, float h, TextPaint base) {
        TextPaint p = new TextPaint(base);
        float size = p.getTextSize();
        while (size > 4f && p.measureText(s) > w - 2 * PAD) { size -= 0.25f; p.setTextSize(size); }
        Paint.FontMetrics fm = p.getFontMetrics();
        p.setTextAlign(Paint.Align.CENTER);
        c.drawText(s, left + w / 2, top + h / 2 - (fm.ascent + fm.descent) / 2, p);
    }

    void footer(Canvas c, int page, int pages, String printed) {
        float y = PH - M - 12;
        c.drawLine(M, y - 4, PW - M, y - 4, line);
        text(c, "صفحة " + page + " من " + pages, small, M, y, PW - 2 * M, Layout.Alignment.ALIGN_CENTER);
        text(c, "تاريخ إصدار التقرير: " + printed, small, M, y, PW - 2 * M, Layout.Alignment.ALIGN_NORMAL);
        text(c, "SMART STOCK", small, M, y, 120, Layout.Alignment.ALIGN_OPPOSITE);
    }

    void summaryPage(Canvas c, Models.Session s, Options o, Models.Stats full, Models.Stats scoped, String printed) {
        float w = PW - 2 * M;
        float y = M;
        y += text(c, s.isMerged() ? "التقرير النهائي للجرد المجمّع" : "التقرير النهائي للجرد", big, M, y, w, Layout.Alignment.ALIGN_CENTER) + 10;
        c.drawLine(M + 150, y, PW - M - 150, y, frame);
        y += 12;
        String cur = o.currency == null || o.currency.isEmpty() ? "" : " " + o.currency;
        String[][] info = {
                {"اسم المحل", s.shop == null || s.shop.isEmpty() ? "—" : s.shop},
                {"اسم جلسة الجرد", s.name},
                {"تاريخ بدء الجرد", s.countDate},
                {"تاريخ إصدار التقرير", printed},
                s.isMerged() ? new String[]{"مصدر البيانات", s.fileName + " (انظر صفحة تفاصيل الملفات)"} : new String[]{"ملف المصدر / الورقة", s.fileName + " / " + s.sheetName},
        };
        float colW = w / 2 - 10;
        float rightX = PW - M - colW;
        float yInfo = y;
        for (String[] r : info) yInfo = kv(c, r[0], r[1], rightX, yInfo, colW);
        String[][] nums = s.isMerged() ? new String[][]{
                // a file has no counted/not-counted flag, so merged reports show items by quantity
                {"عدد الأصناف الإجمالي", String.valueOf(full.items)},
                {"أصناف لها كمية", String.valueOf(full.positive)},
                {"أصناف بكمية صفر", String.valueOf(full.items - full.positive)},
                {"إجمالي الكميات", Num.qty(full.sumQty)},
                {"عدد الملفات المدمجة", String.valueOf(Math.max(0, s.parts.split("\"label\"", -1).length - 1))},
        } : new String[][] {
                {"عدد الأصناف الإجمالي", String.valueOf(full.items)},
                {"عدد الأصناف المجرودة", String.valueOf(full.counted)},
                {"عدد الأصناف غير المجرودة", String.valueOf(full.uncounted)},
                {"الأصناف المجرودة بكمية صفر", String.valueOf(full.countedZero)},
                {"الأصناف ذات الكمية الموجبة", String.valueOf(full.positive)},
                {"إجمالي الكميات", Num.qty(full.sumQty)},
                {"نسبة اكتمال الجرد", full.percent() + "%"},
        };
        float yNums = y;
        for (String[] r : nums) yNums = kv(c, r[0], r[1], M, yNums, colW);
        y = Math.max(yInfo, yNums) + 14;

        // highlighted final value
        RectF box = new RectF(M + 120, y, PW - M - 120, y + 84);
        c.drawRect(box, fill);
        c.drawRect(box, frame);
        text(c, "إجمالي القيمة المالية النهائية للمخزون", bodyBold, box.left, y + 6, box.width(), Layout.Alignment.ALIGN_CENTER);
        TextPaint v = new TextPaint(big);
        v.setTextSize(24f);
        text(c, Num.money(full.sumValue) + cur, v, box.left, y + 30, box.width(), Layout.Alignment.ALIGN_CENTER);
        y = box.bottom + 8;
        if (full.invalidCost > 0) {
            y += text(c, "تنبيه: " + full.invalidCost + " صنف بتكلفة غير صالحة في ملف Excel، ولم تُحتسب قيمة " + full.valuedMissing
                    + " منها ضمن الإجمالي المالي لوجود كمية لها.", small, M, y, w, Layout.Alignment.ALIGN_CENTER) + 4;
        }
        if (o.scope != Scope.ALL && o.scope != Scope.SUMMARY_ONLY) {
            String sc = "إجماليات الكشف المطبوع (" + scopeLabel(o) + "): عدد الأصناف " + scoped.items + "  |  الكميات " + Num.qty(scoped.sumQty)
                    + "  |  القيمة " + Num.money(scoped.sumValue) + cur + "  —  الإجماليات أعلاه تخص جلسة الجرد الكاملة.";
            c.drawRect(M + 60, y, PW - M - 60, y + 30, line);
            text(c, sc, body, M + 66, y + 8, w - 132, Layout.Alignment.ALIGN_CENTER);
            y += 36;
        }
        // signatures
        float sy = Math.max(y + 16, PH - M - 120);
        float sw = (w - 40) / 2;
        sign(c, "توقيع مسؤول الجرد", PW - M - sw, sy, sw);
        sign(c, "اعتماد الإدارة", M, sy, sw);
    }

    /** Per-file table for merged reports + grand total identical to the final page. */
    void partsPage(Canvas c, Models.Session s, Options o, List<Models.Part> parts, Models.Stats full, int dupAcross) {
        float w = PW - 2 * M, y = M;
        String cur = o.currency == null || o.currency.isEmpty() ? "" : " " + o.currency;
        y += text(c, "تفاصيل الملفات المدمجة — " + s.name, title, M, y, w, Layout.Alignment.ALIGN_NORMAL) + 12;
        float[] cw = {34, 300, 110, 110, 110, 122};
        String[] hd = {"م", "الملف / الجوال", "عدد الأصناف", "أصناف بكمية", "إجمالي الكميات", "إجمالي القيمة"};
        float h = 24;
        float x = PW - M;
        c.drawRect(M, y, PW - M, y + h, fill);
        for (int k = 0; k < cw.length; k++) { center(c, hd[k], x - cw[k], cw[k], y, h, bodyBold); c.drawRect(x - cw[k], y, x, y + h, line); x -= cw[k]; }
        y += h;
        int i = 1;
        for (Models.Part pt : parts) {
            if (y > PH - M - FOOT - 80) break;
            String[] v = {String.valueOf(i++), pt.label, String.valueOf(pt.items), String.valueOf(pt.positive), Num.qty(pt.qty), Num.money(pt.value) + cur};
            x = PW - M;
            for (int k = 0; k < cw.length; k++) {
                if (k == 1) text(c, v[k], body, x - cw[k] + PAD, y + 4, cw[k] - 2 * PAD, Layout.Alignment.ALIGN_NORMAL);
                else center(c, v[k], x - cw[k], cw[k], y, h, body);
                c.drawRect(x - cw[k], y, x, y + h, line);
                x -= cw[k];
            }
            y += h;
        }
        // grand total row = exactly the final report figures
        x = PW - M;
        c.drawRect(M, y, PW - M, y + h + 4, fill);
        String[] t = {"", "الإجمالي الكلي (" + parts.size() + " ملفات)", String.valueOf(full.items), String.valueOf(full.positive), Num.qty(full.sumQty), Num.money(full.sumValue) + cur};
        for (int k = 0; k < cw.length; k++) {
            if (k == 1) text(c, t[k], bodyBold, x - cw[k] + PAD, y + 5, cw[k] - 2 * PAD, Layout.Alignment.ALIGN_NORMAL);
            else center(c, t[k], x - cw[k], cw[k], y, h + 4, bodyBold);
            c.drawRect(x - cw[k], y, x, y + h + 4, frame);
            x -= cw[k];
        }
        y += h + 14;
        String note = "الأصناف مطبوعة في الكشف بترتيب الملفات ثم ترتيب الصفوف داخل كل ملف، كأنها ملف واحد. "
                + "الكميات والتكاليف مأخوذة من ملفات Excel المصدَّرة، والإجماليات محسوبة بدقة (الكمية × التكلفة).";
        if (dupAcross > 0) note += " تنبيه: يوجد " + dupAcross + " باركود يظهر في أكثر من ملف؛ لم تُدمج صفوفه وتظهر كل منها مستقلة.";
        text(c, note, small, M, y, w, Layout.Alignment.ALIGN_NORMAL);
    }

    float kv(Canvas c, String k, String v, float x, float y, float w) {
        float kw = w * 0.48f;
        float h1 = layout(k, bodyBold, kw, Layout.Alignment.ALIGN_NORMAL).getHeight();
        float h2 = layout(v, body, w - kw - 8, Layout.Alignment.ALIGN_NORMAL).getHeight();
        float h = Math.max(h1, h2) + 10;
        c.drawRect(x, y, x + w, y + h, line);
        c.drawRect(x + w - kw - 4, y, x + w, y + h, fill);
        c.drawRect(x + w - kw - 4, y, x + w, y + h, line);
        text(c, k, bodyBold, x + w - kw, y + 5, kw - 8, Layout.Alignment.ALIGN_NORMAL);
        text(c, v, body, x + 6, y + 5, w - kw - 14, Layout.Alignment.ALIGN_NORMAL);
        return y + h;
    }

    void sign(Canvas c, String label, float x, float y, float w) {
        c.drawRect(x, y, x + w, y + 84, line);
        text(c, label, bodyBold, x, y + 8, w, Layout.Alignment.ALIGN_CENTER);
        text(c, "الاسم: ............................................", body, x + 10, y + 34, w - 20, Layout.Alignment.ALIGN_NORMAL);
        text(c, "التوقيع: ..................................   التاريخ: ....../....../..........", body, x + 10, y + 56, w - 20, Layout.Alignment.ALIGN_NORMAL);
    }
}
