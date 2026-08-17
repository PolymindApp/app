package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

final class FlashcardRecordingPlayer {

    interface PlaybackAllowed {
        boolean get();
    }

    private final Context context;
    private MediaPlayer player;
    private TransientAudioFocus.Lease audioFocusLease;
    private File temporaryFile;
    private Runnable pendingCancellation;
    private long generation;

    FlashcardRecordingPlayer(Context context) {
        this.context = context.getApplicationContext();
    }

    void play(String source, Runnable fallback, PlaybackAllowed playbackAllowed) {
        play(source, () -> {}, fallback, () -> {}, playbackAllowed);
    }

    void play(
        String source,
        Runnable started,
        Runnable fallback,
        Runnable cancelled,
        PlaybackAllowed playbackAllowed
    ) {
        stop();
        if (source == null || source.trim().isEmpty()) {
            fallback.run();
            return;
        }

        long requestGeneration = generation;
        MediaPlayer nextPlayer = new MediaPlayer();
        player = nextPlayer;
        pendingCancellation = cancelled;
        AudioAttributes audioAttributes = speechAudioAttributes();
        nextPlayer.setAudioAttributes(audioAttributes);
        nextPlayer.setOnPreparedListener(prepared -> {
            if (
                requestGeneration != generation
                || player != prepared
                || !playbackAllowed.get()
            ) {
                Runnable cancellation = takePendingCancellation(prepared);
                release(prepared);
                if (cancellation != null) cancellation.run();
                return;
            }
            try {
                audioFocusLease = TransientAudioFocus.acquire(
                    context,
                    audioAttributes
                );
                prepared.start();
                takePendingCancellation(prepared);
                started.run();
            } catch (RuntimeException error) {
                boolean shouldFallback = requestGeneration == generation
                    && player == prepared
                    && playbackAllowed.get();
                takePendingCancellation(prepared);
                release(prepared);
                if (shouldFallback) fallback.run();
            }
        });
        nextPlayer.setOnCompletionListener(this::release);
        nextPlayer.setOnErrorListener((failed, what, extra) -> {
            boolean shouldFallback = requestGeneration == generation
                && player == failed
                && playbackAllowed.get();
            takePendingCancellation(failed);
            release(failed);
            if (shouldFallback) fallback.run();
            return true;
        });

        try {
            String trimmed = source.trim();
            if (trimmed.startsWith("data:audio/")) {
                nextPlayer.setDataSource(writeDataUrl(trimmed).getAbsolutePath());
            } else {
                nextPlayer.setDataSource(trimmed);
            }
            nextPlayer.prepareAsync();
        } catch (IOException | IllegalArgumentException error) {
            takePendingCancellation(nextPlayer);
            release(nextPlayer);
            if (playbackAllowed.get()) fallback.run();
        }
    }

    void stop() {
        generation += 1;
        Runnable cancellation = pendingCancellation;
        pendingCancellation = null;
        MediaPlayer current = player;
        if (current != null) release(current);
        else removeTemporaryFile();
        if (cancellation != null) cancellation.run();
    }

    private File writeDataUrl(String source) throws IOException {
        int comma = source.indexOf(',');
        String metadata = comma < 0 ? "" : source.substring(0, comma).toLowerCase();
        if (comma < 0 || !metadata.endsWith(";base64")) {
            throw new IOException("Invalid audio data URL.");
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(source.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("Invalid audio data URL.", error);
        }
        if (bytes.length < 100 || bytes.length > 1_500_000) {
            throw new IOException("Invalid audio data size.");
        }
        String extension = metadata.startsWith("data:audio/mp4") ? ".m4a" : ".webm";
        temporaryFile = File.createTempFile("flashcard-audio-", extension, context.getCacheDir());
        try (FileOutputStream output = new FileOutputStream(temporaryFile)) {
            output.write(bytes);
        }
        return temporaryFile;
    }

    private static AudioAttributes speechAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private void release(MediaPlayer target) {
        boolean active = player == target;
        if (active) {
            player = null;
            pendingCancellation = null;
        }
        try {
            target.setOnPreparedListener(null);
            target.setOnCompletionListener(null);
            target.setOnErrorListener(null);
            try {
                target.stop();
            } catch (IllegalStateException ignored) {
                // The player may still be preparing.
            }
            target.reset();
            target.release();
        } catch (RuntimeException ignored) {
            // Releasing an already-ended player is safe to ignore.
        }
        if (active) removeTemporaryFile();
        if (active && audioFocusLease != null) {
            audioFocusLease.release();
            audioFocusLease = null;
        }
    }

    private Runnable takePendingCancellation(MediaPlayer target) {
        if (player != target) return null;
        Runnable cancellation = pendingCancellation;
        pendingCancellation = null;
        return cancellation;
    }

    private void removeTemporaryFile() {
        if (temporaryFile != null && temporaryFile.isFile()) temporaryFile.delete();
        temporaryFile = null;
    }
}
