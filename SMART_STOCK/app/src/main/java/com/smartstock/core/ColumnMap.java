package com.smartstock.core;

import java.util.EnumMap;
import java.util.Map;

/** Field -> zero-based column index. TOTAL may be absent (it will be created on export). */
public final class ColumnMap {
    private final EnumMap<Field, Integer> map = new EnumMap<>(Field.class);

    public ColumnMap() {}

    public ColumnMap(ColumnMap other) { map.putAll(other.map); }

    public void set(Field f, Integer col) {
        if (col == null || col < 0) map.remove(f); else map.put(f, col);
    }

    public Integer get(Field f) { return map.get(f); }

    public int getOr(Field f, int def) { Integer v = map.get(f); return v == null ? def : v; }

    public boolean has(Field f) { return map.containsKey(f); }

    public Map<Field, Integer> asMap() { return map; }

    /** Returns an Arabic error message if the mapping is unusable, else null. */
    public String validate() {
        for (Field f : Field.values())
            if (f.required && !map.containsKey(f)) return "لم يتم تحديد عمود: " + f.label;
        java.util.HashMap<Integer, Field> seen = new java.util.HashMap<>();
        for (Map.Entry<Field, Integer> e : map.entrySet()) {
            Field prev = seen.put(e.getValue(), e.getKey());
            if (prev != null) return "العمود نفسه مختار لحقلين: " + prev.label + " و " + e.getKey().label;
        }
        return null;
    }

    /** Compact serialization "NAME=1;BARCODE=4;..." for the session table. */
    public String serialize() {
        StringBuilder b = new StringBuilder();
        for (Map.Entry<Field, Integer> e : map.entrySet()) {
            if (b.length() > 0) b.append(';');
            b.append(e.getKey().name()).append('=').append(e.getValue());
        }
        return b.toString();
    }

    public static ColumnMap parse(String s) {
        ColumnMap m = new ColumnMap();
        if (s == null || s.isEmpty()) return m;
        for (String part : s.split(";")) {
            int i = part.indexOf('=');
            if (i <= 0) continue;
            m.set(Field.valueOf(part.substring(0, i)), Integer.parseInt(part.substring(i + 1)));
        }
        return m;
    }

    public static String colLetters(int zeroBased) {
        int n = zeroBased + 1;
        StringBuilder s = new StringBuilder();
        while (n > 0) { n--; s.insert(0, (char) ('A' + n % 26)); n /= 26; }
        return s.toString();
    }

    /** "AB12" -> 27 (zero-based column). Returns -1 when no letters. */
    public static int colIndex(String ref) {
        int k = 0, i = 0;
        while (i < ref.length()) {
            char c = ref.charAt(i);
            if (c >= 'A' && c <= 'Z') k = k * 26 + (c - 'A' + 1);
            else if (c >= 'a' && c <= 'z') k = k * 26 + (c - 'a' + 1);
            else break;
            i++;
        }
        return i == 0 ? -1 : k - 1;
    }

    /** "AB12" -> 12. Returns -1 when no digits. */
    public static int rowIndex(String ref) {
        int i = 0;
        while (i < ref.length() && Character.isLetter(ref.charAt(i))) i++;
        if (i >= ref.length()) return -1;
        try { return Integer.parseInt(ref.substring(i)); } catch (NumberFormatException e) { return -1; }
    }
}
