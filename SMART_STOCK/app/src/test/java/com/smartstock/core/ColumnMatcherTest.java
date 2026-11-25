package com.smartstock.core;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class ColumnMatcherTest {
    @Test public void referenceHeaders() {
        ColumnMatcher.Result r = ColumnMatcher.match(Arrays.asList("اسم المجموعة", "اسم الصنف", "الوحدة", "العبوة", "الباركود", "الكمية", "التكلفة", "تاريخ الانتهاء", null, "ملاحظة"));
        assertFalse(r.problems.toString(), r.needsManualMapping);
        assertEquals(Integer.valueOf(0), r.map.get(Field.GROUP));
        assertEquals(Integer.valueOf(3), r.map.get(Field.PACK));
        assertEquals(Integer.valueOf(4), r.map.get(Field.BARCODE));
        assertEquals(Integer.valueOf(6), r.map.get(Field.COST));
        assertNull(r.map.get(Field.TOTAL));
    }
    @Test public void variants() {
        ColumnMatcher.Result r = ColumnMatcher.match(Arrays.asList("Barcode", "العبوة / حبة", "العدد", "تكلفة الصنف", "إجمالي تكلفة الصف", "اسم الصنف"));
        assertFalse(r.problems.toString(), r.needsManualMapping);
        assertEquals(Integer.valueOf(0), r.map.get(Field.BARCODE));
        assertEquals(Integer.valueOf(1), r.map.get(Field.PACK));
        assertEquals(Integer.valueOf(2), r.map.get(Field.QTY));
        assertEquals(Integer.valueOf(3), r.map.get(Field.COST));
        assertEquals(Integer.valueOf(4), r.map.get(Field.TOTAL));
    }
    @Test public void neverPicksCostBeforeConversion() {
        ColumnMatcher.Result r = ColumnMatcher.match(Arrays.asList("اسم الصنف", "الباركود", "الكمية", "التكلفة قبل التحويل", "التكلفة", "معامل التحويل", "إجمالي التكلفة"));
        assertFalse(r.problems.toString(), r.needsManualMapping);
        assertEquals(Integer.valueOf(4), r.map.get(Field.COST));
        assertEquals(Integer.valueOf(6), r.map.get(Field.TOTAL));
    }
    @Test public void ambiguousCostNeedsMapping() {
        ColumnMatcher.Result r = ColumnMatcher.match(Arrays.asList("اسم الصنف", "الباركود", "الكمية", "التكلفة", "تكلفة الصنف"));
        assertTrue(r.needsManualMapping);
    }
    @Test public void missingRequiredNeedsMapping() {
        ColumnMatcher.Result r = ColumnMatcher.match(Arrays.asList("اسم الصنف", "الكمية", "التكلفة"));
        assertTrue(r.needsManualMapping);
    }
    @Test public void columnLetters() {
        assertEquals("A", ColumnMap.colLetters(0));
        assertEquals("Z", ColumnMap.colLetters(25));
        assertEquals("AA", ColumnMap.colLetters(26));
        assertEquals(27, ColumnMap.colIndex("AB12"));
        assertEquals(12, ColumnMap.rowIndex("AB12"));
        ColumnMap m = ColumnMap.parse("NAME=1;BARCODE=4;QTY=5;COST=6");
        assertEquals(m.serialize(), ColumnMap.parse(m.serialize()).serialize());
    }
}
