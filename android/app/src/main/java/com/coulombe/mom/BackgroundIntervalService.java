package dev.coulombe.mom;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class BackgroundIntervalService extends Service {

    public static final String ACTION_START = "dev.coulombe.mom.interval.START";
    public static final String ACTION_STOP = "dev.coulombe.mom.interval.STOP";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_SESSION_NAME = "sessionName";
    public static final String EXTRA_STEPS = "steps";
    public static final String EXTRA_STEP_INDEX = "stepIndex";
    public static final String EXTRA_REMAINING_MS = "remainingMs";
    public static final String EXTRA_SOUND_ENABLED = "soundEnabled";
    public static final String EXTRA_VIBRATION_ENABLED = "vibrationEnabled";

    private static final String CHANNEL_ID = "mom_interval_timer";
    private static final int NOTIFICATION_ID = 4107;
    private static final long TICK_MS = 250L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<IntervalStep> steps = new ArrayList<>();
    private PowerManager.WakeLock wakeLock;
    private MediaPlayer activeAudio;
    private String sessionName = "Interval";
    private int stepIndex;
    private int lastCountdownSecond = -1;
    private long deadlineElapsedMs;
    private boolean soundEnabled;
    private boolean vibrationEnabled;
    private boolean running;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            playCountdown(now);
            advance(now);
            if (!running) return;
            updateNotification(false);
            if (steps.get(stepIndex).requiresConfirmation) {
                releaseWakeLock();
                return;
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    public static final class IntervalStep {
        final String name;
        final long durationMs;
        final boolean requiresConfirmation;

        IntervalStep(String name, long durationMs, boolean requiresConfirmation) {
            this.name = name;
            this.durationMs = durationMs;
            this.requiresConfirmation = requiresConfirmation;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            stopTimer();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;

        try {
            configure(intent);
            startAsForeground();
            if (steps.get(stepIndex).requiresConfirmation) {
                releaseWakeLock();
            } else {
                acquireWakeLock();
            }
            running = true;
            handler.removeCallbacks(ticker);
            handler.post(ticker);
        } catch (JSONException | IllegalArgumentException error) {
            stopTimer();
        }
        return START_NOT_STICKY;
    }

    private void configure(Intent intent) throws JSONException {
        JSONArray encodedSteps = new JSONArray(intent.getStringExtra(EXTRA_STEPS));
        steps.clear();
        for (int index = 0; index < encodedSteps.length(); index += 1) {
            JSONObject encoded = encodedSteps.getJSONObject(index);
            steps.add(new IntervalStep(
                encoded.optString("name", "Interval " + (index + 1)),
                Math.max(1L, encoded.optLong("durationMs", 1L)),
                encoded.optBoolean("requiresConfirmation", false)
            ));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("Interval sequence is empty.");

        sessionName = intent.getStringExtra(EXTRA_SESSION_NAME);
        if (sessionName == null || sessionName.trim().isEmpty()) sessionName = "Interval";
        stepIndex = Math.max(0, Math.min(intent.getIntExtra(EXTRA_STEP_INDEX, 0), steps.size() - 1));
        long remainingMs = Math.max(1L, intent.getLongExtra(EXTRA_REMAINING_MS, steps.get(stepIndex).durationMs));
        deadlineElapsedMs = SystemClock.elapsedRealtime() + remainingMs;
        lastCountdownSecond = -1;
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND_ENABLED, true);
        vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true);
    }

    private void startAsForeground() {
        Notification notification = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void advance(long now) {
        if (steps.get(stepIndex).requiresConfirmation) return;
        while (running && now >= deadlineElapsedMs) {
            stepIndex += 1;
            if (stepIndex >= steps.size()) {
                finishTimer();
                return;
            }
            lastCountdownSecond = -1;
            if (!MainActivity.isAppVisible()) playGoCue();
            if (steps.get(stepIndex).requiresConfirmation) {
                deadlineElapsedMs = now;
                return;
            }
            deadlineElapsedMs += steps.get(stepIndex).durationMs;
        }
    }

    private void finishTimer() {
        if (!MainActivity.isAppVisible()) playGoCue();
        running = false;
        handler.removeCallbacks(ticker);
        releaseWakeLock();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID + 1, buildNotification(true));
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopTimer() {
        running = false;
        handler.removeCallbacks(ticker);
        releaseWakeLock();
        releaseAudio();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void playCountdown(long now) {
        if (
            !soundEnabled
            || MainActivity.isAppVisible()
            || steps.get(stepIndex).requiresConfirmation
        ) return;
        long remainingMs = Math.max(0L, deadlineElapsedMs - now);
        int remainingSeconds = (int) Math.ceil(remainingMs / 1000d);
        if (remainingSeconds >= 1 && remainingSeconds <= 3 && remainingSeconds != lastCountdownSecond) {
            lastCountdownSecond = remainingSeconds;
            playSound(R.raw.count);
        } else if (remainingSeconds > 3) {
            lastCountdownSecond = -1;
        }
    }

    private void playGoCue() {
        if (soundEnabled) playSound(R.raw.go);
        if (vibrationEnabled) vibrate();
    }

    private void playSound(int soundResource) {
        releaseAudio();
        MediaPlayer player = MediaPlayer.create(this, soundResource);
        if (player == null) return;
        activeAudio = player;
        player.setOnCompletionListener(completed -> {
            if (activeAudio == completed) activeAudio = null;
            completed.release();
        });
        player.setOnErrorListener((failed, what, extra) -> {
            if (activeAudio == failed) activeAudio = null;
            failed.release();
            return true;
        });
        player.start();
    }

    private void vibrate() {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
            vibrator = manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;

        long[] pattern = new long[] { 0L, 120L, 60L, 120L };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createWaveform(pattern, -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
            );
        } else {
            vibrator.vibrate(pattern, -1);
        }
    }

    private void updateNotification(boolean complete) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, buildNotification(complete));
    }

    private Notification buildNotification(boolean complete) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = complete ? sessionName + " complete" : sessionName;
        String text;
        if (complete || stepIndex >= steps.size()) {
            text = "Interval session complete";
        } else if (steps.get(stepIndex).requiresConfirmation) {
            text = steps.get(stepIndex).name + " · Confirmation required";
        } else {
            long remainingMs = Math.max(0L, deadlineElapsedMs - SystemClock.elapsedRealtime());
            long totalSeconds = (long) Math.ceil(remainingMs / 1000d);
            text = steps.get(stepIndex).name + " · " + String.format(
                Locale.getDefault(),
                "%02d:%02d",
                totalSeconds / 60,
                totalSeconds % 60
            );
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(!complete)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Mom intervals",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps interval sessions and cue sounds running in the background.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mom:interval-timer");
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void releaseAudio() {
        if (activeAudio == null) return;
        MediaPlayer audio = activeAudio;
        activeAudio = null;
        try {
            audio.stop();
        } catch (IllegalStateException ignored) {
            // The short cue may already have completed.
        }
        audio.release();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        releaseAudio();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
