package app.backontrack.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackgroundIntervalServiceTest {

    @Test
    public void reviewPlaybackUsesFourSecondStepBuffers() {
        long durationMs = 10_000L;

        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 10_000L));
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 6_001L));
        assertTrue(BackgroundIntervalService.reviewWindowIsActive(durationMs, 6_000L));
        assertTrue(BackgroundIntervalService.reviewWindowIsActive(durationMs, 4_001L));
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(durationMs, 4_000L));

        assertEquals(0L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 6_000L));
        assertEquals(1_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 5_000L));
        assertEquals(2_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 4_000L));
        assertEquals(2_000L, BackgroundIntervalService.reviewWindowElapsedMs(durationMs, 0L));
    }

    @Test
    public void shortStepsRemainPaused() {
        assertFalse(BackgroundIntervalService.reviewWindowIsActive(8_000L, 4_000L));
        assertEquals(0L, BackgroundIntervalService.reviewWindowElapsedMs(8_000L, 0L));
    }
}
