package com.smartstock.core;

import org.junit.Test;
import java.io.*;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.Assert.*;

public class XlsxExportTest {

    static File export(File src, XlsxImporter.Result r, Map<Integer, BigDecimal> qtyByRow) throws Exception {
        XlsxExporter.Spec s = new XlsxExporter.Spec();
        s.sheetPath = r.sheetPath; s.headerRow = r.headerRow;
        s.qtyCol = r.map.get(Field.QTY); s.costCol = r.map.get(Field.COST);
        s.totalColCreated = !r.map.has(Field.TOTAL);
        s.totalCol = s.totalColCreated ? r.maxColumn + 1 : r.map.get(Field.TOTAL);
        s.values = new HashMap<>();
        for (XlsxImporter.Row row : r.rows) {
            BigDecimal q = qtyByRow.getOrDefault(row.rowNum, BigDecimal.ZERO);
            s.values.put(row.rowNum, new XlsxExporter.RowValues(q, Num.total(q, row.cost)));
        }
        File out = File.createTempFile("out_", ".xlsx");
        out.deleteOnExit();
        try (OutputStream o = new FileOutputStream(out)) { XlsxExporter.export(src, s, o); }
        // verify with the app's own verifier
        List<ExportVerifier.Expected> exp = new ArrayList<>();
        for (XlsxImporter.Row row : r.rows) {
            ExportVerifier.Expected e = new ExportVerifier.Expected();
            e.rowNum = row.rowNum; e.name = row.name; e.barcode = row.barcode; e.cost = row.cost;
            e.qty = qtyByRow.getOrDefault(row.rowNum, BigDecimal.ZERO); e.total = Num.total(e.qty, row.cost);
            exp.add(e);
        }
        ExportVerifier.Report rep = ExportVerifier.verify(out, TestUtil.PF, s.sheetPath, s.headerRow, r.map, s.totalCol, r.headers, exp);
        assertNull(rep.error, rep.error);
        assertEquals(r.rows.size(), rep.checkedRows);
        return out;
    }

    @Test public void roundTripPreservesEverythingAndAddsTotalColumn() throws Exception {
        File src = TestUtil.fixture("f10_multisheet.xlsx");
        byte[] before = java.nio.file.Files.readAllBytes(src.toPath());
        XlsxImporter.Result r = TestUtil.importAuto(src);
        Map<Integer, BigDecimal> q = new HashMap<>();
        q.put(r.rows.get(0).rowNum, new BigDecimal("20"));    // 25.50 x 20 = 510
        q.put(r.rows.get(1).rowNum, new BigDecimal("100"));   // 0.28 x 100 = 28
        File out = export(src, r, q);
        assertArrayEquals("original must not be modified", before, java.nio.file.Files.readAllBytes(src.toPath()));

        XlsxImporter.Result again = TestUtil.importAuto(out);
        assertEquals(r.rows.size(), again.rows.size());
        assertEquals(Integer.valueOf(10), again.map.get(Field.TOTAL)); // created in K
        for (int i = 0; i < r.rows.size(); i++) {
            assertEquals(r.rows.get(i).name, again.rows.get(i).name);
            assertEquals(r.rows.get(i).barcode, again.rows.get(i).barcode);
            assertEquals(r.rows.get(i).group, again.rows.get(i).group);
            assertEquals(r.rows.get(i).pack, again.rows.get(i).pack);
            assertEquals(0, r.rows.get(i).cost.compareTo(again.rows.get(i).cost));
        }
        assertEquals(0, again.rows.get(0).fileQty.compareTo(new BigDecimal(20)));
        String sheet = TestUtil.entry(out, r.sheetPath);
        assertTrue(sheet.contains("<c r=\"K2\""));
        assertTrue(sheet.contains("<v>510</v>"));
        assertTrue(sheet.contains("<v>28</v>"));
        assertTrue(sheet.contains(XlsxExporter.TOTAL_HEADER));
        assertTrue(sheet.contains("<c r=\"J2\" s=\"1\" t=\"s\"><v>19</v></c>")); // extra column kept byte-for-byte
        assertTrue(sheet.contains("dimension ref=\"A1:K"));
        // the formula of the cost cell is preserved (it is not a target column)
        assertTrue(sheet.contains("<f ") || sheet.contains("<f>"));
        // other sheets untouched
        assertEquals(TestUtil.entry(src, "xl/worksheets/sheet1.xml"), TestUtil.entry(out, "xl/worksheets/sheet1.xml"));
        assertEquals(TestUtil.entry(src, "xl/styles.xml"), TestUtil.entry(out, "xl/styles.xml"));
        assertEquals(TestUtil.entry(src, "xl/sharedStrings.xml"), TestUtil.entry(out, "xl/sharedStrings.xml"));
        assertTrue(TestUtil.entry(out, "xl/workbook.xml").contains("fullCalcOnLoad=\"1\""));
    }

    @Test public void existingTotalColumnWithFormulasIsReplacedByValues() throws Exception {
        File src = TestUtil.fixture("f_single_reordered.xlsx");
        XlsxImporter.Result r = TestUtil.importAuto(src);
        Map<Integer, BigDecimal> q = new HashMap<>();
        for (XlsxImporter.Row row : r.rows) q.put(row.rowNum, new BigDecimal(row.rowNum));
        File out = export(src, r, q);
        String sheet = TestUtil.entry(out, r.sheetPath);
        assertFalse("stale total formulas must be replaced", sheet.contains("<f>E2*C2</f>") || sheet.contains("E2*C2"));
        XlsxImporter.Result again = TestUtil.importAuto(out);
        assertEquals(Integer.valueOf(5), again.map.get(Field.TOTAL)); // not duplicated
        assertNull(TestUtil.entry(out, "xl/calcChain.xml"));
        assertFalse(TestUtil.entry(out, "[Content_Types].xml").contains("calcChain"));
    }

    @Test public void sharedFormulaMasterReplacedKeepsDependentsValid() throws Exception {
        String sheet = "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>"
                + "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>اسم الصنف</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>الكمية</t></is></c></row>"
                + "<row r=\"2\" spans=\"1:2\"><c r=\"A2\"><v>1</v></c><c r=\"B2\"><f t=\"shared\" ref=\"B2:B4\" si=\"0\">A2*0</f><v>0</v></c></row>"
                + "<row r=\"3\"><c r=\"A3\"><v>1</v></c><c r=\"B3\"><f t=\"shared\" si=\"0\"/><v>0</v></c></row>"
                + "<row r=\"4\"><c r=\"A4\"><v>1</v></c><c r=\"B4\"><f t=\"shared\" si=\"0\"/><v>0</v></c></row>"
                + "</sheetData></worksheet>";
        XlsxExporter.Spec s = new XlsxExporter.Spec();
        s.headerRow = 1; s.qtyCol = 1; s.costCol = 0; s.totalCol = 2; s.totalColCreated = true;
        s.values = new HashMap<>();
        s.values.put(2, new XlsxExporter.RowValues(new BigDecimal(5), new BigDecimal(5)));
        StringWriter w = new StringWriter();
        XlsxExporter.Stats st = new XlsxExporter.Stats();
        XlsxExporter.rewriteSheet(new StringReader(sheet), w, s, st);
        String out = w.toString();
        assertTrue(out, out.contains("<c r=\"B2\"><v>5</v></c>"));
        assertFalse(out, out.contains("si=\"0\""));           // orphan dependents stripped
        assertTrue(out, out.contains("<c r=\"B3\"><v>0</v></c>"));
        assertTrue(out, out.contains("<c r=\"C1\" t=\"inlineStr\">"));
        assertFalse(out, out.contains("spans=\"1:2\""));
        assertEquals(3, st.formulasRemoved);
    }

    @Test public void cellsWithoutRefAndPrefixedNamespace() throws Exception {
        String sheet = "<x:worksheet xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><x:sheetData>"
                + "<x:row><x:c t=\"inlineStr\"><x:is><x:t>a</x:t></x:is></x:c><x:c><x:v>0</x:v></x:c><x:c><x:v>2</x:v></x:c></x:row>"
                + "<x:row><x:c><x:v>1</x:v></x:c><x:c><x:v>0</x:v></x:c><x:c><x:v>2.5</x:v></x:c></x:row>"
                + "</x:sheetData></x:worksheet>";
        XlsxExporter.Spec s = new XlsxExporter.Spec();
        s.headerRow = 1; s.qtyCol = 1; s.costCol = 2; s.totalCol = 3; s.totalColCreated = true;
        s.values = new HashMap<>();
        s.values.put(2, new XlsxExporter.RowValues(new BigDecimal(4), new BigDecimal(10)));
        StringWriter w = new StringWriter();
        XlsxExporter.rewriteSheet(new StringReader(sheet), w, s, new XlsxExporter.Stats());
        String out = w.toString();
        assertTrue(out, out.contains("<x:c r=\"B2\"><x:v>4</x:v></x:c><x:c><x:v>2.5</x:v></x:c><x:c r=\"D2\"><x:v>10</x:v></x:c></x:row>"));
        assertTrue(out, out.contains("<x:c r=\"D1\" t=\"inlineStr\"><x:is><x:t>"));
    }

    @Test public void unknownCostLeavesTotalBlank() throws Exception {
        File src = TestUtil.fixture("f_invalid.xlsx");
        XlsxImporter.Result r = TestUtil.importAuto(src);
        Map<Integer, BigDecimal> q = new HashMap<>();
        for (XlsxImporter.Row row : r.rows) q.put(row.rowNum, BigDecimal.ONE);
        File out = export(src, r, q);
        assertNotNull(out);
    }

    @Test public void export50kRows() throws Exception {
        File src = TestUtil.bigWorkbook(50000, true);
        XlsxImporter.Result r = TestUtil.importAuto(src);
        Map<Integer, BigDecimal> q = new HashMap<>();
        for (int i = 0; i < r.rows.size(); i += 3) q.put(r.rows.get(i).rowNum, new BigDecimal(i % 13));
        long t0 = System.nanoTime();
        File out = export(src, r, q);
        System.out.println("EXPORT+VERIFY 50000 rows: " + (System.nanoTime() - t0) / 1_000_000 + " ms, size=" + out.length());
    }
}
