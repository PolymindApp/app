package app.polymind.android;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

@CapacitorPlugin(name = "FlashcardSpeech")
public class FlashcardSpeechPlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_REQUEST = 9021;

    private final List<PluginCall> pendingLanguageCalls = new ArrayList<>();
    private PluginCall pendingSpeechCall;
    private TextToSpeech speech;
    private boolean speechReady;
    private boolean speechFailed;
    private boolean notificationPermissionRequested;
    private boolean overAmplificationEnabled;
    private TtsVolumeBoost volumeBoost;

    @Override
    public void load() {
        volumeBoost = new TtsVolumeBoost(getContext());
        speech = new TextToSpeech(getContext(), status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            speechFailed = !speechReady;
            if (speechReady) {
                speech.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
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
            }
            resolvePendingLanguageCalls();
            resolvePendingSpeechCall();
        });
    }

    @PluginMethod
    public void getLanguages(PluginCall call) {
        if (!speechReady && !speechFailed) {
            pendingLanguageCalls.add(call);
            return;
        }
        resolveLanguages(call);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        String language = call.getString("language", "").trim();
        if (text.isEmpty() || text.length() > 5000 || language.isEmpty() || language.length() > 35) {
            call.reject("Text and a valid language are required.");
            return;
        }
        if (!MainActivity.isAppVisible()) {
            call.resolve();
            return;
        }
        if (!speechReady && !speechFailed) {
            if (pendingSpeechCall != null) pendingSpeechCall.resolve();
            pendingSpeechCall = call;
            return;
        }
        if (!speechReady) {
            call.unavailable("Speech synthesis is not available on this device.");
            return;
        }

        speakReady(call);
    }

    private void speakReady(PluginCall call) {
        if (!MainActivity.isAppVisible()) {
            call.resolve();
            return;
        }
        String text = call.getString("text", "").trim();
        String language = call.getString("language", "").trim();

        int availability = speech.setLanguage(Locale.forLanguageTag(language));
        if (
            availability == TextToSpeech.LANG_MISSING_DATA
            || availability == TextToSpeech.LANG_NOT_SUPPORTED
        ) {
            call.unavailable("The selected speech language is not installed.");
            return;
        }
        overAmplificationEnabled = Boolean.TRUE.equals(call.getBoolean("overAmplified", false));
        String utteranceId = "polymind-flashcard-" + System.nanoTime();
        int result = volumeBoost.speak(
            speech,
            text,
            utteranceId,
            overAmplificationEnabled
        );
        if (result == TextToSpeech.ERROR) {
            volumeBoost.finish(utteranceId);
            call.reject("The card could not be spoken.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void setOverAmplification(PluginCall call) {
        overAmplificationEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        volumeBoost.setEnabled(overAmplificationEnabled);
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        stopForegroundSpeech();
        call.resolve();
    }

    private void stopForegroundSpeech() {
        if (pendingSpeechCall != null) {
            pendingSpeechCall.resolve();
            pendingSpeechCall = null;
        }
        if (speech != null) speech.stop();
        if (volumeBoost != null) volumeBoost.stop();
    }

    @PluginMethod
    public void startBackground(PluginCall call) {
        JSArray cards = call.getArray("cards");
        String sessionId = call.getString("sessionId", "").trim();
        if (cards == null || cards.length() == 0 || sessionId.isEmpty()) {
            call.reject("A flashcard review queue and session ID are required.");
            return;
        }

        getContext()
            .getSharedPreferences(BackgroundFlashcardService.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(BackgroundFlashcardService.KEY_CONFIG, call.getData().toString())
            .commit();

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && !notificationPermissionRequested
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionRequested = true;
            ActivityCompat.requestPermissions(
                getActivity(),
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST
            );
        }

        Intent intent = new Intent(getContext(), BackgroundFlashcardService.class);
        intent.setAction(BackgroundFlashcardService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void getBackgroundState(PluginCall call) {
        try {
            JSObject response = new JSObject();
            response.put("state", JSObject.fromJSONObject(
                BackgroundFlashcardService.currentState(getContext())
            ));
            call.resolve(response);
        } catch (JSONException error) {
            call.reject("The background review state is invalid.", error);
        }
    }

    @PluginMethod
    public void stopBackground(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundFlashcardService.class);
        getContext().stopService(intent);
        if (call.getBoolean("clearState", true)) {
            getContext()
                .getSharedPreferences(BackgroundFlashcardService.PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .remove(BackgroundFlashcardService.KEY_CONFIG)
                .remove(BackgroundFlashcardService.KEY_STATE)
                .apply();
        }
        call.resolve();
    }

    private void resolvePendingLanguageCalls() {
        for (PluginCall call : pendingLanguageCalls) resolveLanguages(call);
        pendingLanguageCalls.clear();
    }

    private void resolvePendingSpeechCall() {
        PluginCall call = pendingSpeechCall;
        pendingSpeechCall = null;
        if (call == null) return;
        if (speechReady) speakReady(call);
        else call.unavailable("Speech synthesis is not available on this device.");
    }

    private void resolveLanguages(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", speechReady);
        Set<String> tags = new TreeSet<>();
        if (speechReady) {
            Set<Locale> languages = speech.getAvailableLanguages();
            if (languages != null) {
                for (Locale locale : languages) {
                    String tag = locale.toLanguageTag();
                    if (!tag.isEmpty() && !"und".equals(tag)) tags.add(tag);
                }
            }
        }
        result.put("languages", new JSArray(tags));
        call.resolve(result);
    }

    @Override
    protected void handleOnPause() {
        // The background Review set service owns all speech after the Activity is hidden.
        // Cancel foreground synthesis and playback so the just-spoken face cannot restart
        // during the lifecycle handoff; the service will still speak subsequent faces.
        stopForegroundSpeech();
    }

    @Override
    protected void handleOnDestroy() {
        for (PluginCall call : pendingLanguageCalls) {
            call.unavailable("Speech synthesis stopped before languages were loaded.");
        }
        pendingLanguageCalls.clear();
        if (pendingSpeechCall != null) {
            pendingSpeechCall.unavailable("Speech synthesis stopped before playback started.");
            pendingSpeechCall = null;
        }
        if (volumeBoost != null) volumeBoost.stop();
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
    }
}
