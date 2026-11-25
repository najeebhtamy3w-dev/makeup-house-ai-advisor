package com.smartstock.core;

import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;

/** Test helpers: parser factory, fixture access and a tiny synthetic XLSX writer for large files. */
public final class TestUtil {
    public static final XlsxPackage.ParserFactory PF = org.kxml2.io.KXmlParser::new;

    public static File fixture(String name) throws IOException {
        InputStream in = TestUtil.class.getResourceAsStream("/fixtures/" + name);
        if (in == null) throw new FileNotFoundException(name);
        File f = File.createTempFile("fixture", ".xlsx");
        f.deleteOnExit();
        try (OutputStream o = new FileOutputStream(f)) { in.transferTo(o); }
        return f;
    }

    public static XlsxImporter.Result importAuto(File f) throws IOException {
        try (XlsxPackage pkg = new XlsxPackage(f, PF)) {
            XlsxPackage.SheetRef s = pkg.defaultSheet();
            XlsxImporter.HeaderScan h = XlsxImporter.scanHeader(pkg, s);
            if (h.match.needsManualMapping) throw new IOException("needs mapping: " + h.match.problems);
            return XlsxImporter.read(pkg, s, h.headerRow, h.match.map, h.headers, null);
        }
    }

    /** Writes a synthetic "تصدير_بلاس"-style workbook with n items (shared strings, Excel-like parts). */
    public static File bigWorkbook(int n, boolean withTotal) throws IOException {
        File f = File.createTempFile("big_" + n, ".xlsx");
        f.deleteOnExit();
        List<String> sst = new ArrayList<>();
        Map<String, Integer> idx = new HashMap<>();
        java.util.function.Function<String, Integer> s = t -> idx.computeIfAbsent(t, k -> { sst.add(k); return sst.size() - 1; });
        StringBuilder sh = new StringBuilder(n * 400);
        sh.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><dimension ref=\"A1:").append(withTotal ? "I" : "H").append(n + 1).append("\"/><sheetData>");
        String[] h = {"اسم المجموعة", "اسم الصنف", "الوحدة", "العبوة", "الباركود", "الكمية", "التكلفة", "تاريخ الانتهاء", "إجمالي تكلفة الصف"};
        sh.append("<row r=\"1\">");
        for (int c = 0; c < (withTotal ? 9 : 8); c++) sh.append("<c r=\"").append(ColumnMap.colLetters(c)).append("1\" t=\"s\"><v>").append(s.apply(h[c])).append("</v></c>");
        sh.append("</row>");
        for (int i = 1; i <= n; i++) {
            int r = i + 1;
            sh.append("<row r=\"").append(r).append("\">");
            sh.append("<c r=\"A").append(r).append("\" t=\"s\"><v>").append(s.apply("مجموعة " + (i % 40))).append("</v></c>");
            sh.append("<c r=\"B").append(r).append("\" t=\"s\"><v>").append(s.apply("صنف تجريبي رقم " + i)).append("</v></c>");
            sh.append("<c r=\"C").append(r).append("\" t=\"s\"><v>").append(s.apply("قطعة")).append("</v></c>");
            sh.append("<c r=\"D").append(r).append("\" t=\"s\"><v>").append(s.apply("حبة")).append("</v></c>");
            sh.append("<c r=\"E").append(r).append("\" t=\"s\"><v>").append(s.apply(String.format("62%011d", i))).append("</v></c>");
            sh.append("<c r=\"F").append(r).append("\"><v>0</v></c>");
            sh.append("<c r=\"G").append(r).append("\"><v>").append(cost(i).toPlainString()).append("</v></c>");
            if (withTotal) sh.append("<c r=\"I").append(r).append("\"><f>F").append(r).append("*G").append(r).append("</f><v>0</v></c>");
            sh.append("</row>");
        }
        sh.append("</sheetData></worksheet>");
        StringBuilder ss = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"" + sst.size() + "\" uniqueCount=\"" + sst.size() + "\">");
        for (String t : sst) ss.append("<si><t>").append(XmlTokens.escape(t)).append("</t></si>");
        ss.append("</sst>");
        try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(f))) {
            put(z, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/></Types>");
            put(z, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            put(z, "xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"تصدير_بلاس\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            put(z, "xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/></Relationships>");
            put(z, "xl/worksheets/sheet1.xml", sh.toString());
            put(z, "xl/sharedStrings.xml", ss.toString());
        }
        return f;
    }

    public static BigDecimal cost(int i) { return new BigDecimal(i % 997).add(new BigDecimal("0.28")).add(new BigDecimal(i % 7).movePointLeft(3)); }

    static void put(ZipOutputStream z, String name, String content) throws IOException {
        z.putNextEntry(new ZipEntry(name));
        z.write(content.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }

    public static String entry(File xlsx, String name) throws IOException {
        try (ZipFile z = new ZipFile(xlsx)) {
            ZipEntry e = z.getEntry(name);
            if (e == null) return null;
            return new String(z.getInputStream(e).readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
