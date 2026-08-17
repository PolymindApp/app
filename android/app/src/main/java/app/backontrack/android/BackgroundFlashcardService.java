package app.backontrack.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
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

public class BackgroundFlashcardService extends Service {

    public static final String ACTION_START = "app.backontrack.android.flashcards.START";
    public static final String PREFERENCES = "backontrack_flashcard_speech";
    public static final String KEY_CONFIG = "background_config";
    public static final String KEY_STATE = "background_state";

    private static final String CHANNEL_ID = "backontrack_flashcard_review";
    private static final int NOTIFICATION_ID = 4207;
    private static final long TICK_MS = 200L;
    private static volatile BackgroundFlashcardService activeInstance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Card> cards = new ArrayList<>();
    private SharedPreferences preferences;
    private PowerManager.WakeLock wakeLock;
    private TextToSpeech speech;
    private TtsVolumeBoost volumeBoost;
    private FlashcardRecordingPlayer recordingPlayer;
    private boolean speechReady;
    private boolean speechOverAmplified;
    private boolean running;
    private boolean finished;
    private boolean indefinite;
    private String sessionId = "";
    private String sessionName = "Review";
    private String cardSides = "both";
    private String side = "front";
    private String frontLanguage = "";
    private String backLanguage = "";
    private long frontDurationMs = 5000L;
    private long baseBackDurationMs = 5000L;
    private long backDurationMs = 5000L;
    private int backSpeechRepeatCount = 1;
    private int lastBackSpeechRepeatIndex = -1;
    private long deadlineElapsedMs;
    private long configuredElapsedMs;
    private long baseElapsedMs;
    private int cardIndex;
    private int completedCards;
    private String pendingSpeechText = "";
    private String pendingSpeechLanguage = "";
    private String pendingRecordingUrl = "";
    private long lastNotificationSecond = -1L;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            // The foreground runner already spoke the current side. Preserve its remaining
            // duration during handoff and speak only when advance() reaches the next side.
            advance(now);
            if (!running) return;
            repeatBackSpeechWhenDue(now);
            long notificationSecond = Math.max(0L, deadlineElapsedMs - now) / 1000L;
            if (notificationSecond != lastNotificationSecond) {
                lastNotificationSecond = notificationSecond;
                persistState();
                updateNotification(false);
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    private static final class Card {
        final String front;
        final String back;
        final String frontAudio;
        final String backAudio;

        Card(String front, String back, String frontAudio, String backAudio) {
            this.front = front;
            this.back = back;
            this.frontAudio = frontAudio;
            this.backAudio = backAudio;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        createNotificationChannel();
        volumeBoost = new TtsVolumeBoost(this);
        recordingPlayer = new FlashcardRecordingPlayer(this);
        speech = new TextToSpeech(this, status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady) {
                speech.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                );
                speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
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
                speakPendingSide();
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;
        try {
            configure(new JSONObject(preferences.getString(KEY_CONFIG, "")));
            startAsForeground();
            acquireWakeLock();
            running = true;
            finished = false;
            handler.removeCallbacks(ticker);
            handler.post(ticker);
        } catch (JSONException | IllegalArgumentException error) {
            stopReview(false);
        }
        return START_NOT_STICKY;
    }

    private void configure(JSONObject config) throws JSONException {
        JSONArray encodedCards = config.getJSONArray("cards");
        cards.clear();
        for (int index = 0; index < encodedCards.length(); index += 1) {
            JSONObject encoded = encodedCards.getJSONObject(index);
            cards.add(new Card(
                encoded.optString("front", ""),
                encoded.optString("back", ""),
                encoded.optString("frontAudio", ""),
                encoded.optString("backAudio", "")
            ));
        }
        if (cards.isEmpty()) throw new IllegalArgumentException("The review queue is empty.");

        sessionId = config.optString("sessionId", "").trim();
        if (sessionId.isEmpty()) throw new IllegalArgumentException("A session ID is required.");
        sessionName = config.optString("sessionName", "Review").trim();
        if (sessionName.isEmpty()) sessionName = "Review";
        indefinite = config.optBoolean("indefinite", false);
        String configuredCardSides = config.optString("cardSides", "both");
        cardSides = "front".equals(configuredCardSides) || "back".equals(configuredCardSides)
            ? configuredCardSides
            : "both";
        side = "back".equals(config.optString("side")) ? "back" : "front";
        if (!"both".equals(cardSides)) side = cardSides;
        frontDurationMs = Math.max(1000L, config.optLong("frontSeconds", 5L) * 1000L);
        baseBackDurationMs = Math.max(1000L, config.optLong("backSeconds", 5L) * 1000L);
        backSpeechRepeatCount = Math.max(1, Math.min(5, config.optInt("backSpeechRepeatCount", 1)));
        backDurationMs = baseBackDurationMs * backSpeechRepeatCount;
        frontLanguage = config.optString("frontLanguage", "").trim();
        backLanguage = config.optString("backLanguage", "").trim();
        speechOverAmplified = config.optBoolean("overAmplified", false);
        baseElapsedMs = Math.max(0L, config.optLong("elapsedMs", 0L));
        configuredElapsedMs = SystemClock.elapsedRealtime();
        long remainingMs = Math.max(1L, config.optLong("remainingMs", 1L));
        deadlineElapsedMs = configuredElapsedMs + remainingMs;
        lastBackSpeechRepeatIndex = "back".equals(side)
            ? Math.min(
                backSpeechRepeatCount - 1,
                (int) (Math.max(0L, backDurationMs - remainingMs) / baseBackDurationMs)
            )
            : -1;
        cardIndex = 0;
        completedCards = 0;
        lastNotificationSecond = -1L;
        pendingSpeechText = "";
        pendingSpeechLanguage = "";
        pendingRecordingUrl = "";
        stopSpeechPlayback();
        persistState();
    }

    private void advance(long now) {
        while (running && now >= deadlineElapsedMs) {
            if ("front".equals(side) && "both".equals(cardSides)) {
                side = "back";
                deadlineElapsedMs += backDurationMs;
                lastBackSpeechRepeatIndex = 0;
                speakCurrentSide();
            } else {
                completedCards += 1;
                cardIndex += 1;
                if (cardIndex >= cards.size()) {
                    if (indefinite) {
                        cardIndex = 0;
                    } else {
                        finishReview();
                        return;
                    }
                }
                side = "back".equals(cardSides) ? "back" : "front";
                lastBackSpeechRepeatIndex = -1;
                deadlineElapsedMs += "back".equals(side) ? backDurationMs : frontDurationMs;
                if ("back".equals(side)) lastBackSpeechRepeatIndex = 0;
                speakCurrentSide();
            }
            persistState();
        }
    }

    private void repeatBackSpeechWhenDue(long now) {
        if (!"back".equals(side) || backSpeechRepeatCount <= 1) return;
        long backStartedAt = deadlineElapsedMs - backDurationMs;
        int repeatIndex = Math.min(
            backSpeechRepeatCount - 1,
            (int) (Math.max(0L, now - backStartedAt) / baseBackDurationMs)
        );
        if (repeatIndex <= lastBackSpeechRepeatIndex) return;
        lastBackSpeechRepeatIndex = repeatIndex;
        speakCurrentSide();
    }

    private void speakCurrentSide() {
        if (MainActivity.isAppVisible() || cardIndex >= cards.size()) return;
        stopSpeechPlayback();
        Card card = cards.get(cardIndex);
        pendingSpeechText = "front".equals(side) ? card.front : card.back;
        pendingSpeechLanguage = "front".equals(side) ? frontLanguage : backLanguage;
        pendingRecordingUrl = "front".equals(side) ? card.frontAudio : card.backAudio;
        speakPendingSide();
    }

    private void speakPendingSide() {
        if (
            MainActivity.isAppVisible()
            || (pendingRecordingUrl.isEmpty()
                && (pendingSpeechText.isEmpty() || pendingSpeechLanguage.isEmpty()))
        ) return;

        String recordingUrl = pendingRecordingUrl;
        String text = pendingSpeechText;
        String language = pendingSpeechLanguage;
        pendingRecordingUrl = "";
        if (!recordingUrl.isEmpty()) {
            pendingSpeechText = "";
            pendingSpeechLanguage = "";
            if (speech != null) speech.stop();
            if (volumeBoost != null) volumeBoost.stop();
            recordingPlayer.play(
                recordingUrl,
                () -> speakSynthesized(text, language),
                () -> running && !MainActivity.isAppVisible()
            );
            return;
        }
        speakSynthesized(text, language);
    }

    private void speakSynthesized(String text, String language) {
        if (!speechReady || speech == null) {
            pendingSpeechText = text;
            pendingSpeechLanguage = language;
            return;
        }
        if (text.isEmpty() || language.isEmpty() || MainActivity.isAppVisible()) return;
        pendingSpeechText = "";
        pendingSpeechLanguage = "";
        int availability = speech.setLanguage(Locale.forLanguageTag(language));
        if (
            availability == TextToSpeech.LANG_MISSING_DATA
            || availability == TextToSpeech.LANG_NOT_SUPPORTED
        ) return;
        String utteranceId = "backontrack-background-flashcard-" + System.nanoTime();
        int result = volumeBoost.speak(
            speech,
            text,
            utteranceId,
            speechOverAmplified
        );
        if (result == TextToSpeech.ERROR) volumeBoost.finish(utteranceId);
    }

    private void stopSpeechPlayback() {
        if (recordingPlayer != null) recordingPlayer.stop();
        if (speech != null) speech.stop();
        if (volumeBoost != null) volumeBoost.stop();
    }

    private void startAsForeground() {
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
        Notification notification = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void finishReview() {
        running = false;
        finished = true;
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        if (!MainActivity.isAppVisible()) IntervalCuePlayer.playComplete(this);
        persistState();
        releaseWakeLock();
        getSystemService(NotificationManager.class).notify(
            NOTIFICATION_ID + 1,
            buildNotification(true)
        );
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopReview(boolean clearState) {
        running = false;
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (clearState && preferences != null) {
            preferences.edit().remove(KEY_CONFIG).remove(KEY_STATE).apply();
        }
        stopSelf();
    }

    private JSONObject state() {
        JSONObject state = new JSONObject();
        long now = SystemClock.elapsedRealtime();
        try {
            state.put("sessionId", sessionId);
            state.put("running", running);
            state.put("finished", finished);
            state.put("completedCards", completedCards);
            state.put("side", side);
            state.put("remainingMs", running ? Math.max(0L, deadlineElapsedMs - now) : 0L);
            state.put("elapsedMs", baseElapsedMs + Math.max(0L, now - configuredElapsedMs));
        } catch (JSONException ignored) {
            // All values are JSON primitives.
        }
        return state;
    }

    private void persistState() {
        if (preferences != null) preferences.edit().putString(KEY_STATE, state().toString()).apply();
    }

    public static JSONObject currentState(Context context) throws JSONException {
        BackgroundFlashcardService instance = activeInstance;
        if (instance != null && !instance.sessionId.isEmpty()) return instance.state();
        String encoded = context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY_STATE, "");
        return encoded.isEmpty() ? new JSONObject() : new JSONObject(encoded);
    }

    private void updateNotification(boolean complete) {
        getSystemService(NotificationManager.class).notify(
            NOTIFICATION_ID,
            buildNotification(complete)
        );
    }

    private Notification buildNotification(boolean complete) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(
            new Uri.Builder()
                .scheme("backontrack")
                .authority("flashcards")
                .appendQueryParameter("sessionId", sessionId)
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
        if (complete || cardIndex >= cards.size()) {
            text = "Flashcard review complete";
        } else {
            long remainingMs = Math.max(0L, deadlineElapsedMs - SystemClock.elapsedRealtime());
            long seconds = (long) Math.ceil(remainingMs / 1000d);
            text = ("front".equals(side) ? "Front" : "Back")
                + " · " + seconds + "s · Card " + (cardIndex + 1) + " of " + cards.size();
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(!complete)
            .setAutoCancel(complete)
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
            "BackOnTrack flashcard reviews",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps passive flashcard speech and timing active in the background.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "backontrack:flashcard-review"
        );
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        running = false;
        activeInstance = null;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (recordingPlayer != null) recordingPlayer.stop();
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
