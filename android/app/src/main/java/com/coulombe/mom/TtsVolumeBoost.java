package dev.coulombe.mom;

import android.content.Context;
import android.media.AudioManager;
import android.media.audiofx.LoudnessEnhancer;

final class TtsVolumeBoost {

    // LoudnessEnhancer uses millibels. +6 dB is approximately twice the linear amplitude.
    static final int AMPLIFICATION_GAIN_MILLIBELS = 600;

    private final AudioManager audioManager;
    private String activeUtteranceId = "";
    private int originalVolume = -1;
    private int boostedVolume = -1;
    private LoudnessEnhancer loudnessEnhancer;

    TtsVolumeBoost(Context context) {
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    synchronized void start(String utteranceId, boolean enabled) {
        stop();
        activeUtteranceId = utteranceId;
        setEnabled(enabled);
    }

    synchronized void setEnabled(boolean enabled) {
        if (activeUtteranceId.isEmpty()) return;
        if (enabled) amplify();
        else restore();
    }

    synchronized void finish(String utteranceId) {
        if (!activeUtteranceId.equals(utteranceId)) return;
        restore();
        activeUtteranceId = "";
    }

    synchronized void stop() {
        restore();
        activeUtteranceId = "";
    }

    private void amplify() {
        if (audioManager != null && originalVolume < 0) {
            try {
                originalVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                boostedVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, boostedVolume, 0);
            } catch (RuntimeException error) {
                originalVolume = -1;
                boostedVolume = -1;
            }
        }
        if (loudnessEnhancer == null) {
            try {
                loudnessEnhancer = new LoudnessEnhancer(0);
                loudnessEnhancer.setTargetGain(AMPLIFICATION_GAIN_MILLIBELS);
                loudnessEnhancer.setEnabled(true);
            } catch (RuntimeException error) {
                releaseLoudnessEnhancer();
            }
        }
    }

    private void restore() {
        if (audioManager != null && originalVolume >= 0) {
            try {
                if (audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) == boostedVolume) {
                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, originalVolume, 0);
                }
            } catch (RuntimeException ignored) {
                // The device keeps its current media volume if restoration is unavailable.
            } finally {
                originalVolume = -1;
                boostedVolume = -1;
            }
        }
        releaseLoudnessEnhancer();
    }

    private void releaseLoudnessEnhancer() {
        if (loudnessEnhancer == null) return;
        try {
            loudnessEnhancer.setEnabled(false);
            loudnessEnhancer.release();
        } catch (RuntimeException ignored) {
            // The audio framework also releases the effect when its session ends.
        } finally {
            loudnessEnhancer = null;
        }
    }
}
