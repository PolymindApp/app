package app.polymind.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TtsVolumeBoostTest {

    @Test
    public void configuredGainIsApproximatelyFourTimesTheLinearAmplitude() {
        double multiplier = TtsVolumeBoost.linearAmplitudeMultiplier(
            TtsVolumeBoost.AMPLIFICATION_GAIN_MILLIBELS
        );

        assertEquals(3.98d, multiplier, 0.01d);
        assertTrue(multiplier >= 3.9d);
    }
}
