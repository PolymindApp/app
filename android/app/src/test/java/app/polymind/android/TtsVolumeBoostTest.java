package app.polymind.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TtsVolumeBoostTest {

    @Test
    public void configuredGainIsApproximatelyFiveTimesTheLinearAmplitude() {
        double multiplier = TtsVolumeBoost.linearAmplitudeMultiplier(
            TtsVolumeBoost.AMPLIFICATION_GAIN_MILLIBELS
        );

        assertEquals(5d, multiplier, 0.01d);
        assertTrue(multiplier >= 4.99d);
    }
}
