package com.smartstock.core;

/**
 * Decides when a camera read is trustworthy. 1D barcodes (EAN/UPC/Code128…) seen through shiny
 * shrink-wrap can be mis-decoded on a single frame, so the same value must be read on two frames
 * within a short window. 2D codes (QR / DataMatrix) carry their own error correction: accepted at once.
 */
public final class ScanConfirm {
    private final long windowMs;
    private String last;
    private long lastAt;
    private boolean done;

    public ScanConfirm(long windowMs) { this.windowMs = windowMs; }

    /** @return the accepted value, or null to keep scanning. */
    public synchronized String offer(String value, boolean twoD, long nowMs) {
        if (done || value == null) return null;
        String v = value.trim();
        if (v.isEmpty()) return null;
        if (twoD || (v.equals(last) && nowMs - lastAt <= windowMs)) { done = true; return v; }
        last = v;
        lastAt = nowMs;
        return null;
    }

    public synchronized boolean isDone() { return done; }
}
