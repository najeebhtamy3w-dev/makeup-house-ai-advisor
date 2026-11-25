package com.smartstock.core;

import org.junit.Test;
import java.io.File;
import java.math.BigDecimal;
import static org.junit.Assert.*;

public class XlsxImportTest {
    @Test public void multiSheetPicksApprovedSheetAndHandlesTrickyRows() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f10_multisheet.xlsx"));
        assertEquals("تصدير_بلاس", r.sheetName);
        assertEquals(9, r.rows.size());                 // 10 data lines incl. 1 empty row inside
        assertEquals(1, r.emptyRowsInside);
        assertTrue(r.trailingEmptyRows >= 0);
        assertEquals(1, r.noBarcode);
        assertEquals(1, r.duplicateBarcodeValues);
        assertEquals(2, r.duplicateBarcodeRows);
        assertEquals(0, r.invalidCost);
        assertEquals("0012345", r.rows.get(1).barcode);   // leading zeros kept
        assertEquals(0, r.rows.get(0).cost.compareTo(new BigDecimal("25.5")));
        assertEquals(0, r.rows.get(1).cost.compareTo(new BigDecimal("0.28")));
        assertEquals(0, r.rows.get(2).cost.compareTo(new BigDecimal("12.125")));
        XlsxImporter.Row f = r.rows.get(5);
        assertEquals("صنف تكلفته من معادلة", f.name);
        assertTrue(f.costFromFormula);
        assertEquals(0, f.cost.compareTo(new BigDecimal("12.74")));
        assertEquals(0, r.rows.get(8).cost.compareTo(new BigDecimal("1234.5678")));
        // order preserved
        assertEquals("عدسات فريش ليدي", r.rows.get(0).name);
        assertEquals("عطر كبير", r.rows.get(8).name);
        assertEquals(9, r.maxColumn); // J
        assertNull(r.map.get(Field.TOTAL));
    }

    @Test public void singleSheetReorderedWithExtraAndTotalColumns() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f_single_reordered.xlsx"));
        assertEquals("Sheet1", r.sheetName);
        assertEquals(20, r.rows.size());
        assertEquals(Integer.valueOf(1), r.map.get(Field.BARCODE));
        assertEquals(Integer.valueOf(2), r.map.get(Field.COST));
        assertEquals(Integer.valueOf(4), r.map.get(Field.QTY));
        assertEquals(Integer.valueOf(5), r.map.get(Field.TOTAL));
        assertEquals("8000000000001", r.rows.get(0).barcode);
        assertEquals("حبة", r.rows.get(0).pack);
    }

    @Test public void invalidDataIsReportedNotSilentlyZeroed() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f_invalid.xlsx"));
        assertEquals(7, r.rows.size());
        assertEquals(1, r.skippedIncompleteRows);
        assertEquals(4, r.invalidCost);   // text, negative, empty, #DIV/0!
        assertEquals(1, r.invalidQty);
        assertEquals(1, r.nonZeroFileQty);
        for (XlsxImporter.Row row : r.rows) if (row.cost == null) assertNotNull(row.costIssue);
        assertFalse(r.warnings.isEmpty());
    }

    @Test public void numericBarcodes() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f_numeric_barcode.xlsx"));
        assertEquals("0000012345678", r.rows.get(0).barcode);
        assertEquals("6281234567890", r.rows.get(1).barcode);
    }

    @Test public void ambiguousHeaderRequiresManualMapping() throws Exception {
        try (XlsxPackage pkg = new XlsxPackage(TestUtil.fixture("f_ambiguous.xlsx"), TestUtil.PF)) {
            XlsxImporter.HeaderScan h = XlsxImporter.scanHeader(pkg, pkg.defaultSheet());
            assertTrue(h.match.needsManualMapping);
            ColumnMap m = new ColumnMap(h.match.map);
            m.set(Field.COST, 4); // user picks "تكلفة الصنف"
            XlsxImporter.Result r = XlsxImporter.read(pkg, pkg.defaultSheet(), h.headerRow, m, h.headers, null);
            assertEquals(0, r.rows.get(0).cost.compareTo(new BigDecimal(2)));
        }
    }

    @Test public void notAnXlsx() throws Exception {
        File f = File.createTempFile("bad_", ".xlsx");
        try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write("not a zip".getBytes()); }
        try { new XlsxPackage(f, TestUtil.PF); fail(); } catch (java.io.IOException e) { assertTrue(e.getMessage().contains("Excel")); }
    }

    @Test public void import1k10k50k() throws Exception {
        for (int n : new int[]{1000, 10000, 50000}) {
            File f = TestUtil.bigWorkbook(n, false);
            long t0 = System.nanoTime();
            XlsxImporter.Result r = TestUtil.importAuto(f);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            System.out.println("IMPORT " + n + " rows: " + ms + " ms");
            assertEquals(n, r.rows.size());
            assertEquals(String.format("62%011d", n), r.rows.get(n - 1).barcode);
            assertEquals(0, r.rows.get(n - 1).cost.compareTo(TestUtil.cost(n)));
            assertEquals(0, r.duplicateBarcodeRows);
        }
    }

    /** Optional: the owner's reference workbook, only when provided locally (never committed). */
    @Test public void ownerReferenceWorkbookIfPresent() throws Exception {
        String p = System.getenv("SMARTSTOCK_REFERENCE_XLSX");
        if (p == null || !new File(p).exists()) return;
        try (XlsxPackage pkg = new XlsxPackage(new File(p), TestUtil.PF)) {
            XlsxPackage.SheetRef s = pkg.defaultSheet();
            assertEquals("تصدير_بلاس", s.name);
            XlsxImporter.HeaderScan h = XlsxImporter.scanHeader(pkg, s);
            assertFalse(h.match.problems.toString(), h.match.needsManualMapping);
            try {
                XlsxImporter.Result r = XlsxImporter.read(pkg, s, h.headerRow, h.match.map, h.headers, null);
                System.out.println("REFERENCE rows=" + r.rows.size() + " skippedErrorRows=" + r.skippedErrorRows + " trailing=" + r.trailingEmptyRows);
            } catch (java.io.IOException e) {
                System.out.println("REFERENCE: " + e.getMessage()); // template has no item values (only #NAME? spill formula)
                assertTrue(e.getMessage().contains("لا توجد أصناف"));
            }
        }
    }
}
