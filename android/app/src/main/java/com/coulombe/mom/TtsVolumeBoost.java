package dev.coulombe.mom;

import android.content.Context;
import android.media.AudioManager;

final class TtsVolumeBoost {

    private final AudioManager audioManager;
    private String activeUtteranceId = "";
    private int originalVolume = -1;
    private int boostedVolume = -1;

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
        if (audioManager == null || originalVolume >= 0) return;
        try {
            originalVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            boostedVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, boostedVolume, 0);
        } catch (RuntimeException error) {
            originalVolume = -1;
            boostedVolume = -1;
        }
    }

    private void restore() {
        if (audioManager == null || originalVolume < 0) return;
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
}
