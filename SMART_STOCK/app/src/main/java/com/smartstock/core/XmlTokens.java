package com.smartstock.core;

import java.io.IOException;
import java.io.Reader;

/**
 * Minimal lossless XML tokenizer: returns raw text runs and raw markup ("&lt;...&gt;") exactly as
 * they appear, so that untouched content can be copied byte-for-byte. Quoted attribute values may
 * contain '&gt;'. Comments, CDATA, processing instructions and DOCTYPE are returned as single tokens.
 */
final class XmlTokens {
    private final Reader in;
    private int peeked = -2;
    boolean isTag;
    private final StringBuilder sb = new StringBuilder(256);

    XmlTokens(Reader in) { this.in = in; }

    private int read() throws IOException {
        if (peeked != -2) { int c = peeked; peeked = -2; return c; }
        return in.read();
    }

    String next() throws IOException {
        sb.setLength(0);
        int c = read();
        if (c == -1) return null;
        if (c != '<') {
            isTag = false;
            while (c != -1 && c != '<') { sb.append((char) c); c = read(); }
            if (c == '<') peeked = '<';
            return sb.toString();
        }
        isTag = true;
        sb.append('<');
        int c2 = read();
        if (c2 == -1) return sb.toString();
        sb.append((char) c2);
        if (c2 == '!') {
            // comment, CDATA or DOCTYPE
            readUntilEndsWith(null);
            String s = sb.toString();
            if (s.startsWith("<!--")) { while (!sb.toString().endsWith("-->")) if (!more()) break; }
            else if (s.startsWith("<![CDATA[")) { while (!sb.toString().endsWith("]]>")) if (!more()) break; }
            return sb.toString();
        }
        if (c2 == '?') {
            while (!(sb.length() >= 4 && sb.charAt(sb.length() - 1) == '>' && sb.charAt(sb.length() - 2) == '?')) if (!more()) break;
            return sb.toString();
        }
        char quote = 0;
        int ch;
        while ((ch = read()) != -1) {
            sb.append((char) ch);
            if (quote != 0) { if (ch == quote) quote = 0; }
            else if (ch == '"' || ch == '\'') quote = (char) ch;
            else if (ch == '>') break;
        }
        return sb.toString();
    }

    private boolean more() throws IOException {
        int ch = read();
        if (ch == -1) return false;
        sb.append((char) ch);
        return true;
    }

    private void readUntilEndsWith(String ignored) throws IOException {
        int ch;
        while ((ch = read()) != -1) {
            sb.append((char) ch);
            if (ch == '>') return;
        }
    }

    /** "&lt;x:row r=..." -> "row" ; "&lt;/c&gt;" -> "c". */
    static String localName(String tag) {
        int i = 1;
        if (i < tag.length() && tag.charAt(i) == '/') i++;
        int s = i;
        while (i < tag.length()) {
            char c = tag.charAt(i);
            if (c == ' ' || c == '>' || c == '/' || c == '\t' || c == '\n' || c == '\r') break;
            i++;
        }
        String q = tag.substring(s, i);
        int k = q.indexOf(':');
        return k >= 0 ? q.substring(k + 1) : q;
    }

    /** Namespace prefix including ':' (or ""). */
    static String prefix(String tag) {
        int i = 1;
        if (i < tag.length() && tag.charAt(i) == '/') i++;
        int s = i;
        while (i < tag.length()) {
            char c = tag.charAt(i);
            if (c == ' ' || c == '>' || c == '/' || c == '\t' || c == '\n' || c == '\r') break;
            i++;
        }
        String q = tag.substring(s, i);
        int k = q.indexOf(':');
        return k >= 0 ? q.substring(0, k + 1) : "";
    }

    /** Attribute value (unescaped is not needed for r/s/t/si/ref) or null. */
    static String attr(String tag, String name) {
        int i = 0;
        while (true) {
            i = tag.indexOf(name, i);
            if (i < 0) return null;
            char before = i > 0 ? tag.charAt(i - 1) : ' ';
            int j = i + name.length();
            while (j < tag.length() && Character.isWhitespace(tag.charAt(j))) j++;
            if ((before == ' ' || before == '\t' || before == '\n' || before == '\r') && j < tag.length() && tag.charAt(j) == '=') {
                j++;
                while (j < tag.length() && Character.isWhitespace(tag.charAt(j))) j++;
                if (j >= tag.length()) return null;
                char q = tag.charAt(j);
                if (q != '"' && q != '\'') return null;
                int e = tag.indexOf(q, j + 1);
                if (e < 0) return null;
                return tag.substring(j + 1, e);
            }
            i = i + name.length();
        }
    }

    static String escape(String s) {
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&': b.append("&amp;"); break;
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                default: b.append(c);
            }
        }
        return b.toString();
    }
}
