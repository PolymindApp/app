package app.polymind.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class BackgroundIntervalService extends Service {

    public static final String ACTION_START = "app.polymind.android.interval.START";
    public static final String ACTION_STOP = "app.polymind.android.interval.STOP";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_SESSION_NAME = "sessionName";
    public static final String EXTRA_STEPS = "steps";
    public static final String EXTRA_STEP_INDEX = "stepIndex";
    public static final String EXTRA_REMAINING_MS = "remainingMs";
    public static final String EXTRA_ELAPSED_MS = "elapsedMs";
    public static final String EXTRA_SOUND_ENABLED = "soundEnabled";
    public static final String EXTRA_VIBRATION_ENABLED = "vibrationEnabled";
    public static final String EXTRA_FLASHCARD_REVIEW = "flashcardReview";

    private static final String CHANNEL_ID = "polymind_interval_timer";
    private static final int NOTIFICATION_ID = 4107;
    private static final long TICK_MS = 250L;
    static final long REVIEW_EDGE_PAUSE_MS = 4_000L;
    private static volatile BackgroundIntervalService activeInstance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<IntervalStep> steps = new ArrayList<>();
    private final List<ReviewCard> reviewCards = new ArrayList<>();
    private PowerManager.WakeLock wakeLock;
    private TextToSpeech speech;
    private TtsVolumeBoost volumeBoost;
    private boolean speechReady;
    private String sessionId = "";
    private String sessionName = "Interval";
    private int stepIndex;
    private int lastCountdownSecond = -1;
    private long deadlineElapsedMs;
    private boolean soundEnabled;
    private boolean vibrationEnabled;
    private boolean running;
    private long reviewBaseElapsedMs;
    private long reviewConfiguredWindowElapsedMs;
    private long reviewFrontDurationMs = 5000L;
    private long reviewBaseBackDurationMs = 5000L;
    private long reviewBackDurationMs = 5000L;
    private int reviewBackSpeechRepeatCount = 1;
    private String reviewCardSides = "both";
    private String reviewFrontLanguage = "";
    private String reviewBackLanguage = "";
    private String lastReviewSpeechKey = "";
    private String pendingReviewSpeechText = "";
    private String pendingReviewSpeechLanguage = "";
    private boolean reviewSpeechOverAmplified;
    private boolean appWasVisible;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            playCountdown(now);
            advance(now);
            if (!running) return;
            updateReviewSpeech(now);
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
        final boolean flashcardReviewEnabled;
        final String cueSound;

        IntervalStep(
            String name,
            long durationMs,
            boolean requiresConfirmation,
            boolean flashcardReviewEnabled,
            String cueSound
        ) {
            this.name = name;
            this.durationMs = durationMs;
            this.requiresConfirmation = requiresConfirmation;
            this.flashcardReviewEnabled = flashcardReviewEnabled;
            this.cueSound = cueSound;
        }
    }

    private static final class ReviewCard {
        final String front;
        final String back;

        ReviewCard(String front, String back) {
            this.front = front;
            this.back = back;
        }
    }

    private static final class ReviewPhase {
        final int cardIndex;
        final String side;
        final String key;

        ReviewPhase(int cardIndex, String side, String key) {
            this.cardIndex = cardIndex;
            this.side = side;
            this.key = key;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        createNotificationChannel();
        volumeBoost = new TtsVolumeBoost(this);
        speech = new TextToSpeech(this, status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            TextToSpeech currentSpeech = speech;
            if (speechReady && currentSpeech != null) {
                currentSpeech.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                );
                currentSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        volumeBoost.playSynthesized(utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        volumeBoost.finish(utteranceId);
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        volumeBoost.finish(utteranceId);
                    }
                });
                speakPendingReviewSide();
            }
        });
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
        String previousSessionId = sessionId;
        JSONArray encodedSteps = new JSONArray(intent.getStringExtra(EXTRA_STEPS));
        steps.clear();
        for (int index = 0; index < encodedSteps.length(); index += 1) {
            JSONObject encoded = encodedSteps.getJSONObject(index);
            steps.add(new IntervalStep(
                encoded.optString("name", "Interval " + (index + 1)),
                Math.max(1L, encoded.optLong("durationMs", 1L)),
                encoded.optBoolean("requiresConfirmation", false),
                encoded.optBoolean("flashcardReviewEnabled", true),
                encoded.optString("cueSound", "go")
            ));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("Interval sequence is empty.");

        sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("An interval session ID is required.");
        }
        sessionId = sessionId.trim();
        sessionName = intent.getStringExtra(EXTRA_SESSION_NAME);
        if (sessionName == null || sessionName.trim().isEmpty()) sessionName = "Interval";
        stepIndex = Math.max(0, Math.min(intent.getIntExtra(EXTRA_STEP_INDEX, 0), steps.size() - 1));
        long remainingMs = Math.max(1L, intent.getLongExtra(EXTRA_REMAINING_MS, steps.get(stepIndex).durationMs));
        deadlineElapsedMs = SystemClock.elapsedRealtime() + remainingMs;
        lastCountdownSecond = -1;
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND_ENABLED, true);
        vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true);
        configureFlashcardReview(intent, previousSessionId);
    }

    private void configureFlashcardReview(Intent intent, String previousSessionId) throws JSONException {
        String encodedReview = intent.getStringExtra(EXTRA_FLASHCARD_REVIEW);
        reviewCards.clear();
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        reviewBaseElapsedMs = Math.max(0L, intent.getLongExtra(EXTRA_ELAPSED_MS, 0L));
        reviewConfiguredWindowElapsedMs = currentStepReviewWindowElapsedMs(
            SystemClock.elapsedRealtime()
        );
        appWasVisible = MainActivity.isAppVisible();

        if (encodedReview == null || encodedReview.trim().isEmpty()) {
            lastReviewSpeechKey = "";
            stopSpeechPlayback();
            return;
        }
        JSONObject review = new JSONObject(encodedReview);
        if (!review.optBoolean("speechEnabled", false)) {
            lastReviewSpeechKey = "";
            stopSpeechPlayback();
            return;
        }

        JSONArray cards = review.optJSONArray("cards");
        if (cards == null) return;
        for (int index = 0; index < cards.length(); index += 1) {
            JSONObject card = cards.getJSONObject(index);
            reviewCards.add(new ReviewCard(
                card.optString("front", ""),
                card.optString("back", "")
            ));
        }
        reviewFrontDurationMs = Math.max(1000L, review.optLong("frontSeconds", 5L) * 1000L);
        reviewBaseBackDurationMs = Math.max(1000L, review.optLong("backSeconds", 5L) * 1000L);
        reviewBackSpeechRepeatCount = Math.max(
            1,
            Math.min(5, review.optInt("backSpeechRepeatCount", 1))
        );
        reviewBackDurationMs = reviewBaseBackDurationMs * reviewBackSpeechRepeatCount;
        String configuredCardSides = review.optString("cardSides", "both");
        reviewCardSides = "front".equals(configuredCardSides) || "back".equals(configuredCardSides)
            ? configuredCardSides
            : "both";
        reviewFrontLanguage = review.optString("frontLanguage", "").trim();
        reviewBackLanguage = review.optString("backLanguage", "").trim();
        reviewSpeechOverAmplified = review.optBoolean("overAmplified", false);
        if (!previousSessionId.equals(sessionId)) lastReviewSpeechKey = "";
        if (!currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())) pauseReviewSpeech();
    }

    private boolean currentStepAllowsFlashcardReview() {
        return !steps.isEmpty()
            && stepIndex >= 0
            && stepIndex < steps.size()
            && steps.get(stepIndex).flashcardReviewEnabled;
    }

    static long reviewWindowElapsedMs(long durationMs, long remainingMs) {
        long safeDurationMs = Math.max(0L, durationMs);
        long safeRemainingMs = Math.min(safeDurationMs, Math.max(0L, remainingMs));
        long reviewDurationMs = Math.max(0L, safeDurationMs - (REVIEW_EDGE_PAUSE_MS * 2L));
        return Math.min(
            reviewDurationMs,
            Math.max(0L, safeDurationMs - safeRemainingMs - REVIEW_EDGE_PAUSE_MS)
        );
    }

    static boolean reviewWindowIsActive(long durationMs, long remainingMs) {
        long safeDurationMs = Math.max(0L, durationMs);
        long safeRemainingMs = Math.min(safeDurationMs, Math.max(0L, remainingMs));
        long elapsedMs = safeDurationMs - safeRemainingMs;
        return elapsedMs >= REVIEW_EDGE_PAUSE_MS
            && safeRemainingMs > REVIEW_EDGE_PAUSE_MS;
    }

    private long currentStepRemainingMs(long now) {
        return Math.max(0L, deadlineElapsedMs - now);
    }

    private long currentStepReviewWindowElapsedMs(long now) {
        if (!currentStepAllowsFlashcardReview()) return 0L;
        IntervalStep step = steps.get(stepIndex);
        return reviewWindowElapsedMs(step.durationMs, currentStepRemainingMs(now));
    }

    private boolean currentStepPlaysFlashcardReview(long now) {
        if (!currentStepAllowsFlashcardReview()) return false;
        IntervalStep step = steps.get(stepIndex);
        return reviewWindowIsActive(step.durationMs, currentStepRemainingMs(now));
    }

    private void pauseReviewSpeech() {
        lastReviewSpeechKey = "";
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        stopSpeechPlayback();
    }

    private long currentReviewElapsedMs(long now) {
        return reviewBaseElapsedMs + Math.max(
            0L,
            currentStepReviewWindowElapsedMs(now) - reviewConfiguredWindowElapsedMs
        );
    }

    private void settleReviewClock(long now) {
        long currentWindowElapsedMs = currentStepReviewWindowElapsedMs(now);
        reviewBaseElapsedMs += Math.max(
            0L,
            currentWindowElapsedMs - reviewConfiguredWindowElapsedMs
        );
        reviewConfiguredWindowElapsedMs = currentWindowElapsedMs;
    }

    private ReviewPhase currentReviewPhase(long now) {
        if (reviewCards.isEmpty()) return null;
        boolean showsFront = !"back".equals(reviewCardSides);
        boolean showsBack = !"front".equals(reviewCardSides);
        long cardDurationMs = (showsFront ? reviewFrontDurationMs : 0L)
            + (showsBack ? reviewBackDurationMs : 0L);
        long elapsedMs = currentReviewElapsedMs(now);
        long absoluteCardIndex = elapsedMs / cardDurationMs;
        int cardIndex = (int) (absoluteCardIndex % reviewCards.size());
        long elapsedInCard = elapsedMs % cardDurationMs;
        String side = showsFront && elapsedInCard < reviewFrontDurationMs ? "front" : "back";
        long elapsedInBack = elapsedInCard - (showsFront ? reviewFrontDurationMs : 0L);
        int backSpeechRepeatIndex = "back".equals(side)
            ? Math.min(
                reviewBackSpeechRepeatCount - 1,
                (int) (elapsedInBack / reviewBaseBackDurationMs)
            )
            : 0;
        return new ReviewPhase(
            cardIndex,
            side,
            absoluteCardIndex + ":" + side + ":" + backSpeechRepeatIndex
        );
    }

    private void updateReviewSpeech(long now) {
        boolean appVisible = MainActivity.isAppVisible();
        if (!currentStepPlaysFlashcardReview(now)) {
            pauseReviewSpeech();
            appWasVisible = appVisible;
            return;
        }
        if (appVisible) {
            if (!appWasVisible) stopSpeechPlayback();
            lastReviewSpeechKey = "";
            pendingReviewSpeechText = "";
            pendingReviewSpeechLanguage = "";
        } else {
            speakCurrentReviewSide(now, appWasVisible);
        }
        appWasVisible = appVisible;
    }

    public static boolean handoffForegroundSpeech(String speechKey) {
        BackgroundIntervalService instance = activeInstance;
        return instance != null && instance.recordForegroundSpeech(speechKey);
    }

    private boolean recordForegroundSpeech(String speechKey) {
        String spokenKey = speechKey == null ? "" : speechKey.trim();
        long now = SystemClock.elapsedRealtime();
        if (spokenKey.isEmpty() || !currentStepPlaysFlashcardReview(now)) return false;
        ReviewPhase phase = currentReviewPhase(now);
        if (phase == null || !phase.key.equals(spokenKey)) return false;
        lastReviewSpeechKey = phase.key;
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        appWasVisible = false;
        return true;
    }

    private void speakCurrentReviewSide(long now, boolean force) {
        ReviewPhase phase = currentReviewPhase(now);
        if (phase == null || (!force && phase.key.equals(lastReviewSpeechKey))) return;
        ReviewCard card = reviewCards.get(phase.cardIndex);
        lastReviewSpeechKey = phase.key;
        pendingReviewSpeechText = "front".equals(phase.side) ? card.front : card.back;
        pendingReviewSpeechLanguage = "front".equals(phase.side)
            ? reviewFrontLanguage
            : reviewBackLanguage;
        speakPendingReviewSide();
    }

    private void speakPendingReviewSide() {
        if (
            !speechReady
            || speech == null
            || pendingReviewSpeechText.isEmpty()
            || pendingReviewSpeechLanguage.isEmpty()
            || MainActivity.isAppVisible()
            || !currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())
        ) return;
        int availability = speech.setLanguage(Locale.forLanguageTag(pendingReviewSpeechLanguage));
        if (
            availability == TextToSpeech.LANG_MISSING_DATA
            || availability == TextToSpeech.LANG_NOT_SUPPORTED
        ) return;
        String utteranceId = "polymind-background-interval-flashcard-" + System.nanoTime();
        int result = volumeBoost.speak(
            speech,
            pendingReviewSpeechText,
            utteranceId,
            reviewSpeechOverAmplified
        );
        if (result == TextToSpeech.ERROR) volumeBoost.finish(utteranceId);
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
    }

    private void stopSpeechPlayback() {
        if (speech != null) speech.stop();
        if (volumeBoost != null) volumeBoost.stop();
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
            settleReviewClock(deadlineElapsedMs);
            stepIndex += 1;
            if (stepIndex >= steps.size()) {
                finishTimer();
                return;
            }
            lastCountdownSecond = -1;
            if (!MainActivity.isAppVisible()) playStepCue();
            if (steps.get(stepIndex).requiresConfirmation) {
                deadlineElapsedMs = now;
                reviewConfiguredWindowElapsedMs = 0L;
                return;
            }
            deadlineElapsedMs += steps.get(stepIndex).durationMs;
            reviewConfiguredWindowElapsedMs = 0L;
        }
    }

    private void finishTimer() {
        if (!MainActivity.isAppVisible()) playCompleteCue();
        running = false;
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID + 1, buildNotification(true));
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopTimer() {
        running = false;
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
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
            IntervalCuePlayer.playCount(this);
        } else if (remainingSeconds > 3) {
            lastCountdownSecond = -1;
        }
    }

    private void playStepCue() {
        if (soundEnabled) IntervalCuePlayer.playSignal(this, steps.get(stepIndex).cueSound);
        if (vibrationEnabled) vibrate();
    }

    private void playCompleteCue() {
        if (soundEnabled) IntervalCuePlayer.playComplete(this);
        if (vibrationEnabled) vibrate();
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
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(
            new Uri.Builder()
                .scheme("polymind")
                .authority("interval")
                .appendQueryParameter(EXTRA_SESSION_ID, sessionId)
                .build()
        );
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
            "Polymind intervals",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps interval sessions and cue sounds running in the background.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "polymind:interval-timer");
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (activeInstance == this) activeInstance = null;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (volumeBoost != null) volumeBoost.stop();
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
