package com.smartstock.core;

import org.xmlpull.v1.XmlPullParser;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Streaming XLSX sheet reader (XmlPullParser, constant memory per row) for 50,000+ rows.
 * Never modifies the workbook. Barcodes are read as text; numeric values keep exact decimals.
 */
public final class XlsxImporter {
    private XlsxImporter() {}

    public interface Progress {
        void onRows(int rowsRead);
        boolean isCancelled();
    }

    /** A cell as read from the sheet. */
    static final class Cell {
        String text = "";      // display text ("" when empty)
        boolean number;        // value is numeric
        boolean error;         // #N/A, #NAME?, ...
        boolean formula;       // has <f>
        boolean noCachedValue; // formula without a computed value
        int style;
        boolean isBlank() { return !error && text.trim().isEmpty(); }
    }

    public static final class HeaderScan {
        public int headerRow;                 // 1-based sheet row number
        public final List<String> headers = new ArrayList<>(); // zero-based col -> header text
        public ColumnMatcher.Result match;
    }

    public static final class Row {
        public int rowNum;
        public String group = "", name = "", unit = "", pack = "", barcode = "";
        public BigDecimal cost;          // null => invalid / unknown
        public String costIssue;         // why cost is invalid
        public boolean costFromFormula;
        public String qtyIssue;
        public BigDecimal fileQty;       // quantity found in file (informational)
    }

    public static final class Result {
        public String sheetName, sheetPath;
        public int headerRow;
        public ColumnMap map;
        public List<String> headers;
        public final List<Row> rows = new ArrayList<>();
        public int maxColumn;            // zero-based highest used column in sheet
        public int emptyRowsInside;      // blank rows between items
        public int trailingEmptyRows;    // prepared/blank rows after last item (ignored)
        public int duplicateBarcodeRows; // rows whose barcode appears more than once
        public int duplicateBarcodeValues;
        public int noBarcode;
        public int invalidCost;
        public int formulaCostNoValue;
        public int formulaCosts;
        public int invalidQty;
        public int nonZeroFileQty;
        public int skippedErrorRows;     // only formula errors, nothing identifiable
        public int skippedIncompleteRows;// data but no name and no barcode
        public int longNumericBarcodes;  // >15 digits stored as number (precision risk)
        public final List<String> warnings = new ArrayList<>();
    }

    // ------------------------------------------------------------------ header

    public static HeaderScan scanHeader(XlsxPackage pkg, XlsxPackage.SheetRef sheet) throws IOException {
        try {
            List<String> ss = pkg.sharedStrings();
            int[] pad = pkg.zeroPad();
            HeaderScan best = null; int bestHits = 0;
            List<Map<Integer, Cell>> firstRows = new ArrayList<>();
            List<Integer> rowNums = new ArrayList<>();
            readRows(pkg, sheet.path, ss, pad, null, 30, (rowNum, cells) -> { firstRows.add(cells); rowNums.add(rowNum); return true; });
            for (int i = 0; i < firstRows.size(); i++) {
                Map<Integer, Cell> cells = firstRows.get(i);
                int max = -1; for (int c : cells.keySet()) max = Math.max(max, c);
                List<String> headers = new ArrayList<>();
                for (int c = 0; c <= max; c++) { Cell cell = cells.get(c); headers.add(cell == null || cell.error ? null : cell.text.trim()); }
                ColumnMatcher.Result m = ColumnMatcher.match(headers);
                if (m.exactHits > bestHits) {
                    bestHits = m.exactHits;
                    best = new HeaderScan();
                    best.headerRow = rowNums.get(i);
                    best.headers.addAll(headers);
                    best.match = m;
                }
            }
            if (best == null || bestHits < 2) {
                // fall back to first non-empty row; user maps manually
                best = new HeaderScan();
                for (int i = 0; i < firstRows.size(); i++) {
                    if (!firstRows.get(i).isEmpty()) {
                        Map<Integer, Cell> cells = firstRows.get(i);
                        int max = -1; for (int c : cells.keySet()) max = Math.max(max, c);
                        for (int c = 0; c <= max; c++) { Cell cell = cells.get(c); best.headers.add(cell == null ? null : cell.text.trim()); }
                        best.headerRow = rowNums.get(i);
                        break;
                    }
                }
                best.match = ColumnMatcher.match(best.headers);
                best.match.needsManualMapping = true;
                if (best.headerRow == 0) throw new IOException("الورقة فارغة");
            }
            return best;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("تعذر قراءة رؤوس الأعمدة: " + e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------------ full read

    public static Result read(XlsxPackage pkg, XlsxPackage.SheetRef sheet, int headerRow, ColumnMap map,
                              List<String> headers, Progress progress) throws IOException {
        String err = map.validate();
        if (err != null) throw new IOException(err);
        Result r = new Result();
        r.sheetName = sheet.name; r.sheetPath = sheet.path; r.headerRow = headerRow; r.map = new ColumnMap(map); r.headers = headers;
        final int cG = map.getOr(Field.GROUP, -1), cN = map.get(Field.NAME), cU = map.getOr(Field.UNIT, -1),
                cP = map.getOr(Field.PACK, -1), cB = map.get(Field.BARCODE), cQ = map.get(Field.QTY), cC = map.get(Field.COST);
        final int[] pendingEmpty = {0};
        final int[] lastItemRow = {0}, skippedSince = {0};
        final int[] maxCol = {headers.size() - 1};
        final int[] count = {0};
        try {
            List<String> ss = pkg.sharedStrings();
            int[] pad = pkg.zeroPad();
            readRows(pkg, sheet.path, ss, pad, maxCol, Integer.MAX_VALUE, (rowNum, cells) -> {
                if (progress != null) {
                    if (++count[0] % 500 == 0) progress.onRows(count[0]);
                    if (progress.isCancelled()) return false;
                }
                if (rowNum <= headerRow) return true;
                Cell n = cells.get(cN), b = cells.get(cB), c = cells.get(cC), q = cells.get(cQ);
                boolean anyData = false, anyError = false;
                for (int col : new int[]{cG, cN, cU, cP, cB, cQ, cC}) {
                    if (col < 0) continue;
                    Cell x = cells.get(col);
                    if (x == null) continue;
                    if (x.error) anyError = true;
                    else if (!x.isBlank() && !(col == cQ && isZero(x))) anyData = true;
                }
                String name = n == null || n.error ? "" : n.text.trim();
                String barcode = b == null || b.error ? "" : barcodeText(b);
                if (name.isEmpty() && barcode.isEmpty()) {
                    if (anyError) { r.skippedErrorRows++; skippedSince[0]++; }
                    else if (anyData) { r.skippedIncompleteRows++; skippedSince[0]++; }
                    else { pendingEmpty[0]++; }
                    return true;
                }
                // blank rows between two items = row-number gap minus skipped non-blank rows
                if (lastItemRow[0] > 0) r.emptyRowsInside += Math.max(0, rowNum - lastItemRow[0] - 1 - skippedSince[0]);
                lastItemRow[0] = rowNum; skippedSince[0] = 0;
                pendingEmpty[0] = 0;
                Row row = new Row();
                row.rowNum = rowNum;
                row.name = name.isEmpty() ? "(بدون اسم) " + barcode : name;
                row.barcode = barcode;
                if (b != null && b.number && digits(barcode) > 15) r.longNumericBarcodes++;
                row.group = txt(cells, cG); row.unit = txt(cells, cU); row.pack = txt(cells, cP);
                // cost
                if (c == null || c.isBlank()) {
                    row.costIssue = c != null && c.noCachedValue ? "تكلفة ناتجة عن معادلة دون قيمة محسوبة" : "التكلفة فارغة";
                    if (c != null && c.noCachedValue) r.formulaCostNoValue++;
                } else if (c.error) {
                    row.costIssue = "خطأ في خلية التكلفة: " + c.text;
                } else {
                    BigDecimal v = c.number ? Num.parseCell(c.text) : Num.parseUser(c.text);
                    if (v == null) row.costIssue = "تكلفة غير رقمية: " + c.text;
                    else if (v.signum() < 0) row.costIssue = "تكلفة سالبة: " + c.text;
                    else row.cost = v;
                    row.costFromFormula = c.formula;
                    if (c.formula && row.cost != null) r.formulaCosts++;
                }
                if (row.cost == null) r.invalidCost++;
                // quantity found in file (informational: counting always starts from zero)
                if (q != null && !q.isBlank()) {
                    if (q.error) { row.qtyIssue = "خطأ في خلية الكمية"; r.invalidQty++; }
                    else {
                        BigDecimal v = q.number ? Num.parseCell(q.text) : Num.parseUser(q.text);
                        if (v == null || v.signum() < 0) { row.qtyIssue = "كمية غير صالحة: " + q.text; r.invalidQty++; }
                        else { row.fileQty = v; if (v.signum() != 0) r.nonZeroFileQty++; }
                    }
                }
                if (barcode.isEmpty()) r.noBarcode++;
                r.rows.add(row);
                return true;
            });
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("تعذر قراءة الورقة: " + e.getMessage(), e);
        }
        if (progress != null && progress.isCancelled()) throw new IOException("تم إلغاء الاستيراد");
        r.trailingEmptyRows = pendingEmpty[0];
        r.maxColumn = maxCol[0];
        Map<String, Integer> freq = new HashMap<>();
        for (Row row : r.rows) if (!row.barcode.isEmpty()) freq.merge(row.barcode, 1, Integer::sum);
        for (Map.Entry<String, Integer> e : freq.entrySet()) if (e.getValue() > 1) { r.duplicateBarcodeValues++; r.duplicateBarcodeRows += e.getValue(); }
        if (r.rows.isEmpty()) {
            if (r.skippedErrorRows > 0)
                throw new IOException("لا توجد أصناف في الورقة المختارة. يوجد " + r.skippedErrorRows + " صف يحتوي أخطاء معادلات (مثل #NAME?) بدل القيم؛ افتح الملف في Excel لحساب المعادلات أو الصق البيانات كقيم ثم أعد الاستيراد.");
            throw new IOException("لا توجد أصناف في الورقة المختارة");
        }
        if (r.invalidCost > 0) r.warnings.add("يوجد " + r.invalidCost + " صنف بتكلفة غير صالحة. لن تُحتسب قيمتها في الإجمالي المالي حتى تُصحح في ملف Excel.");
        if (r.formulaCostNoValue > 0) r.warnings.add(r.formulaCostNoValue + " تكلفة ناتجة عن معادلة لا تحتوي قيمة محسوبة. افتح الملف في Excel واحفظه ثم أعد الاستيراد.");
        if (r.nonZeroFileQty > 0) r.warnings.add("يحتوي الملف على " + r.nonZeroFileQty + " كمية غير صفرية. يبدأ الجرد من الصفر، وتُستبدل الكميات عند التصدير.");
        if (r.longNumericBarcodes > 0) r.warnings.add(r.longNumericBarcodes + " باركود مخزن كرقم أطول من 15 خانة وقد يكون Excel قد فقد دقته. يُفضّل تخزين الباركود كنص.");
        return r;
    }

    // ------------------------------------------------------------------ helpers

    static boolean isZero(Cell x) {
        if (!x.number) return false;
        BigDecimal v = Num.parseCell(x.text);
        return v != null && v.signum() == 0;
    }

    static int digits(String s) { int n = 0; for (char ch : s.toCharArray()) if (Character.isDigit(ch)) n++; return n; }

    static String txt(Map<Integer, Cell> cells, int col) {
        if (col < 0) return "";
        Cell c = cells.get(col);
        if (c == null || c.error) return "";
        if (c.number) { BigDecimal v = Num.parseCell(c.text); return v == null ? c.text.trim() : v.toPlainString(); }
        return c.text.trim();
    }

    /** Barcode as text; numeric cells are rendered without exponent / ".0" and re-padded with leading zeros when the cell format demands it. */
    static String barcodeText(Cell c) {
        String t = c.text.trim();
        if (c.number) {
            BigDecimal v;
            try { v = new BigDecimal(t); } catch (NumberFormatException e) { return t; }
            if (v.precision() > 15) {
                // value written with 17 sig digits; show what Excel shows
                BigDecimal r = Num.parseCell(t);
                if (r != null) v = r;
            }
            v = Num.strip(v);
            t = v.toPlainString();
            if (c.style > 0 && c.style < PAD_HOLDER.get().length) {
                int w = PAD_HOLDER.get()[c.style];
                if (w > t.length() && v.scale() == 0 && v.signum() >= 0) {
                    StringBuilder b = new StringBuilder();
                    for (int i = t.length(); i < w; i++) b.append('0');
                    t = b + t;
                }
            }
        }
        return t;
    }

    private static final ThreadLocal<int[]> PAD_HOLDER = ThreadLocal.withInitial(() -> new int[0]);

    interface RowSink { boolean row(int rowNum, Map<Integer, Cell> cells) throws Exception; }

    /** Streams the sheet. maxColOut (optional) receives the highest column index seen. */
    static void readRows(XlsxPackage pkg, String path, List<String> ss, int[] pad, int[] maxColOut, int maxRows, RowSink sink) throws Exception {
        PAD_HOLDER.set(pad);
        InputStream in = pkg.open(path);
        if (in == null) throw new IOException("الورقة غير موجودة داخل الملف");
        try (InputStream s = in) {
            XmlPullParser p = pkg.parser(s);
            int rowNum = 0, rowsRead = 0;
            Map<Integer, Cell> cells = null;
            Cell cell = null; int col = -1; String type = null;
            boolean inIs = false; StringBuilder isText = null; boolean inSheetData = false;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG) {
                    String n = p.getName();
                    if ("sheetData".equals(n)) inSheetData = true;
                    else if (!inSheetData) continue;
                    else if ("row".equals(n)) {
                        String r = p.getAttributeValue(null, "r");
                        rowNum = r != null ? Integer.parseInt(r.trim()) : rowNum + 1;
                        cells = new HashMap<>();
                        col = -1;
                    } else if ("c".equals(n) && cells != null) {
                        String r = p.getAttributeValue(null, "r");
                        int ci = r != null ? ColumnMap.colIndex(r) : -1;
                        col = ci >= 0 ? ci : col + 1;
                        type = p.getAttributeValue(null, "t");
                        cell = new Cell();
                        String st = p.getAttributeValue(null, "s");
                        try { cell.style = st == null ? 0 : Integer.parseInt(st); } catch (NumberFormatException e) { cell.style = 0; }
                    } else if (cell != null && "f".equals(n)) {
                        cell.formula = true;
                    } else if (cell != null && "v".equals(n)) {
                        String v = p.nextText();
                        applyValue(cell, type, v, ss);
                    } else if (cell != null && "is".equals(n)) {
                        inIs = true; isText = new StringBuilder();
                    } else if (inIs && "t".equals(n)) {
                        isText.append(p.nextText());
                    }
                } else if (ev == XmlPullParser.END_TAG) {
                    String n = p.getName();
                    if ("is".equals(n) && cell != null) { inIs = false; cell.text = isText.toString(); }
                    else if ("c".equals(n) && cell != null) {
                        if (cell.formula && cell.text.isEmpty() && !cell.error && !"str".equals(type)) cell.noCachedValue = true;
                        if (!cell.isBlank() || cell.error || cell.formula) {
                            cells.put(col, cell);
                            if (maxColOut != null && col > maxColOut[0]) maxColOut[0] = col;
                        }
                        cell = null;
                    } else if ("row".equals(n) && cells != null) {
                        if (!sink.row(rowNum, cells)) return;
                        cells = null;
                        if (++rowsRead >= maxRows) return;
                    } else if ("sheetData".equals(n)) return;
                }
            }
        }
    }

    static void applyValue(Cell cell, String type, String v, List<String> ss) {
        if (v == null) v = "";
        if (type == null || type.equals("n")) {
            if (!v.trim().isEmpty()) { cell.text = v.trim(); cell.number = true; }
        } else if (type.equals("s")) {
            try { cell.text = ss.get(Integer.parseInt(v.trim())); } catch (Exception e) { cell.text = ""; }
        } else if (type.equals("e")) {
            cell.error = true; cell.text = v;
        } else if (type.equals("b")) {
            cell.text = "1".equals(v.trim()) ? "TRUE" : "FALSE";
        } else { // str, d, inlineStr with <v>
            cell.text = v;
        }
    }
}
