package app.polymind.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class IntervalCuePlayerTest {

    @Test
    public void supportsEveryConfigurableIntervalSound() {
        String[] sounds = {
            "cash",
            "celestial",
            "chime",
            "cine-boom",
            "cine-hit",
            "confirm",
            "gong",
            "harp",
            "magic",
            "notification",
            "count",
            "go",
            "complete",
            "copper-bell",
        };

        for (String sound : sounds) assertTrue(IntervalCuePlayer.supportsSound(sound));
        assertTrue(IntervalCuePlayer.supportsSound("eject"));
        assertFalse(IntervalCuePlayer.supportsSound("none"));
        assertFalse(IntervalCuePlayer.supportsSound("bell"));
    }
}
