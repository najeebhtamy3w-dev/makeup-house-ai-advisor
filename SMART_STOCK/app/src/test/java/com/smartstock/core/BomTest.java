package com.smartstock.core;
import org.junit.Test;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import static org.junit.Assert.*;
/** Workbooks whose XML parts start with a byte-order mark (seen on a real device, 2026-11-25). */
public class BomTest {
    @Test public void bomInXmlPartsImportAndExport() throws Exception {
        java.io.File src = TestUtil.fixture("f_bom.xlsx");
        XlsxImporter.Result r = TestUtil.importAuto(src);
        assertEquals(9, r.rows.size());
        assertEquals("0012345", r.rows.get(1).barcode);
        Map<Integer, BigDecimal> q = new HashMap<>();
        q.put(r.rows.get(0).rowNum, new BigDecimal(20));
        java.io.File out = XlsxExportTest.export(src, r, q);   // includes row-by-row verification
        assertEquals(0, TestUtil.importAuto(out).rows.get(0).fileQty.compareTo(new BigDecimal(20)));
    }
    @Test public void utf16AndLeadingWhitespace() throws Exception {
        String xml = "<?xml version=\"1.0\"?><a>نص</a>";
        for (byte[] b : new byte[][]{
                concat(new byte[]{(byte) 0xFF, (byte) 0xFE}, xml.getBytes("UTF-16LE")),
                ("\n  \r\n" + xml).getBytes("UTF-8")}) {
            org.xmlpull.v1.XmlPullParser p = new org.kxml2.io.KXmlParser();
            p.setInput(XlsxPackage.cleanReader(new java.io.ByteArrayInputStream(b)));
            while (p.next() != org.xmlpull.v1.XmlPullParser.START_TAG) {}
            assertEquals("a", p.getName());
            assertEquals("نص", p.nextText());
        }
    }
    static byte[] concat(byte[] a, byte[] b) { byte[] r = new byte[a.length + b.length]; System.arraycopy(a, 0, r, 0, a.length); System.arraycopy(b, 0, r, a.length, b.length); return r; }
}
