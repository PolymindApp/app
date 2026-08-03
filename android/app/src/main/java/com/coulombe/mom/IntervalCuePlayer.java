package dev.coulombe.mom;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

import java.util.HashSet;
import java.util.Set;

final class IntervalCuePlayer {

    private static volatile IntervalCuePlayer instance;

    private final Object loadLock = new Object();
    private final Set<Integer> loadedSounds = new HashSet<>();
    private final Set<Integer> pendingSounds = new HashSet<>();
    private final SoundPool soundPool;
    private final int countSound;
    private final int goSound;
    private final int completeSound;

    private IntervalCuePlayer(Context context) {
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        soundPool = new SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(attributes)
            .build();
        soundPool.setOnLoadCompleteListener((pool, sampleId, status) -> {
            if (status != 0) {
                synchronized (loadLock) {
                    pendingSounds.remove(sampleId);
                }
                return;
            }

            boolean playPending;
            synchronized (loadLock) {
                loadedSounds.add(sampleId);
                playPending = pendingSounds.remove(sampleId);
            }
            if (playPending) playLoaded(sampleId);
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
        player.play(player.countSound);
    }

    static void playGo(Context context) {
        IntervalCuePlayer player = get(context);
        player.play(player.goSound);
    }

    static void playComplete(Context context) {
        IntervalCuePlayer player = get(context);
        player.play(player.completeSound);
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

    private void play(int soundId) {
        synchronized (loadLock) {
            if (!loadedSounds.contains(soundId)) {
                pendingSounds.add(soundId);
                return;
            }
        }
        playLoaded(soundId);
    }

    private void playLoaded(int soundId) {
        soundPool.play(soundId, 1f, 1f, 1, 0, 1f);
    }
}
