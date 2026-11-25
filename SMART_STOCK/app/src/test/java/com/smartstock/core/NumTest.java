package com.smartstock.core;

import org.junit.Test;
import java.math.BigDecimal;
import static org.junit.Assert.*;

public class NumTest {
    @Test public void mandatoryExample1_cumulative() {
        BigDecimal cost = new BigDecimal("25.50");
        BigDecimal q = BigDecimal.ZERO.add(new BigDecimal("12")).add(new BigDecimal("8"));
        assertEquals(0, q.compareTo(new BigDecimal("20")));
        assertEquals(0, Num.total(q, cost).compareTo(new BigDecimal("510.00")));
        assertEquals("510.00", Num.money(Num.total(q, cost)));
    }
    @Test public void mandatoryExample2() {
        BigDecimal t = Num.total(new BigDecimal("100"), new BigDecimal("0.28"));
        assertEquals(0, t.compareTo(new BigDecimal("28.00")));
        assertEquals("28.00", Num.money(t));
    }
    @Test public void noAccumulatedError() {
        // 10,000 additions of 0.1 must be exactly 1000 (double would drift)
        BigDecimal q = BigDecimal.ZERO;
        for (int i = 0; i < 10000; i++) q = q.add(new BigDecimal("0.1"));
        assertEquals(0, q.compareTo(new BigDecimal("1000")));
        BigDecimal sum = BigDecimal.ZERO;
        for (int i = 0; i < 10000; i++) sum = sum.add(Num.total(new BigDecimal("3"), new BigDecimal("0.28")));
        assertEquals(0, sum.compareTo(new BigDecimal("8400")));
        double d = 0; for (int i = 0; i < 10000; i++) d += 3 * 0.28;
        assertNotEquals(8400.0, d, 0.0); // proves why double is not used
    }
    @Test public void preservesCostPrecision() {
        assertEquals("1,234.5678", Num.money(new BigDecimal("1234.5678")));
        assertEquals("12.125", Num.money(new BigDecimal("12.125")));
        assertEquals("7.00", Num.money(new BigDecimal("7")));
        assertEquals(0, Num.total(new BigDecimal("3"), new BigDecimal("12.125")).compareTo(new BigDecimal("36.375")));
    }
    @Test public void parseCellNormalizesExcelDoubles() {
        assertEquals("0.28", Num.parseCell("0.28000000000000003").toPlainString());
        assertEquals("12.74", Num.parseCell("12.740000000000002").toPlainString());
        assertEquals("25.5", Num.parseCell("25.5").toPlainString());
        assertEquals("6281234567890", Num.parseCell("6281234567890").toPlainString());
        assertEquals("6281234567890", Num.parseCell("6.28123456789E12").toPlainString());
    }
    @Test public void parseUserInput() {
        assertEquals(0, Num.parseUser("١٢").compareTo(new BigDecimal(12)));
        assertEquals(0, Num.parseUser("٢٥٫٥").compareTo(new BigDecimal("25.5")));
        assertEquals(0, Num.parseUser("1,234.5").compareTo(new BigDecimal("1234.5")));
        assertNull(Num.parseUser("abc"));
        assertNull(Num.parseUser(""));
        assertNull(Num.parseUser("1.2.3"));
    }
    @Test public void validateQty() {
        assertNotNull(Num.validateQty(new BigDecimal("-1"), true));
        assertNotNull(Num.validateQty(new BigDecimal("1.5"), false));
        assertNull(Num.validateQty(new BigDecimal("1.5"), true));
        assertNull(Num.validateQty(new BigDecimal("0"), false));
        assertNotNull(Num.validateQty(null, false));
        assertNotNull(Num.validateQty(new BigDecimal("1000000000"), false));
    }
    @Test public void percent() {
        assertEquals("37.5", Num.percent(3, 8));
        assertEquals("0", Num.percent(0, 0));
        assertEquals("100", Num.percent(5, 5));
        assertEquals("33.3", Num.percent(1, 3));
    }
}
