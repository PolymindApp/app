package dev.coulombe.mom;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

final class IntervalCuePlayer {

    private static volatile IntervalCuePlayer instance;
    private static final int COUNT_PRIORITY = 1;
    private static final int SIGNAL_PRIORITY = 2;
    private static final int MAX_PLAY_ATTEMPTS = 3;
    private static final long GO_GUARD_MS = 800L;
    private static final long COMPLETE_GUARD_MS = 2500L;

    private final Object loadLock = new Object();
    private final Object playbackLock = new Object();
    private final Set<Integer> loadedSounds = new HashSet<>();
    private final Map<Integer, PendingCue> pendingSounds = new HashMap<>();
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    private final SoundPool soundPool;
    private final int countSound;
    private final int goSound;
    private final int completeSound;
    private int cueGeneration;
    private int latestCountGeneration;
    private int latestSignalGeneration;
    private int activeCountStream;
    private int activeSignalStream;
    private long signalProtectedUntilElapsedMs;

    private static final class PendingCue {
        final int priority;
        final int generation;

        PendingCue(int priority, int generation) {
            this.priority = priority;
            this.generation = generation;
        }
    }

    private IntervalCuePlayer(Context context) {
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        soundPool = new SoundPool.Builder()
            .setMaxStreams(4)
            .setAudioAttributes(attributes)
            .build();
        soundPool.setOnLoadCompleteListener((pool, sampleId, status) -> {
            if (status != 0) {
                synchronized (loadLock) {
                    pendingSounds.remove(sampleId);
                }
                return;
            }

            PendingCue pendingCue;
            synchronized (loadLock) {
                loadedSounds.add(sampleId);
                pendingCue = pendingSounds.remove(sampleId);
            }
            if (pendingCue != null) {
                playLoaded(sampleId, pendingCue.priority, pendingCue.generation, 1);
            }
        });
        countSound = soundPool.load(context, R.raw.count, 1);
        goSound = soundPool.load(context, R.raw.go, 1);
        completeSound = soundPool.load(context, R.raw.complete, 1);
    }

    static void preload(Context context) {
        get(context);
    }

    static void playCount(Context context) {
        IntervalCuePlayer player = get(context);
        player.play(player.countSound, COUNT_PRIORITY);
    }

    static void playGo(Context context) {
        IntervalCuePlayer player = get(context);
        player.play(player.goSound, SIGNAL_PRIORITY);
    }

    static void playComplete(Context context) {
        IntervalCuePlayer player = get(context);
        player.play(player.completeSound, SIGNAL_PRIORITY);
    }

    private static IntervalCuePlayer get(Context context) {
        IntervalCuePlayer player = instance;
        if (player != null) return player;

        synchronized (IntervalCuePlayer.class) {
            player = instance;
            if (player == null) {
                player = new IntervalCuePlayer(context.getApplicationContext());
                instance = player;
            }
        }
        return player;
    }

    private void play(int soundId, int priority) {
        int generation;
        synchronized (playbackLock) {
            generation = ++cueGeneration;
            if (priority >= SIGNAL_PRIORITY) {
                latestSignalGeneration = generation;
                signalProtectedUntilElapsedMs = Math.max(
                    signalProtectedUntilElapsedMs,
                    SystemClock.elapsedRealtime() + signalGuardMs(soundId)
                );
            } else {
                latestCountGeneration = generation;
            }
        }
        synchronized (loadLock) {
            if (!loadedSounds.contains(soundId)) {
                pendingSounds.put(soundId, new PendingCue(priority, generation));
                return;
            }
        }
        playLoaded(soundId, priority, generation, 1);
    }

    private void playLoaded(int soundId, int priority, int generation, int attempt) {
        int streamId;
        synchronized (playbackLock) {
            if (priority >= SIGNAL_PRIORITY) {
                if (generation != latestSignalGeneration) return;
            } else if (
                generation != latestCountGeneration
                || generation < latestSignalGeneration
                || SystemClock.elapsedRealtime() < signalProtectedUntilElapsedMs
            ) {
                return;
            }
            if (activeCountStream != 0) {
                soundPool.stop(activeCountStream);
                activeCountStream = 0;
            }
            if (priority >= SIGNAL_PRIORITY && activeSignalStream != 0) {
                soundPool.stop(activeSignalStream);
                activeSignalStream = 0;
            }
            streamId = soundPool.play(soundId, 1f, 1f, priority, 0, 1f);
            if (streamId != 0) {
                if (priority >= SIGNAL_PRIORITY) activeSignalStream = streamId;
                else activeCountStream = streamId;
            }
        }
        if (streamId != 0 || attempt >= MAX_PLAY_ATTEMPTS) return;
        retryHandler.postDelayed(
            () -> playLoaded(soundId, priority, generation, attempt + 1),
            40L * attempt
        );
    }

    private long signalGuardMs(int soundId) {
        return soundId == completeSound ? COMPLETE_GUARD_MS : GO_GUARD_MS;
    }
}
