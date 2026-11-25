package com.smartstock.core;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Excel round-trip exporter. Copies every part of the original workbook unchanged, and in the
 * inventory sheet rewrites ONLY the quantity cell and the row-total cell of item rows (and adds the
 * total column header when the column did not exist). The sheet XML is streamed tag-by-tag, so all
 * other cells, styles, formulas, column widths, merged cells, etc. are preserved byte-for-byte.
 *
 * Side effects on the package (documented): calcChain.xml is removed (Excel rebuilds it) and the
 * workbook is flagged fullCalcOnLoad so that any formula referencing the updated cells is recomputed
 * when opened instead of showing stale cached values.
 */
public final class XlsxExporter {
    private XlsxExporter() {}

    public static final String TOTAL_HEADER = "إجمالي تكلفة الصف";

    public static final class RowValues {
        public final BigDecimal qty;
        public final BigDecimal total; // null => leave the total cell blank (unknown cost)
        public RowValues(BigDecimal qty, BigDecimal total) { this.qty = qty; this.total = total; }
    }

    public static final class Spec {
        public String sheetPath;
        public int headerRow;
        public int qtyCol;
        public int costCol;
        public int totalCol;
        public boolean totalColCreated;
        public Map<Integer, RowValues> values; // sheet row number -> values
    }

    public static final class Stats { public int rowsUpdated; public int formulasRemoved; }

    public static Stats export(File original, Spec spec, OutputStream out) throws IOException {
        Stats stats = new Stats();
        try (ZipFile zip = new ZipFile(original)) {
            if (zip.getEntry(spec.sheetPath) == null) throw new IOException("الورقة غير موجودة في الملف الأصلي");
            String calcChainPath = null;
            for (Enumeration<? extends ZipEntry> en = zip.entries(); en.hasMoreElements(); ) {
                String n = en.nextElement().getName();
                if (n.endsWith("calcChain.xml")) calcChainPath = n;
            }
            ZipOutputStream z = new ZipOutputStream(out);
            z.setLevel(6);
            for (Enumeration<? extends ZipEntry> en = zip.entries(); en.hasMoreElements(); ) {
                ZipEntry e = en.nextElement();
                String name = e.getName();
                if (name.equals(calcChainPath)) continue;
                ZipEntry ne = new ZipEntry(name);
                z.putNextEntry(ne);
                try (InputStream in = zip.getInputStream(e)) {
                    if (name.equals(spec.sheetPath)) {
                        Writer w = new BufferedWriter(new OutputStreamWriter(new NonClosing(z), StandardCharsets.UTF_8), 1 << 16);
                        rewriteSheet(new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8), 1 << 16), w, spec, stats);
                        w.flush();
                    } else if (name.equals("[Content_Types].xml") && calcChainPath != null) {
                        String s = readAll(in);
                        s = s.replaceAll("<Override[^>]*PartName=\"/" + Pattern.quote(calcChainPath) + "\"[^>]*/>", "");
                        z.write(s.getBytes(StandardCharsets.UTF_8));
                    } else if (name.endsWith("_rels/workbook.xml.rels") && calcChainPath != null) {
                        String s = readAll(in);
                        s = s.replaceAll("<Relationship[^>]*Target=\"[^\"]*calcChain\\.xml\"[^>]*/>", "");
                        z.write(s.getBytes(StandardCharsets.UTF_8));
                    } else if (name.matches("xl/workbook\\d*\\.xml") || name.endsWith("/workbook.xml")) {
                        z.write(setFullCalcOnLoad(readAll(in)).getBytes(StandardCharsets.UTF_8));
                    } else {
                        copy(in, z);
                    }
                }
                z.closeEntry();
            }
            z.finish();
            z.flush();
        }
        return stats;
    }

    // ------------------------------------------------------------------ workbook.xml

    static String setFullCalcOnLoad(String wb) {
        Matcher m = Pattern.compile("<((?:\\w+:)?)calcPr\\b([^>]*?)(/?)>").matcher(wb);
        if (m.find()) {
            String attrs = m.group(2);
            if (attrs.contains("fullCalcOnLoad=")) attrs = attrs.replaceAll("fullCalcOnLoad=\"[^\"]*\"", "fullCalcOnLoad=\"1\"");
            else attrs = attrs + " fullCalcOnLoad=\"1\"";
            return wb.substring(0, m.start()) + "<" + m.group(1) + "calcPr" + attrs + m.group(3) + ">" + wb.substring(m.end());
        }
        // insert after the last of sheets/functionGroups/externalReferences/definedNames
        int pos = -1; String prefix = "";
        for (String tag : new String[]{"sheets", "functionGroups", "externalReferences", "definedNames"}) {
            Matcher em = Pattern.compile("</((?:\\w+:)?)" + tag + ">").matcher(wb);
            while (em.find()) { if (em.end() > pos) { pos = em.end(); prefix = em.group(1); } }
            if (pos < 0) {
                Matcher sm = Pattern.compile("<((?:\\w+:)?)" + tag + "\\b[^>]*/>").matcher(wb);
                while (sm.find()) { if (sm.end() > pos) { pos = sm.end(); prefix = sm.group(1); } }
            }
        }
        if (pos < 0) return wb;
        return wb.substring(0, pos) + "<" + prefix + "calcPr fullCalcOnLoad=\"1\"/>" + wb.substring(pos);
    }

    // ------------------------------------------------------------------ sheet

    static void rewriteSheet(Reader in, Writer out, Spec spec, Stats stats) throws IOException {
        XmlTokens t = new XmlTokens(in);
        Set<String> removedSharedMasters = new HashSet<>();
        int lastRow = 0;
        boolean colsCovered = false; int colsMax = -1;
        String tok;
        while ((tok = t.next()) != null) {
            if (!t.isTag) { out.write(tok); continue; }
            String local = XmlTokens.localName(tok);
            boolean end = tok.startsWith("</");
            if (!end && local.equals("dimension") && spec.totalColCreated) {
                out.write(fixDimension(tok, spec.totalCol));
            } else if (!end && local.equals("col")) {
                int min = intAttr(tok, "min", 0), max = intAttr(tok, "max", 0);
                if (min - 1 <= spec.totalCol && spec.totalCol <= max - 1) colsCovered = true;
                colsMax = Math.max(colsMax, max - 1);
                out.write(tok);
            } else if (end && local.equals("cols") && spec.totalColCreated && !colsCovered && colsMax < spec.totalCol) {
                String prefix = XmlTokens.prefix(tok);
                int n = spec.totalCol + 1;
                out.write("<" + prefix + "col min=\"" + n + "\" max=\"" + n + "\" width=\"18\" customWidth=\"1\"/>");
                out.write(tok);
            } else if (!end && local.equals("row")) {
                String rAttr = XmlTokens.attr(tok, "r");
                int rowNum = rAttr != null ? Integer.parseInt(rAttr.trim()) : lastRow + 1;
                lastRow = rowNum;
                StringBuilder body = new StringBuilder();
                if (!tok.endsWith("/>")) {
                    String x;
                    while ((x = t.next()) != null) {
                        if (t.isTag && x.startsWith("</") && XmlTokens.localName(x).equals("row")) break;
                        body.append(x);
                    }
                }
                out.write(processRow(tok, body.toString(), rowNum, spec, removedSharedMasters, stats));
            } else {
                out.write(tok);
            }
        }
    }

    static String fixDimension(String tag, int totalCol) {
        String ref = XmlTokens.attr(tag, "ref");
        if (ref == null) return tag;
        String[] parts = ref.split(":");
        String last = parts[parts.length - 1];
        int col = ColumnMap.colIndex(last), row = ColumnMap.rowIndex(last);
        if (col >= totalCol || row < 0) return tag;
        String newRef = (parts.length == 2 ? parts[0] : "A1") + ":" + ColumnMap.colLetters(totalCol) + row;
        return tag.replace("ref=\"" + ref + "\"", "ref=\"" + newRef + "\"");
    }

    static int intAttr(String tag, String name, int def) {
        String v = XmlTokens.attr(tag, name);
        try { return v == null ? def : Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    static final class CellChunk {
        int col; String raw; String style;
    }

    static final Pattern F_TAG = Pattern.compile("<((?:\\w+:)?)f\\b([^>]*?)(/>|>(.*?)</(?:\\w+:)?f>)", Pattern.DOTALL);

    static String processRow(String rowTag, String body, int rowNum, Spec spec, Set<String> removedShared, Stats stats) throws IOException {
        RowValues vals = spec.values.get(rowNum);
        boolean isHeader = spec.totalColCreated && rowNum == spec.headerRow;
        // split body into cells and other chunks
        List<Object> parts = new ArrayList<>();
        XmlTokens t = new XmlTokens(new java.io.StringReader(body));
        String tok; int lastCol = -1;
        StringBuilder other = new StringBuilder();
        while ((tok = t.next()) != null) {
            if (t.isTag && !tok.startsWith("</") && XmlTokens.localName(tok).equals("c")) {
                if (other.length() > 0) { parts.add(other.toString()); other.setLength(0); }
                StringBuilder raw = new StringBuilder(tok);
                if (!tok.endsWith("/>")) {
                    String x;
                    while ((x = t.next()) != null) {
                        raw.append(x);
                        if (t.isTag && x.startsWith("</") && XmlTokens.localName(x).equals("c")) break;
                    }
                }
                CellChunk c = new CellChunk();
                String r = XmlTokens.attr(tok, "r");
                int ci = r != null ? ColumnMap.colIndex(r) : -1;
                c.col = ci >= 0 ? ci : lastCol + 1;
                lastCol = c.col;
                c.style = XmlTokens.attr(tok, "s");
                c.raw = raw.toString();
                parts.add(c);
            } else {
                other.append(tok);
            }
        }
        if (other.length() > 0) parts.add(other.toString());

        String prefix = XmlTokens.prefix(rowTag);
        boolean modified = false;

        // shared-formula dependents whose master was replaced -> keep cached value only
        if (!removedShared.isEmpty()) {
            for (Object o : parts) {
                if (!(o instanceof CellChunk)) continue;
                CellChunk c = (CellChunk) o;
                Matcher m = F_TAG.matcher(c.raw);
                if (m.find()) {
                    String fa = m.group(2);
                    String si = XmlTokens.attr("<f" + fa + ">", "si");
                    if (si != null && fa.contains("shared") && removedShared.contains(si)) {
                        c.raw = c.raw.substring(0, m.start()) + c.raw.substring(m.end());
                        stats.formulasRemoved++;
                        modified = true;
                    }
                }
            }
        }

        if (vals != null) {
            String costStyle = null;
            for (Object o : parts) if (o instanceof CellChunk && ((CellChunk) o).col == spec.costCol) costStyle = ((CellChunk) o).style;
            setCell(parts, spec.qtyCol, rowNum, prefix, Num.plain(vals.qty), null, null, removedShared, stats);
            setCell(parts, spec.totalCol, rowNum, prefix, vals.total == null ? null : Num.plain(vals.total), null,
                    spec.totalColCreated ? costStyle : null, removedShared, stats);
            stats.rowsUpdated++;
            modified = true;
        } else if (isHeader) {
            String costStyle = null;
            for (Object o : parts) if (o instanceof CellChunk && ((CellChunk) o).col == spec.costCol) costStyle = ((CellChunk) o).style;
            setCell(parts, spec.totalCol, rowNum, prefix, null, TOTAL_HEADER, costStyle, removedShared, stats);
            modified = true;
        }

        StringBuilder sb = new StringBuilder();
        String startTag = rowTag;
        if (modified) {
            startTag = startTag.replaceAll("\\s+spans=\"[^\"]*\"", "");
            if (startTag.endsWith("/>")) startTag = startTag.substring(0, startTag.length() - 2).replaceAll("\\s+$", "") + ">";
        }
        boolean selfClosing = startTag.endsWith("/>");
        sb.append(startTag);
        if (selfClosing) return sb.toString();
        for (Object o : parts) sb.append(o instanceof CellChunk ? ((CellChunk) o).raw : (String) o);
        sb.append("</").append(prefix).append("row>");
        return sb.toString();
    }

    /** Replace or insert the cell at column col. number==null && text==null => blank cell. */
    static void setCell(List<Object> parts, int col, int rowNum, String prefix, String number, String text,
                        String styleIfNew, Set<String> removedShared, Stats stats) {
        String ref = ColumnMap.colLetters(col) + rowNum;
        int insertAt = -1; CellChunk existing = null;
        for (int i = 0; i < parts.size(); i++) {
            Object o = parts.get(i);
            if (!(o instanceof CellChunk)) continue;
            CellChunk c = (CellChunk) o;
            if (c.col == col) { existing = c; break; }
            if (c.col > col) { insertAt = i; break; }
        }
        String style = existing != null ? existing.style : styleIfNew;
        if (existing != null) {
            Matcher m = F_TAG.matcher(existing.raw);
            if (m.find()) {
                stats.formulasRemoved++;
                String fa = m.group(2);
                String si = XmlTokens.attr("<f" + fa + ">", "si");
                if (si != null && fa.contains("shared") && fa.contains("ref=")) removedShared.add(si);
            }
        }
        StringBuilder c = new StringBuilder();
        c.append('<').append(prefix).append("c r=\"").append(ref).append('"');
        if (style != null) c.append(" s=\"").append(style).append('"');
        if (number != null) {
            c.append("><").append(prefix).append("v>").append(number).append("</").append(prefix).append("v></").append(prefix).append("c>");
        } else if (text != null) {
            c.append(" t=\"inlineStr\"><").append(prefix).append("is><").append(prefix).append("t>")
                    .append(XmlTokens.escape(text)).append("</").append(prefix).append("t></").append(prefix)
                    .append("is></").append(prefix).append("c>");
        } else {
            c.append("/>");
        }
        CellChunk nc = new CellChunk();
        nc.col = col; nc.style = style; nc.raw = c.toString();
        if (existing != null) parts.set(parts.indexOf(existing), nc);
        else if (insertAt >= 0) parts.add(insertAt, nc);
        else {
            int lastCell = -1;
            for (int i = 0; i < parts.size(); i++) if (parts.get(i) instanceof CellChunk) lastCell = i;
            parts.add(lastCell + 1, nc);
        }
    }

    // ------------------------------------------------------------------ io

    static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        copy(in, b);
        return b.toString("UTF-8");
    }

    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    static final class NonClosing extends java.io.FilterOutputStream {
        NonClosing(OutputStream o) { super(o); }
        @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); }
        @Override public void close() throws IOException { flush(); }
    }
}
