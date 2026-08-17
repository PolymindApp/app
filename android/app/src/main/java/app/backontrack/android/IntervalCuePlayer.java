package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
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
    private final Context context;
    private final AudioAttributes audioAttributes;
    private final SoundPool soundPool;
    private final Map<String, Integer> signalResources = new HashMap<>();
    private final int countSound;
    private final int goSound;
    private final int completeSound;
    private int cueGeneration;
    private int latestCountGeneration;
    private int latestSignalGeneration;
    private int activeCountStream;
    private int activeSignalStream;
    private MediaPlayer activeMediaSignal;
    private TransientAudioFocus.Lease activeCountFocus;
    private TransientAudioFocus.Lease activeSignalFocus;
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
        this.context = context.getApplicationContext();
        audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        soundPool = new SoundPool.Builder()
            .setMaxStreams(4)
            .setAudioAttributes(audioAttributes)
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
        signalResources.put("cash", R.raw.cash);
        signalResources.put("celestial", R.raw.celestial);
        signalResources.put("chime", R.raw.chime);
        signalResources.put("cine-boom", R.raw.cine_boom);
        signalResources.put("cine-hit", R.raw.cine_hit);
        signalResources.put("confirm", R.raw.confirm);
        signalResources.put("gong", R.raw.gong);
        signalResources.put("harp", R.raw.harp);
        signalResources.put("magic", R.raw.magic);
        signalResources.put("notification", R.raw.notification);
        signalResources.put("copper-bell", R.raw.copper_bell);
        signalResources.put("eject", R.raw.eject);
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

    static void playSignal(Context context, String name) {
        IntervalCuePlayer player = get(context);
        int soundId = player.soundId(name);
        if (soundId != 0) {
            player.play(soundId, SIGNAL_PRIORITY);
            return;
        }
        Integer resourceId = player.signalResources.get(name);
        if (resourceId != null) player.playMediaSignal(resourceId);
    }

    static boolean supportsSound(String name) {
        switch (name) {
            case "cash":
            case "celestial":
            case "chime":
            case "cine-boom":
            case "cine-hit":
            case "confirm":
            case "gong":
            case "harp":
            case "magic":
            case "notification":
            case "copper-bell":
            case "eject":
            case "count":
            case "go":
            case "complete":
                return true;
            default:
                return false;
        }
    }

    private int soundId(String name) {
        if ("count".equals(name)) return countSound;
        if ("go".equals(name)) return goSound;
        if ("complete".equals(name)) return completeSound;
        return 0;
    }

    private void playMediaSignal(int resourceId) {
        int generation;
        synchronized (playbackLock) {
            generation = ++cueGeneration;
            latestSignalGeneration = generation;
            signalProtectedUntilElapsedMs = Long.MAX_VALUE;
            stopSoundPoolStreamsLocked();
            stopMediaSignalLocked();
        }

        MediaPlayer mediaPlayer = MediaPlayer.create(
            this.context,
            resourceId,
            audioAttributes,
            0
        );
        if (mediaPlayer == null) {
            clearMediaSignalGuard(generation);
            return;
        }
        mediaPlayer.setOnCompletionListener(completed -> finishMediaSignal(completed, generation));
        mediaPlayer.setOnErrorListener((failed, what, extra) -> {
            finishMediaSignal(failed, generation);
            return true;
        });

        TransientAudioFocus.Lease focusLease = TransientAudioFocus.acquire(
            this.context,
            audioAttributes
        );
        synchronized (playbackLock) {
            if (generation != latestSignalGeneration) {
                focusLease.release();
                mediaPlayer.release();
                return;
            }
            activeMediaSignal = mediaPlayer;
            activeSignalFocus = focusLease;
        }
        try {
            mediaPlayer.start();
        } catch (IllegalStateException error) {
            finishMediaSignal(mediaPlayer, generation);
        }
    }

    private void finishMediaSignal(MediaPlayer mediaPlayer, int generation) {
        mediaPlayer.setOnCompletionListener(null);
        mediaPlayer.setOnErrorListener(null);
        synchronized (playbackLock) {
            if (activeMediaSignal == mediaPlayer) {
                activeMediaSignal = null;
                releaseSignalFocusLocked();
            }
            if (generation == latestSignalGeneration) {
                signalProtectedUntilElapsedMs = SystemClock.elapsedRealtime();
            }
        }
        mediaPlayer.release();
    }

    private void clearMediaSignalGuard(int generation) {
        synchronized (playbackLock) {
            if (generation == latestSignalGeneration) {
                signalProtectedUntilElapsedMs = SystemClock.elapsedRealtime();
            }
        }
    }

    private void stopSoundPoolStreamsLocked() {
        if (activeCountStream != 0) {
            soundPool.stop(activeCountStream);
            activeCountStream = 0;
            releaseCountFocusLocked();
        }
        if (activeSignalStream != 0) {
            soundPool.stop(activeSignalStream);
            activeSignalStream = 0;
            releaseSignalFocusLocked();
        }
    }

    private void stopMediaSignalLocked() {
        MediaPlayer mediaPlayer = activeMediaSignal;
        activeMediaSignal = null;
        if (mediaPlayer == null) return;
        mediaPlayer.setOnCompletionListener(null);
        mediaPlayer.setOnErrorListener(null);
        try {
            mediaPlayer.stop();
        } catch (IllegalStateException ignored) {
            // The player may have completed before it could be stopped.
        }
        mediaPlayer.release();
        releaseSignalFocusLocked();
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
                if (activeMediaSignal != null) {
                    stopMediaSignalLocked();
                    signalProtectedUntilElapsedMs = 0L;
                }
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
                releaseCountFocusLocked();
            }
            if (priority >= SIGNAL_PRIORITY && activeSignalStream != 0) {
                soundPool.stop(activeSignalStream);
                activeSignalStream = 0;
                releaseSignalFocusLocked();
            }
            if (priority >= SIGNAL_PRIORITY) stopMediaSignalLocked();
            TransientAudioFocus.Lease focusLease = TransientAudioFocus.acquire(
                context,
                audioAttributes
            );
            streamId = soundPool.play(soundId, 1f, 1f, priority, 0, 1f);
            if (streamId != 0) {
                if (priority >= SIGNAL_PRIORITY) {
                    activeSignalStream = streamId;
                    activeSignalFocus = focusLease;
                } else {
                    activeCountStream = streamId;
                    activeCountFocus = focusLease;
                }
            } else {
                focusLease.release();
            }
        }
        if (streamId != 0) {
            retryHandler.postDelayed(
                () -> finishSoundPoolFocus(streamId, priority),
                focusDurationMs(soundId)
            );
            return;
        }
        if (attempt >= MAX_PLAY_ATTEMPTS) return;
        retryHandler.postDelayed(
            () -> playLoaded(soundId, priority, generation, attempt + 1),
            40L * attempt
        );
    }

    private long signalGuardMs(int soundId) {
        return soundId == completeSound ? COMPLETE_GUARD_MS : GO_GUARD_MS;
    }

    private long focusDurationMs(int soundId) {
        if (soundId == completeSound) return 2300L;
        return 700L;
    }

    private void finishSoundPoolFocus(int streamId, int priority) {
        synchronized (playbackLock) {
            if (priority >= SIGNAL_PRIORITY && activeSignalStream == streamId) {
                activeSignalStream = 0;
                releaseSignalFocusLocked();
            } else if (priority < SIGNAL_PRIORITY && activeCountStream == streamId) {
                activeCountStream = 0;
                releaseCountFocusLocked();
            }
        }
    }

    private void releaseCountFocusLocked() {
        if (activeCountFocus == null) return;
        activeCountFocus.release();
        activeCountFocus = null;
    }

    private void releaseSignalFocusLocked() {
        if (activeSignalFocus == null) return;
        activeSignalFocus.release();
        activeSignalFocus = null;
    }
}
