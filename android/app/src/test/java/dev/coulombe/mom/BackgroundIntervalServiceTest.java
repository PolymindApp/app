package dev.coulombe.mom;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackgroundIntervalServiceTest {

    @Test
    public void reviewPlaybackUsesThreeSecondStepBuffers() {
        long durationMs = 10_000L;

        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 10_000L));
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 7_001L));
        assertTrue(BackgroundIntervalService.reviewWindowIsActive(durationMs, 7_000L));
        assertTrue(BackgroundIntervalService.reviewWindowIsActive(durationMs, 3_001L));
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 3_000L));

        assertEquals(0L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 7_000L));
        assertEquals(2_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 5_000L));
        assertEquals(4_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 3_000L));
        assertEquals(4_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 0L));
    }

    @Test
    public void shortStepsRemainPaused() {
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(6_000L, 3_000L));
        assertEquals(0L, BackgroundIntervalService.reviewWindowElapsedMs(6_000L, 0L));
    }
}
