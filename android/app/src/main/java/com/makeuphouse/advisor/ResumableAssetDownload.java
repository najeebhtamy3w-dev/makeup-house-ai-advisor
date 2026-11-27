package com.makeuphouse.advisor;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Downloads a pinned GGUF to a recoverable partial; callers own final atomic installation. */
public final class ResumableAssetDownload {
    public static final class DownloadSpec {
        public final String url;
        public final long size;
        public final String sha256;
        public DownloadSpec(String url, long size, String sha256) {
            if (url == null || size < 4 || sha256 == null || !sha256.matches("[0-9a-fA-F]{64}"))
                throw new IllegalArgumentException("INVALID_DOWNLOAD_SPEC");
            this.url = url; this.size = size; this.sha256 = sha256.toLowerCase(java.util.Locale.ROOT);
        }
    }
    public interface Progress { void update(String phase, long bytes, long total); }
    private static final Pattern RANGE = Pattern.compile("bytes ([0-9]+)-([0-9]+)/([0-9]+)");
    private static final Pattern UNSATISFIED = Pattern.compile("bytes \\*/([0-9]+)");
    private final DownloadSpec spec;
    private final boolean testLoopback;
    private final int maxFailures;
    private final int timeoutMs;
    private final Object connectionLock = new Object();
    private HttpURLConnection active;

    public ResumableAssetDownload(DownloadSpec spec) { this(spec, false, 5, 20000); }
    // Deliberately package-private. Production construction never permits cleartext HTTP.
    static ResumableAssetDownload forLoopbackTest(DownloadSpec spec, int failures, int timeoutMs) {
        return new ResumableAssetDownload(spec, true, failures, timeoutMs);
    }
    private ResumableAssetDownload(DownloadSpec spec, boolean testLoopback, int failures, int timeoutMs) {
        if (spec == null || failures < 1 || timeoutMs < 1) throw new IllegalArgumentException("INVALID_DOWNLOAD_OPTIONS");
        this.spec = spec; this.testLoopback = testLoopback; this.maxFailures = failures; this.timeoutMs = timeoutMs;
    }

    /** Only this downloader's current request is disconnected; cancellation flag is caller-owned. */
    public void cancel() { synchronized (connectionLock) { if (active != null) active.disconnect(); } }
    private static void cancelled(AtomicBoolean flag) throws IOException {
        if (flag.get() || Thread.currentThread().isInterrupted()) throw new IOException("DOWNLOAD_CANCELLED");
    }
    private void validateUrl(URL url) throws IOException {
        boolean loopback = "http".equalsIgnoreCase(url.getProtocol()) && testLoopback &&
            ("localhost".equalsIgnoreCase(url.getHost()) || "127.0.0.1".equals(url.getHost()) || "[::1]".equals(url.getHost()));
        if ((!"https".equalsIgnoreCase(url.getProtocol()) && !loopback) || url.getUserInfo() != null)
            throw new IOException("DOWNLOAD_HTTPS_REQUIRED");
    }
    private HttpURLConnection open(long offset, String etag, boolean full, AtomicBoolean flag) throws IOException {
        URL url = new URL(spec.url); // Start here on EVERY retry: signed redirect URLs may have expired.
        for (int redirects = 0; redirects <= 8; redirects++) {
            cancelled(flag); validateUrl(url);
            HttpURLConnection con = (HttpURLConnection) url.openConnection();
            synchronized (connectionLock) { active = con; }
            con.setInstanceFollowRedirects(false); con.setConnectTimeout(timeoutMs); con.setReadTimeout(timeoutMs);
            con.setRequestProperty("Accept-Encoding", "identity");
            if (!full && offset > 0) {
                con.setRequestProperty("Range", "bytes=" + offset + "-");
                if (strong(etag)) con.setRequestProperty("If-Range", etag);
            }
            try {
                cancelled(flag);
                int code = con.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = con.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new IOException("DOWNLOAD_REDIRECT_LOCATION");
                    URL next = new URL(url, location); validateUrl(next);
                    release(con); url = next; continue;
                }
                return con;
            } catch (IOException | RuntimeException e) { release(con); throw e; }
        }
        throw new IOException("DOWNLOAD_REDIRECT_LIMIT");
    }
    private void release(HttpURLConnection con) {
        synchronized (connectionLock) { if (active == con) active = null; }
        con.disconnect();
    }
    private static boolean strong(String etag) { return etag != null && etag.matches("\"[\\x21\\x23-\\x7e\\x80-\\xff]*\""); }
    private static long number(String value, String error) throws IOException {
        if (value == null || !value.matches("[0-9]+")) throw new IOException(error);
        try { return Long.parseLong(value); } catch (NumberFormatException e) { throw new IOException(error, e); }
    }
    private Properties metadata(File file) throws IOException {
        Properties p = new Properties();
        if (file.exists()) {
            try (InputStream in = new FileInputStream(file)) { p.load(in); }
            if (!spec.url.equals(p.getProperty("url")) || !Long.toString(spec.size).equals(p.getProperty("size")) ||
                !spec.sha256.equals(p.getProperty("sha256"))) throw new IOException("DOWNLOAD_METADATA_MISMATCH");
        }
        p.setProperty("url", spec.url); p.setProperty("size", Long.toString(spec.size)); p.setProperty("sha256", spec.sha256);
        return p;
    }
    private static void saveMetadata(File file, Properties p) throws IOException {
        File parent = file.getAbsoluteFile().getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("DOWNLOAD_METADATA_DIRECTORY");
        File temp = File.createTempFile(file.getName() + ".resume.", ".pending", parent);
        try (FileOutputStream out = new FileOutputStream(temp)) { p.store(out, "Pinned asset resume metadata"); out.getFD().sync(); }
        // Same-directory rename is atomic on Android's internal filesystem; leave both files if it fails.
        if (!temp.renameTo(file)) throw new IOException("DOWNLOAD_METADATA_COMMIT");
    }
    private void checkPrefix(File file) throws IOException {
        if (file.length() < 4) return;
        try (InputStream in = new FileInputStream(file)) {
            byte[] magic = new byte[4];
            if (in.read(magic) != 4 || !"GGUF".equals(new String(magic, StandardCharsets.US_ASCII)))
                throw new IOException("DOWNLOAD_GGUF_HEADER");
        }
    }

    /** Returns only after exact byte-count, SHA-256 and GGUF checks; never renames/deletes installed files. */
    public File download(File partial, File metadata, AtomicBoolean flag, Progress progress) throws IOException {
        if (partial == null || metadata == null || flag == null || partial.getCanonicalFile().equals(metadata.getCanonicalFile()))
            throw new IllegalArgumentException("INVALID_DOWNLOAD_FILES");
        cancelled(flag);
        validateUrl(new URL(spec.url));
        File parent = partial.getAbsoluteFile().getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("DOWNLOAD_DIRECTORY");
        Properties state = metadata(metadata);
        if (partial.length() > spec.size) throw new IOException("DOWNLOAD_PARTIAL_TOO_LARGE");
        checkPrefix(partial);
        if (partial.isFile() && partial.length() == spec.size) { verify(partial, flag, progress); return partial; }
        saveMetadata(metadata, state);
        int failures = 0, requests = 0; boolean full = false;
        IOException last = null;
        while (failures < maxFailures && requests++ < 4096) {
            cancelled(flag); long offset = partial.length(); HttpURLConnection con = null;
            try {
                con = open(offset, state.getProperty("etag"), full, flag); cancelled(flag);
                int code = con.getResponseCode();
                if (code == 416) {
                    if (partial.length() == spec.size) { verify(partial, flag, progress); return partial; }
                    Matcher m = UNSATISFIED.matcher(String.valueOf(con.getHeaderField("Content-Range")));
                    if (!m.matches() || number(m.group(1), "DOWNLOAD_RANGE") != spec.size) throw new IOException("DOWNLOAD_RANGE");
                    full = true; throw new IOException("DOWNLOAD_RANGE_UNSATISFIED_REFRESH");
                }
                if (code != 200 && code != 206) throw new IOException("DOWNLOAD_HTTP_" + code);
                String encoding = con.getHeaderField("Content-Encoding");
                if (encoding != null && !encoding.isEmpty() && !"identity".equalsIgnoreCase(encoding)) throw new IOException("DOWNLOAD_ENCODING");
                long bodySize;
                if (code == 206) {
                    Matcher m = RANGE.matcher(String.valueOf(con.getHeaderField("Content-Range")));
                    if (!m.matches()) throw new IOException("DOWNLOAD_RANGE");
                    long start = number(m.group(1), "DOWNLOAD_RANGE"), end = number(m.group(2), "DOWNLOAD_RANGE"), total = number(m.group(3), "DOWNLOAD_RANGE");
                    if (start != (full ? 0 : offset) || end < start || end >= total || total != spec.size) throw new IOException("DOWNLOAD_RANGE");
                    String oldEtag = state.getProperty("etag"), newEtag = con.getHeaderField("ETag");
                    if (offset > 0 && !full && strong(oldEtag) && newEtag != null && !oldEtag.equals(newEtag)) {
                        full = true; throw new IOException("DOWNLOAD_ETAG_CHANGED");
                    }
                    bodySize = end - start + 1;
                    if (full && offset > 0) throw new IOException("RANGE_NOT_SUPPORTED_WITH_PARTIAL");
                } else {
                    bodySize = spec.size;
                    // SAF targets can be /proc/self/fd aliases: never rename, truncate or delete
                    // existing partial bytes. The owner must explicitly choose a new target.
                    if (offset > 0) throw new IOException("RANGE_NOT_SUPPORTED_WITH_PARTIAL");
                    offset = 0;
                }
                String length = con.getHeaderField("Content-Length");
                if (length != null && number(length, "DOWNLOAD_CONTENT_LENGTH") != bodySize) throw new IOException("DOWNLOAD_CONTENT_LENGTH");
                String responseEtag = con.getHeaderField("ETag");
                if (responseEtag != null) state.setProperty("etag", responseEtag);
                else if (offset == 0) state.remove("etag");
                saveMetadata(metadata, state);
                full = false;
                long received = 0;
                try (InputStream in = con.getInputStream(); FileOutputStream out = new FileOutputStream(partial, offset > 0)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        cancelled(flag);
                        if (count == 0) continue;
                        if (count > bodySize - received || count > spec.size - offset - received) throw new IOException("DOWNLOAD_RESPONSE_TOO_LARGE");
                        out.write(buffer, 0, count); received += count;
                        if (progress != null) progress.update("downloading", offset + received, spec.size);
                    }
                    out.getFD().sync();
                }
                cancelled(flag); checkPrefix(partial);
                if (received != bodySize) throw new EOFException("DOWNLOAD_UNEXPECTED_EOF");
                if (partial.length() == spec.size) { verify(partial, flag, progress); return partial; }
                // A valid206 may intentionally deliver only part of the remaining file.
                failures = 0;
            } catch (IOException e) {
                if (flag.get() || Thread.currentThread().isInterrupted()) throw new IOException("DOWNLOAD_CANCELLED", e);
                if ("RANGE_NOT_SUPPORTED_WITH_PARTIAL".equals(e.getMessage()) ||
                    "DOWNLOAD_SHA256_MISMATCH".equals(e.getMessage()) || "DOWNLOAD_GGUF_HEADER".equals(e.getMessage())) throw e;
                last = e; failures++;
                if (progress != null) progress.update("retrying", partial.length(), spec.size);
            } finally { if (con != null) release(con); if (progress != null) progress.update("checkpoint", partial.length(), spec.size); }
        }
        if (last != null) throw last;
        throw new IOException("DOWNLOAD_REQUEST_BUDGET");
    }

    public void verify(File file, AtomicBoolean flag, Progress progress) throws IOException {
        cancelled(flag);
        if (!file.isFile() || file.length() != spec.size) throw new IOException("DOWNLOAD_SIZE_MISMATCH");
        checkPrefix(file);
        try {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(file)) {
                byte[] b = new byte[65536]; int n; long count = 0;
                while ((n = in.read(b)) != -1) { cancelled(flag); hash.update(b, 0, n); count += n; if (progress != null) progress.update("verifying", count, spec.size); }
            }
            StringBuilder actual = new StringBuilder(); for (byte b : hash.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            if (!spec.sha256.equals(actual.toString())) throw new IOException("DOWNLOAD_SHA256_MISMATCH");
        } catch (NoSuchAlgorithmException e) { throw new IOException("DOWNLOAD_HASH_UNAVAILABLE", e); }
    }
}
