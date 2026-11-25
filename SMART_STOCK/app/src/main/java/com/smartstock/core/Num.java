package com.smartstock.core;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/**
 * Exact decimal arithmetic for SMART STOCK. Money and quantities are never
 * computed with float/double: everything is BigDecimal, stored as plain strings.
 */
public final class Num {
    private Num() {}

    public static final BigDecimal MAX_QTY = new BigDecimal("100000000"); // hard sanity ceiling

    /** total = qty x cost, exact (no rounding). Returns null if cost is unknown. */
    public static BigDecimal total(BigDecimal qty, BigDecimal cost) {
        if (cost == null || qty == null) return null;
        return strip(qty.multiply(cost));
    }

    /** Removes trailing zeros but never produces scientific notation scale (<0). */
    public static BigDecimal strip(BigDecimal v) {
        if (v == null) return null;
        if (v.signum() == 0) return BigDecimal.ZERO;
        BigDecimal s = v.stripTrailingZeros();
        return s.scale() < 0 ? s.setScale(0) : s;
    }

    public static String plain(BigDecimal v) { return v == null ? "" : strip(v).toPlainString(); }

    public static BigDecimal parseStored(String s) {
        if (s == null || s.isEmpty()) return BigDecimal.ZERO;
        return new BigDecimal(s);
    }

    /**
     * Parses a number typed by a user or read from a cell text: accepts Arabic-Indic
     * digits, Arabic decimal separator (٫), thousands separators (, ٬) and spaces.
     * Returns null if not a valid number.
     */
    public static BigDecimal parseUser(String s) {
        if (s == null) return null;
        String t = ArabicText.digitsToLatin(s.trim())
                .replace('٫', '.')   // Arabic decimal separator
                .replace("٬", "")    // Arabic thousands separator
                .replace(",", "")
                .replace(" ", "")
                .replace(" ", "");
        if (t.isEmpty()) return null;
        if (!t.matches("[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?")) return null;
        try { return strip(new BigDecimal(t)); } catch (NumberFormatException e) { return null; }
    }

    /**
     * Parses a numeric value as stored in an XLSX &lt;v&gt; element. Excel stores IEEE doubles
     * written with up to 17 significant digits (e.g. "0.28000000000000003"). Such long
     * representations are normalized to the shortest decimal that maps to the same double,
     * which is exactly the value Excel displays. Short representations are taken literally.
     */
    public static BigDecimal parseCell(String v) {
        if (v == null) return null;
        String t = v.trim();
        if (t.isEmpty()) return null;
        try {
            BigDecimal raw = new BigDecimal(t);
            if (raw.precision() > 15) {
                double d = Double.parseDouble(t);
                if (Double.isInfinite(d) || Double.isNaN(d)) return null;
                // Excel shows at most 15 significant digits
                BigDecimal r = new BigDecimal(d).round(new java.math.MathContext(15, RoundingMode.HALF_EVEN));
                return strip(r);
            }
            return strip(raw);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Validates a quantity entered for counting. */
    public static String validateQty(BigDecimal q, boolean allowDecimal) {
        if (q == null) return "أدخل كمية صحيحة";
        if (q.signum() < 0) return "لا يُسمح بالكميات السالبة";
        if (!allowDecimal && strip(q).scale() > 0) return "هذه الجلسة لا تسمح بالكميات العشرية";
        if (strip(q).scale() > 6) return "عدد الخانات العشرية كبير جدًا";
        if (q.compareTo(MAX_QTY) > 0) return "الكمية أكبر من الحد المسموح";
        return null;
    }

    private static final ThreadLocal<DecimalFormat> MONEY = ThreadLocal.withInitial(() -> {
        DecimalFormat f = new DecimalFormat("#,##0.00########", DecimalFormatSymbols.getInstance(Locale.US));
        f.setRoundingMode(RoundingMode.UNNECESSARY);
        return f;
    });
    private static final ThreadLocal<DecimalFormat> QTY = ThreadLocal.withInitial(() -> {
        DecimalFormat f = new DecimalFormat("#,##0.######", DecimalFormatSymbols.getInstance(Locale.US));
        f.setRoundingMode(RoundingMode.UNNECESSARY);
        return f;
    });

    /** Money display: grouping, at least 2 decimals, never rounds away digits. */
    public static String money(BigDecimal v) {
        if (v == null) return "—";
        BigDecimal s = strip(v);
        if (s.scale() > 8) return s.toPlainString();
        return MONEY.get().format(s);
    }

    public static String qty(BigDecimal v) {
        if (v == null) return "—";
        BigDecimal s = strip(v);
        if (s.scale() > 6) return s.toPlainString();
        return QTY.get().format(s);
    }

    /** Completion percentage with one decimal, e.g. "37.5". */
    public static String percent(long part, long whole) {
        if (whole <= 0) return "0";
        BigDecimal p = BigDecimal.valueOf(part).multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(whole), 1, RoundingMode.DOWN);
        return strip(p).toPlainString();
    }
}
