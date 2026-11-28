package com.smartstock.core;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Recognises inventory fields from header names (not positions). Handles small naming
 * differences and never confuses the final cost with "cost before conversion"/initial cost.
 */
public final class ColumnMatcher {
    private ColumnMatcher() {}

    // Synonyms in priority order (already normalized with ArabicText.header()).
    static final Map<Field, String[]> SYN = new EnumMap<>(Field.class);
    static {
        SYN.put(Field.GROUP, new String[]{"اسم المجموعه", "المجموعه", "مجموعه", "اسم المجموعه الرييسيه", "الفيه", "القسم", "group", "category"});
        SYN.put(Field.NAME, new String[]{"اسم الصنف", "الصنف", "اسم المنتج", "المنتج", "اسم الماده", "item name", "name", "product", "item"});
        SYN.put(Field.UNIT, new String[]{"الوحده", "وحده", "وحده القياس", "unit"});
        SYN.put(Field.PACK, new String[]{"العبوه/حبه", "العبوه", "عبوه", "العبوه/حبات", "حبه", "pack", "package", "packing"});
        SYN.put(Field.BARCODE, new String[]{"الباركود", "باركود", "barcode", "bar code", "رمز الباركود", "كود الباركود", "ean"});
        SYN.put(Field.QTY, new String[]{"الكميه", "كميه", "العدد", "عدد", "الكميه الفعليه", "qty", "quantity", "count"});
        SYN.put(Field.COST, new String[]{"التكلفه", "تكلفه الصنف", "تكلفه", "سعر التكلفه", "تكلفه الوحده", "cost", "unit cost"});
        SYN.put(Field.EXPIRY, new String[]{"تاريخ الانتهاء", "تاريخ انتهاء", "الانتهاء", "تاريخ الصلاحيه", "انتهاء الصلاحيه", "الصلاحيه", "التاريخ", "تاريخ", "expiry", "expiry date", "exp", "exp date", "date"});
        SYN.put(Field.TOTAL, new String[]{"اجمالي تكلفه الصف", "اجمالي التكلفه", "اجمالي تكلفه الصنف", "الاجمالي", "اجمالي", "اجمالي القيمه", "total", "total cost"});
    }

    // Any of these words disqualify a header from being the final COST / TOTAL.
    static final String[] COST_EXCLUDE = {"قبل", "اوليه", "الاوليه", "معامل", "تحويل", "عمله", "العمله", "before", "initial", "rate", "اصليه"};

    public static boolean costExcluded(String normHeader) {
        for (String x : COST_EXCLUDE) if (normHeader.contains(x)) return true;
        return false;
    }

    /** Exact-synonym priority (0 = best) or -1. */
    public static int exactScore(Field f, String rawHeader) {
        String h = ArabicText.header(rawHeader);
        if (h.isEmpty()) return -1;
        if ((f == Field.COST || f == Field.TOTAL) && costExcluded(h)) return -1;
        String[] syn = SYN.get(f);
        for (int i = 0; i < syn.length; i++) if (h.equals(syn[i])) return i;
        return -1;
    }

    /** Loose "contains" match used only as an uncertain suggestion. */
    static boolean looseMatch(Field f, String rawHeader) {
        String h = ArabicText.header(rawHeader);
        if (h.isEmpty()) return false;
        if ((f == Field.COST || f == Field.TOTAL || f == Field.QTY) && costExcluded(h)) return false;
        switch (f) {
            case BARCODE: return h.contains("باركود") || h.contains("barcode");
            case NAME: return h.contains("صنف") || h.contains("item");
            case GROUP: return h.contains("مجموعه");
            case PACK: return h.contains("عبوه");
            case UNIT: return h.contains("وحده");
            case QTY: return h.contains("كميه") && !h.contains("اجمالي");
            case COST: return h.contains("تكلفه") && !h.contains("اجمالي");
            case TOTAL: return h.contains("اجمالي") && !h.contains("كميه");
            case EXPIRY: return h.contains("تاريخ") || h.contains("انتهاء") || h.contains("صلاحيه") || h.contains("expir");
            default: return false;
        }
    }

    public static final class Result {
        public final ColumnMap map = new ColumnMap();
        /** Fields whose column could not be determined with certainty. */
        public final List<String> problems = new ArrayList<>();
        public boolean needsManualMapping;
        public int exactHits;
    }

    /** headers: zero-based column -> header text (null/blank allowed). */
    public static Result match(List<String> headers) {
        Result r = new Result();
        java.util.Set<Integer> used = new java.util.HashSet<>();
        for (Field f : Field.values()) {
            int best = Integer.MAX_VALUE; List<Integer> bestCols = new ArrayList<>(); List<Integer> allExact = new ArrayList<>();
            for (int c = 0; c < headers.size(); c++) {
                String h = headers.get(c);
                if (h == null || used.contains(c)) continue;
                int s = exactScore(f, h);
                if (s < 0) continue;
                allExact.add(c);
                if (s < best) { best = s; bestCols.clear(); bestCols.add(c); }
                else if (s == best) bestCols.add(c);
            }
            if (!allExact.isEmpty()) {
                r.exactHits++;
                int chosen = bestCols.get(0);
                r.map.set(f, chosen);
                used.add(chosen);
                if (allExact.size() > 1 && (f.required || f == Field.TOTAL)) {
                    r.needsManualMapping = true;
                    r.problems.add("أكثر من عمود يطابق \"" + f.label + "\"");
                }
                continue;
            }
            // loose (uncertain) suggestion
            List<Integer> loose = new ArrayList<>();
            for (int c = 0; c < headers.size(); c++) {
                String h = headers.get(c);
                if (h != null && !used.contains(c) && looseMatch(f, h)) loose.add(c);
            }
            if (loose.size() == 1) {
                r.map.set(f, loose.get(0));
                used.add(loose.get(0));
                if (f.required || f == Field.TOTAL) {
                    r.needsManualMapping = true;
                    r.problems.add("عمود \"" + f.label + "\" غير مؤكد: " + headers.get(loose.get(0)));
                }
            } else if (f.required) {
                r.needsManualMapping = true;
                r.problems.add(loose.isEmpty() ? "لم يتم العثور على عمود \"" + f.label + "\"" : "أكثر من عمود محتمل لـ \"" + f.label + "\"");
            }
        }
        return r;
    }
}
