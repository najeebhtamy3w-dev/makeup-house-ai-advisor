package com.makeuphouse.advisor;

import java.io.EOFException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;

/** Offline byte import only. No URI grants, folder metadata or network operation is required. */
public final class VerifiedAssetImport {
    private static final long STORAGE_RESERVE = 16L * 1024L * 1024L;
    private VerifiedAssetImport() {}
    public interface Progress { void update(long bytes, long total); }
    public interface BeforeInstall { void run() throws Exception; }

    private static void checkCancelled(AtomicBoolean cancelled) throws IOException {
        if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("IMPORT_CANCELLED");
    }

    /**
     * The caller owns and closes source. Only a newly created private staging file is removed on failure.
     * Existing target bytes survive all read/verification/cancellation failures. The callback lets the
     * native owner release its old mmap before the final same-filesystem atomic rename on Android/Linux.
     */
    public static File importTo(InputStream source, File target, ResumableAssetDownload.DownloadSpec spec,
                                AtomicBoolean cancelled, Progress progress, BeforeInstall beforeInstall) throws Exception {
        if (source == null || target == null || spec == null || cancelled == null)
            throw new IllegalArgumentException("INVALID_IMPORT_OPTIONS");
        checkCancelled(cancelled);
        File parent = target.getAbsoluteFile().getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("IMPORT_DIRECTORY");
        if (target.exists() && !target.isFile()) throw new IOException("IMPORT_TARGET_INVALID");
        if (spec.size > Long.MAX_VALUE - STORAGE_RESERVE || parent.getUsableSpace() < spec.size + STORAGE_RESERVE)
            throw new IOException("INSUFFICIENT_STORAGE");

        File staging = File.createTempFile(".mh-verified-import-", ".part", parent);
        try {
            long copied = 0;
            if (progress != null) progress.update(0, spec.size);
            try (FileOutputStream output = new FileOutputStream(staging)) {
                byte[] buffer = new byte[65536];
                int count;
                while (true) {
                    checkCancelled(cancelled);
                    count = source.read(buffer);
                    if (count == -1) break;
                    checkCancelled(cancelled);
                    if (count == 0) continue;
                    if (count > spec.size - copied) throw new IOException("IMPORT_SIZE_MISMATCH");
                    output.write(buffer, 0, count);
                    copied += count;
                    if (progress != null) progress.update(copied, spec.size);
                }
                output.getFD().sync();
            }
            checkCancelled(cancelled);
            if (copied != spec.size) throw new EOFException("IMPORT_SIZE_MISMATCH");
            // verify() checks full size, GGUF magic and the pinned SHA-256; it never opens spec.url.
            new ResumableAssetDownload(spec).verify(staging, cancelled, null);
            checkCancelled(cancelled);
            if (beforeInstall != null) beforeInstall.run();
            checkCancelled(cancelled);
            // Never delete target first. A failed rename leaves the prior installed asset untouched.
            if (!staging.renameTo(target)) throw new IOException("IMPORT_ATOMIC_INSTALL_FAILED");
            return target;
        } finally {
            // staging is this call's unique temporary file, never the source or an older download.
            if (staging.exists()) staging.delete();
        }
    }
}
