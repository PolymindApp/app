package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;

/**
 * Holds transient audio focus while one or more app playback scopes are active. The shared lease
 * count prevents one scope from restoring another app's volume while another scope is still active.
 */
final class TransientAudioFocus {

    // Keep per-sound focus wired in while it remains disabled. Review set sessions explicitly own
    // focus for their active playback scope through acquireReviewSet().
    private static final boolean PER_SOUND_AUDIO_FOCUS_ENABLED = false;

    static final class Lease {
        private TransientAudioFocus owner;

        private Lease(TransientAudioFocus owner) {
            this.owner = owner;
        }

        void release() {
            TransientAudioFocus currentOwner;
            synchronized (this) {
                currentOwner = owner;
                owner = null;
            }
            if (currentOwner != null) currentOwner.releaseLease();
        }
    }

    private static volatile TransientAudioFocus instance;

    private final AudioManager audioManager;
    private final AudioManager.OnAudioFocusChangeListener focusChangeListener =
        this::handleAudioFocusChange;
    private AudioFocusRequest focusRequest;
    private int activeLeases;
    private boolean focusGranted;

    private TransientAudioFocus(Context context) {
        audioManager = context.getSystemService(AudioManager.class);
    }

    static Lease acquire(Context context, AudioAttributes audioAttributes) {
        if (!PER_SOUND_AUDIO_FOCUS_ENABLED) return new Lease(null);
        return get(context).acquireLease(audioAttributes);
    }

    static Lease acquireReviewSet(Context context, AudioAttributes audioAttributes) {
        return get(context).acquireLease(audioAttributes);
    }

    static void reapplyActiveFocusIfNecessary() {
        TransientAudioFocus focus = instance;
        if (focus != null) focus.reapplyFocusIfNecessary();
    }

    private static TransientAudioFocus get(Context context) {
        TransientAudioFocus focus = instance;
        if (focus != null) return focus;

        synchronized (TransientAudioFocus.class) {
            focus = instance;
            if (focus == null) {
                focus = new TransientAudioFocus(context.getApplicationContext());
                instance = focus;
            }
        }
        return focus;
    }

    private synchronized Lease acquireLease(AudioAttributes audioAttributes) {
        if (!focusGranted) {
            focusRequest = new AudioFocusRequest.Builder(
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
                .setAudioAttributes(audioAttributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build();
            focusGranted = audioManager != null
                && audioManager.requestAudioFocus(focusRequest)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        activeLeases += 1;
        return new Lease(this);
    }

    private synchronized void handleAudioFocusChange(int focusChange) {
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            focusGranted = activeLeases > 0;
            return;
        }

        if (
            focusChange == AudioManager.AUDIOFOCUS_LOSS
                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) {
            focusGranted = false;
        }
    }

    private synchronized void reapplyFocusIfNecessary() {
        if (activeLeases <= 0 || focusGranted || audioManager == null || focusRequest == null) return;
        focusGranted = audioManager.requestAudioFocus(focusRequest)
            == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private synchronized void releaseLease() {
        activeLeases = Math.max(0, activeLeases - 1);
        if (activeLeases > 0) return;
        if (audioManager != null && focusGranted && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        }
        focusRequest = null;
        focusGranted = false;
    }
}
