package com.smartstock.core;

import org.junit.Test;
import java.math.BigDecimal;
import static org.junit.Assert.*;

public class DateColumnTest {
    @Test public void dateColumnRecognisedAndConverted() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f_dates.xlsx"));
        assertEquals(Integer.valueOf(7), r.map.get(Field.EXPIRY));          // header "التاريخ"
        assertEquals("2027-08-01", r.rows.get(0).expiry);                  // real Excel date cell
        assertEquals("2027-08-01", r.rows.get(1).expiry);                  // serial 46600 without date format
        assertEquals("2027/05", r.rows.get(2).expiry);                     // text kept as written
        assertEquals("", r.rows.get(3).expiry);
    }
    @Test public void referenceHeaderTaarikhAlIntihaa() throws Exception {
        XlsxImporter.Result r = TestUtil.importAuto(TestUtil.fixture("f10_multisheet.xlsx"));
        assertEquals(Integer.valueOf(7), r.map.get(Field.EXPIRY));          // "تاريخ الانتهاء" in column H
        assertEquals("2027-08-01", r.rows.get(0).expiry);
        assertEquals("", r.rows.get(1).expiry);
        assertEquals("2028-01-01", r.rows.get(3).expiry);
    }
    @Test public void serialRoundTrip() {
        assertEquals("2027-08-01", XlsxImporter.serialToDate(XlsxImporter.dateToSerial("2027-08-01")));
        assertEquals(0, XlsxImporter.dateToSerial("1900-03-01").compareTo(new BigDecimal(61)));
        assertNull(XlsxImporter.dateToSerial("2027/05"));
        assertTrue(XlsxPackage.isDateFormat(14, null));
        assertTrue(XlsxPackage.isDateFormat(164, "dd/mm/yyyy"));
        assertFalse(XlsxPackage.isDateFormat(165, "#,##0.00"));
        assertFalse(XlsxPackage.isDateFormat(166, "0000000000000"));
        assertFalse(XlsxPackage.isDateFormat(167, "[Red]0.00"));
    }
}
