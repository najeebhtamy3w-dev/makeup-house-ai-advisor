package com.smartstock.core;

import org.xmlpull.v1.XmlPullParser;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Read-only access to the parts of an XLSX package that the importer needs. */
public final class XlsxPackage implements AutoCloseable {

    public interface ParserFactory { XmlPullParser newParser() throws Exception; }

    public static final class SheetRef {
        public final String name;
        public final String path;      // e.g. xl/worksheets/sheet5.xml
        public final boolean hidden;
        public SheetRef(String name, String path, boolean hidden) { this.name = name; this.path = path; this.hidden = hidden; }
        @Override public String toString() { return name; }
    }

    public static final long MAX_UNCOMPRESSED = 400L * 1024 * 1024; // zip-bomb guard

    final ZipFile zip;
    final ParserFactory pf;
    public final String workbookPath;
    public final List<SheetRef> sheets = new ArrayList<>();
    List<String> sharedStrings;
    /** cellXfs index -> zero-padding width (>0 when number format is "000…0"), else 0. */
    int[] zeroPad;

    public XlsxPackage(File file, ParserFactory pf) throws IOException {
        try {
            this.zip = new ZipFile(file);
        } catch (IOException e) {
            throw new IOException("الملف ليس ملف Excel صالحًا (XLSX)", e);
        }
        this.pf = pf;
        long total = 0;
        for (java.util.Enumeration<? extends ZipEntry> en = zip.entries(); en.hasMoreElements(); ) {
            long s = en.nextElement().getSize();
            if (s > 0) total += s;
        }
        if (total > MAX_UNCOMPRESSED) { close(); throw new IOException("حجم محتوى الملف كبير جدًا"); }
        try {
            workbookPath = findWorkbook();
            readSheets();
        } catch (IOException e) {
            close();
            throw e;
        } catch (Exception e) {
            close();
            throw new IOException("تعذر قراءة بنية ملف Excel. جرّب فتحه في Excel وحفظه بصيغة xlsx ثم أعد الاستيراد.\n(تفاصيل تقنية: " + e.getMessage() + ")", e);
        }
    }

    public InputStream open(String path) throws IOException {
        ZipEntry e = zip.getEntry(path);
        if (e == null) return null;
        return zip.getInputStream(e);
    }

    public boolean has(String path) { return zip.getEntry(path) != null; }

    XmlPullParser parser(InputStream in) throws Exception {
        XmlPullParser p = pf.newParser();
        try { p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true); } catch (Exception ignored) {}
        p.setInput(cleanReader(in));
        return p;
    }

    /**
     * Some programs write a byte-order mark (UTF-8 EF BB BF, or UTF-16) and/or whitespace before
     * "&lt;?xml". Android's XmlPullParser rejects that ("Unexpected token @1:2"), so both are skipped here.
     */
    static java.io.Reader cleanReader(InputStream raw) throws java.io.IOException {
        java.io.BufferedInputStream in = new java.io.BufferedInputStream(raw, 1 << 16);
        in.mark(4);
        int b0 = in.read(), b1 = in.read(), b2 = in.read();
        java.nio.charset.Charset cs = StandardCharsets.UTF_8;
        if (b0 == 0xEF && b1 == 0xBB && b2 == 0xBF) {
            // UTF-8 BOM: already consumed
        } else if (b0 == 0xFF && b1 == 0xFE) {
            in.reset(); in.skip(2); cs = StandardCharsets.UTF_16LE;
        } else if (b0 == 0xFE && b1 == 0xFF) {
            in.reset(); in.skip(2); cs = StandardCharsets.UTF_16BE;
        } else {
            in.reset();
        }
        java.io.PushbackReader r = new java.io.PushbackReader(new java.io.BufferedReader(new InputStreamReader(in, cs), 1 << 16), 1);
        int c;
        while ((c = r.read()) != -1 && (c == '\uFEFF' || Character.isWhitespace(c))) { /* skip */ }
        if (c != -1) r.unread(c);
        return r;
    }

    static String resolve(String baseDir, String target) {
        if (target.startsWith("/")) return target.substring(1);
        String path = baseDir.isEmpty() ? target : baseDir + "/" + target;
        // normalize ../
        List<String> out = new ArrayList<>();
        for (String seg : path.split("/")) {
            if (seg.equals("..")) { if (!out.isEmpty()) out.remove(out.size() - 1); }
            else if (!seg.equals(".") && !seg.isEmpty()) out.add(seg);
        }
        return String.join("/", out);
    }

    static String dirOf(String path) { int i = path.lastIndexOf('/'); return i < 0 ? "" : path.substring(0, i); }

    static String relsOf(String path) {
        String d = dirOf(path), n = path.substring(path.lastIndexOf('/') + 1);
        return (d.isEmpty() ? "" : d + "/") + "_rels/" + n + ".rels";
    }

    private String findWorkbook() throws Exception {
        InputStream in = open("_rels/.rels");
        if (in != null) {
            try (InputStream s = in) {
                XmlPullParser p = parser(s);
                for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                    if (ev == XmlPullParser.START_TAG && "Relationship".equals(p.getName())) {
                        String type = p.getAttributeValue(null, "Type");
                        if (type != null && type.endsWith("/officeDocument"))
                            return resolve("", p.getAttributeValue(null, "Target"));
                    }
                }
            }
        }
        if (has("xl/workbook.xml")) return "xl/workbook.xml";
        throw new IOException("الملف لا يحتوي على مصنف Excel");
    }

    private void readSheets() throws Exception {
        Map<String, String> rels = new HashMap<>();
        InputStream rin = open(relsOf(workbookPath));
        if (rin == null) throw new IOException("علاقات المصنف مفقودة");
        try (InputStream s = rin) {
            XmlPullParser p = parser(s);
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG && "Relationship".equals(p.getName())) {
                    String type = p.getAttributeValue(null, "Type");
                    if (type != null && type.endsWith("/worksheet"))
                        rels.put(p.getAttributeValue(null, "Id"), resolve(dirOf(workbookPath), p.getAttributeValue(null, "Target")));
                }
            }
        }
        try (InputStream s = open(workbookPath)) {
            XmlPullParser p = parser(s);
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG && "sheet".equals(p.getName())) {
                    String name = p.getAttributeValue(null, "name");
                    String rid = null;
                    for (int i = 0; i < p.getAttributeCount(); i++)
                        if ("id".equals(p.getAttributeName(i)) && p.getAttributeNamespace(i) != null
                                && p.getAttributeNamespace(i).contains("relationships")) rid = p.getAttributeValue(i);
                    String state = p.getAttributeValue(null, "state");
                    String path = rels.get(rid);
                    if (path != null && has(path))
                        sheets.add(new SheetRef(name, path, state != null && !state.equals("visible")));
                }
            }
        }
        if (sheets.isEmpty()) throw new IOException("لا توجد أوراق عمل في الملف");
    }

    /** The approved sheet "تصدير بلاس"; or the only (visible) sheet; or null when the user must choose. */
    public SheetRef defaultSheet() {
        for (SheetRef s : sheets) if (ArabicText.header(s.name).equals("تصدير بلاس")) return s;
        if (sheets.size() == 1) return sheets.get(0);
        List<SheetRef> visible = new ArrayList<>();
        for (SheetRef s : sheets) if (!s.hidden) visible.add(s);
        return visible.size() == 1 ? visible.get(0) : null;
    }

    public SheetRef sheetByPath(String path) {
        for (SheetRef s : sheets) if (s.path.equals(path)) return s;
        return null;
    }

    List<String> sharedStrings() throws Exception {
        if (sharedStrings != null) return sharedStrings;
        sharedStrings = new ArrayList<>();
        String path = null;
        InputStream rin = open(relsOf(workbookPath));
        if (rin != null) try (InputStream s = rin) {
            XmlPullParser p = parser(s);
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next())
                if (ev == XmlPullParser.START_TAG && "Relationship".equals(p.getName())) {
                    String type = p.getAttributeValue(null, "Type");
                    if (type != null && type.endsWith("/sharedStrings"))
                        path = resolve(dirOf(workbookPath), p.getAttributeValue(null, "Target"));
                }
        }
        if (path == null) path = "xl/sharedStrings.xml";
        InputStream in = open(path);
        if (in == null) return sharedStrings;
        try (InputStream s = in) {
            XmlPullParser p = parser(s);
            StringBuilder cur = null;
            int rph = 0;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG) {
                    String n = p.getName();
                    if ("si".equals(n)) cur = new StringBuilder();
                    else if ("rPh".equals(n)) rph++;
                    else if ("t".equals(n) && cur != null && rph == 0) cur.append(p.nextText());
                } else if (ev == XmlPullParser.END_TAG) {
                    String n = p.getName();
                    if ("si".equals(n) && cur != null) { sharedStrings.add(cur.toString()); cur = null; }
                    else if ("rPh".equals(n)) rph--;
                }
            }
        }
        return sharedStrings;
    }

    int[] zeroPad() throws Exception {
        if (zeroPad != null) return zeroPad;
        Map<Integer, String> fmts = new HashMap<>();
        List<Integer> xfs = new ArrayList<>();
        String path = resolve(dirOf(workbookPath), "styles.xml");
        InputStream in = open(path);
        if (in != null) try (InputStream s = in) {
            XmlPullParser p = parser(s);
            boolean inCellXfs = false;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG) {
                    String n = p.getName();
                    if ("numFmt".equals(n)) {
                        try { fmts.put(Integer.parseInt(p.getAttributeValue(null, "numFmtId")), p.getAttributeValue(null, "formatCode")); } catch (Exception ignored) {}
                    } else if ("cellXfs".equals(n)) inCellXfs = true;
                    else if ("xf".equals(n) && inCellXfs) {
                        String id = p.getAttributeValue(null, "numFmtId");
                        try { xfs.add(id == null ? 0 : Integer.parseInt(id)); } catch (Exception e) { xfs.add(0); }
                    }
                } else if (ev == XmlPullParser.END_TAG && "cellXfs".equals(p.getName())) inCellXfs = false;
            }
        }
        zeroPad = new int[xfs.size()];
        for (int i = 0; i < xfs.size(); i++) {
            String code = fmts.get(xfs.get(i));
            if (code != null && code.replace("\"", "").matches("0{2,}")) zeroPad[i] = code.replace("\"", "").length();
        }
        return zeroPad;
    }

    @Override public void close() {
        try { zip.close(); } catch (IOException ignored) {}
    }
}
