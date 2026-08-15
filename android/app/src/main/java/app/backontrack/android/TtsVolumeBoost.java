package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;

import java.io.File;
import java.io.IOException;

/**
 * Plays synthesized speech through an app-owned audio session so amplification never affects the
 * global output mix or another app's audio.
 */
final class TtsVolumeBoost {

    // LoudnessEnhancer uses millibels. +13.98 dB is approximately five times the linear amplitude.
    static final int AMPLIFICATION_GAIN_MILLIBELS = 1398;

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String activeUtteranceId = "";
    private boolean amplificationEnabled;
    private File synthesizedAudio;
    private MediaPlayer mediaPlayer;
    private LoudnessEnhancer loudnessEnhancer;

    TtsVolumeBoost(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int speak(
        TextToSpeech speech,
        String text,
        String utteranceId,
        boolean amplified
    ) {
        speech.stop();
        clearPlayback();

        try {
            synthesizedAudio = File.createTempFile("backontrack-tts-", ".wav", context.getCacheDir());
        } catch (IOException error) {
            return TextToSpeech.ERROR;
        }

        activeUtteranceId = utteranceId;
        amplificationEnabled = amplified;
        int result = speech.synthesizeToFile(text, null, synthesizedAudio, utteranceId);
        if (result == TextToSpeech.ERROR) finish(utteranceId);
        return result;
    }

    synchronized void playSynthesized(String utteranceId) {
        if (!activeUtteranceId.equals(utteranceId) || synthesizedAudio == null) return;
        File audio = synthesizedAudio;
        mainHandler.post(() -> preparePlayback(utteranceId, audio));
    }

    synchronized void setEnabled(boolean enabled) {
        amplificationEnabled = enabled;
        if (mediaPlayer == null) return;
        if (enabled) attachLoudnessEnhancer();
        else releaseLoudnessEnhancer();
    }

    synchronized void finish(String utteranceId) {
        if (!activeUtteranceId.equals(utteranceId)) return;
        clearPlayback();
    }

    synchronized void stop() {
        clearPlayback();
    }

    static double linearAmplitudeMultiplier(int gainMillibels) {
        return Math.pow(10d, gainMillibels / 2000d);
    }

    private synchronized void preparePlayback(String utteranceId, File audio) {
        if (!activeUtteranceId.equals(utteranceId) || synthesizedAudio != audio) return;

        MediaPlayer nextPlayer = new MediaPlayer();
        mediaPlayer = nextPlayer;
        try {
            nextPlayer.setAudioAttributes(speechAudioAttributes());
            nextPlayer.setDataSource(audio.getAbsolutePath());
            nextPlayer.setVolume(1f, 1f);
            nextPlayer.setOnPreparedListener(player -> startPreparedPlayback(utteranceId, player));
            nextPlayer.setOnCompletionListener(player -> finishPlayback(utteranceId, player));
            nextPlayer.setOnErrorListener((player, what, extra) -> {
                finishPlayback(utteranceId, player);
                return true;
            });
            nextPlayer.prepareAsync();
        } catch (IOException | RuntimeException error) {
            finish(utteranceId);
        }
    }

    private synchronized void startPreparedPlayback(String utteranceId, MediaPlayer player) {
        if (!activeUtteranceId.equals(utteranceId) || mediaPlayer != player) {
            releasePlayer(player);
            return;
        }
        if (amplificationEnabled) attachLoudnessEnhancer();
        try {
            player.start();
        } catch (RuntimeException error) {
            finish(utteranceId);
        }
    }

    private synchronized void finishPlayback(String utteranceId, MediaPlayer player) {
        if (!activeUtteranceId.equals(utteranceId) || mediaPlayer != player) {
            releasePlayer(player);
            return;
        }
        clearPlayback();
    }

    private void attachLoudnessEnhancer() {
        if (mediaPlayer == null || loudnessEnhancer != null) return;
        try {
            loudnessEnhancer = new LoudnessEnhancer(mediaPlayer.getAudioSessionId());
            loudnessEnhancer.setTargetGain(AMPLIFICATION_GAIN_MILLIBELS);
            loudnessEnhancer.setEnabled(true);
        } catch (RuntimeException error) {
            releaseLoudnessEnhancer();
        }
    }

    private static AudioAttributes speechAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private void clearPlayback() {
        activeUtteranceId = "";
        mainHandler.removeCallbacksAndMessages(null);
        releaseLoudnessEnhancer();
        if (mediaPlayer != null) {
            MediaPlayer currentPlayer = mediaPlayer;
            mediaPlayer = null;
            releasePlayer(currentPlayer);
        }
        if (synthesizedAudio != null) {
            //noinspection ResultOfMethodCallIgnored
            synthesizedAudio.delete();
            synthesizedAudio = null;
        }
    }

    private void releaseLoudnessEnhancer() {
        if (loudnessEnhancer == null) return;
        try {
            loudnessEnhancer.setEnabled(false);
            loudnessEnhancer.release();
        } catch (RuntimeException ignored) {
            // The audio framework also releases the effect when its app-owned session ends.
        } finally {
            loudnessEnhancer = null;
        }
    }

    private void releasePlayer(MediaPlayer player) {
        try {
            player.setOnPreparedListener(null);
            player.setOnCompletionListener(null);
            player.setOnErrorListener(null);
            player.release();
        } catch (RuntimeException ignored) {
            // Releasing an already-ended player is safe to ignore.
        }
    }
}
