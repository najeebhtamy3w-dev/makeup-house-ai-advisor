package com.smartstock.core;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScanConfirmTest {
    @Test public void oneDimensionalNeedsTwoMatchingReads() {
        ScanConfirm c = new ScanConfirm(1500);
        assertNull(c.offer("6281000000011", false, 0));
        assertNull("a different (mis)read resets", c.offer("6281000000017", false, 100));
        assertNull(c.offer("6281000000011", false, 200));
        assertEquals("6281000000011", c.offer("6281000000011", false, 300));
        assertNull("exactly one result per opening", c.offer("6281000000011", false, 400));
        assertTrue(c.isDone());
    }
    @Test public void staleRepeatDoesNotConfirm() {
        ScanConfirm c = new ScanConfirm(1500);
        assertNull(c.offer("123", false, 0));
        assertNull(c.offer("123", false, 5000));
        assertEquals("123", c.offer("123", false, 5100));
    }
    @Test public void qrAcceptedImmediatelyAndBlankIgnored() {
        ScanConfirm c = new ScanConfirm(1500);
        assertNull(c.offer("  ", true, 0));
        assertEquals("ABC", c.offer(" ABC ", true, 1));
    }
}
