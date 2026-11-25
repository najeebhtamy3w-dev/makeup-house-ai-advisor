package com.smartstock.core;

import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Re-opens an exported workbook and checks, row by row, that it matches the session:
 * headers kept, names/barcodes/costs unchanged, quantity and total equal to the database values.
 */
public final class ExportVerifier {
    private ExportVerifier() {}

    public static final class Expected {
        public int rowNum; public String name, barcode; public BigDecimal cost, qty, total;
    }

    public static final class Report {
        public int checkedRows;
        public BigDecimal sumQty = BigDecimal.ZERO, sumTotal = BigDecimal.ZERO;
        public String error; // null => OK
    }

    public static Report verify(File exported, XlsxPackage.ParserFactory pf, String sheetPath, int headerRow,
                                ColumnMap map, int totalCol, List<String> originalHeaders, List<Expected> expected) throws IOException {
        Report rep = new Report();
        try (XlsxPackage pkg = new XlsxPackage(exported, pf)) {
            XlsxPackage.SheetRef sheet = pkg.sheetByPath(sheetPath);
            if (sheet == null) { rep.error = "الورقة مفقودة في الملف المصدّر"; return rep; }
            List<String> ss = pkg.sharedStrings();
            int[] pad = pkg.zeroPad();
            java.util.HashMap<Integer, Expected> byRow = new java.util.HashMap<>();
            for (Expected e : expected) byRow.put(e.rowNum, e);
            final int cN = map.get(Field.NAME), cB = map.get(Field.BARCODE), cQ = map.get(Field.QTY), cC = map.get(Field.COST);
            XlsxImporter.readRows(pkg, sheet.path, ss, pad, null, Integer.MAX_VALUE, (rowNum, cells) -> {
                if (rep.error != null) return false;
                if (rowNum == headerRow) {
                    for (int c = 0; c < originalHeaders.size(); c++) {
                        String h = originalHeaders.get(c);
                        XlsxImporter.Cell cell = cells.get(c);
                        String now = cell == null || cell.error ? null : cell.text.trim();
                        if (h != null && !h.isEmpty() && !h.equals(now)) { rep.error = "تغير عنوان العمود " + ColumnMap.colLetters(c); return false; }
                    }
                    XlsxImporter.Cell tc = cells.get(totalCol);
                    if (tc == null || tc.text.trim().isEmpty()) { rep.error = "عنوان عمود الإجمالي مفقود"; return false; }
                    return true;
                }
                Expected e = byRow.get(rowNum);
                if (e == null) return true;
                String name = XlsxImporter.txt(cells, cN);
                XlsxImporter.Cell b = cells.get(cB);
                String barcode = b == null || b.error ? "" : XlsxImporter.barcodeText(b);
                if (!e.barcode.equals(barcode)) { rep.error = "الباركود تغير في الصف " + rowNum; return false; }
                if (!e.name.startsWith("(بدون اسم)") && !e.name.equals(name)) { rep.error = "اسم الصنف تغير في الصف " + rowNum; return false; }
                XlsxImporter.Cell c = cells.get(cC);
                BigDecimal cost = c == null || c.error ? null : (c.number ? Num.parseCell(c.text) : Num.parseUser(c.text));
                if (e.cost != null && (cost == null || cost.compareTo(e.cost) != 0)) { rep.error = "التكلفة تغيرت في الصف " + rowNum; return false; }
                XlsxImporter.Cell q = cells.get(cQ);
                BigDecimal qty = q == null || !q.number ? null : Num.parseCell(q.text);
                if (qty == null || qty.compareTo(e.qty) != 0) { rep.error = "الكمية غير مطابقة في الصف " + rowNum; return false; }
                XlsxImporter.Cell t = cells.get(totalCol);
                BigDecimal total = t == null || !t.number ? null : Num.parseCell(t.text);
                if (e.total == null ? total != null : (total == null || total.compareTo(e.total) != 0)) {
                    rep.error = "الإجمالي غير مطابق في الصف " + rowNum; return false;
                }
                rep.checkedRows++;
                rep.sumQty = rep.sumQty.add(qty);
                if (total != null) rep.sumTotal = rep.sumTotal.add(total);
                return true;
            });
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("تعذر التحقق من الملف المصدّر: " + e.getMessage(), e);
        }
        if (rep.error == null && rep.checkedRows != expected.size())
            rep.error = "عدد الأصناف في الملف المصدّر (" + rep.checkedRows + ") لا يطابق الجلسة (" + expected.size() + ")";
        return rep;
    }

}
