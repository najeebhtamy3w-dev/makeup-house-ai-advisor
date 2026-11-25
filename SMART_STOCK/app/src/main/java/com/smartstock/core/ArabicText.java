package com.smartstock.core;

import java.util.Locale;

/** Arabic-aware normalization used for header matching and name search. */
public final class ArabicText {
    private ArabicText() {}

    public static String digitsToLatin(String s) {
        if (s == null) return "";
        StringBuilder b = null;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            char r = c;
            if (c >= '٠' && c <= '٩') r = (char) ('0' + (c - '٠'));
            else if (c >= '۰' && c <= '۹') r = (char) ('0' + (c - '۰'));
            if (r != c) {
                if (b == null) b = new StringBuilder(s);
                b.setCharAt(i, r);
            }
        }
        return b == null ? s : b.toString();
    }

    /**
     * Search/matching normalization: removes tashkeel and tatweel, unifies alef/ya/ta-marbuta
     * forms, Latin lower-case, Arabic digits to Latin, collapses whitespace and separators.
     */
    public static String norm(String s) {
        if (s == null) return "";
        String t = digitsToLatin(s);
        StringBuilder b = new StringBuilder(t.length());
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if ((c >= 'ً' && c <= 'ٟ') || c == 'ٰ' || c == 'ـ') continue; // tashkeel, tatweel
            switch (c) {
                case 'أ': case 'إ': case 'آ': case 'ٱ': c = 'ا'; break; // أ إ آ ٱ -> ا
                case 'ى': c = 'ي'; break; // ى -> ي
                case 'ة': c = 'ه'; break; // ة -> ه
                case 'ؤ': c = 'و'; break; // ؤ -> و
                case 'ئ': c = 'ي'; break; // ئ -> ي
                case '_': case '-': case ' ': case '\t': c = ' '; break;
                default: break;
            }
            b.append(c);
        }
        return b.toString().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    /** Header normalization: like norm() but also drops "/" spacing and the definite-article-free variants. */
    public static String header(String s) {
        String n = norm(s).replace('\\', '/').replaceAll("\\s*/\\s*", "/");
        n = n.replaceAll("[:：*\"'()\\[\\]]", "").trim();
        return n;
    }
}
