package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;

/** Holds transient audio focus for an active Review set playback scope. */
final class ReviewSetAudioFocus {

    private final Context context;
    private TransientAudioFocus.Lease lease;

    ReviewSetAudioFocus(Context context) {
        this.context = context.getApplicationContext();
    }

    static AudioAttributes speechAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    static boolean shouldHold(boolean running, boolean playbackEnabled, boolean hasCards) {
        return running && playbackEnabled && hasCards;
    }

    void update(boolean running, boolean playbackEnabled, boolean hasCards) {
        if (shouldHold(running, playbackEnabled, hasCards)) {
            if (lease == null) {
                lease = TransientAudioFocus.acquireReviewSet(
                    context,
                    speechAudioAttributes()
                );
            }
            return;
        }
        release();
    }

    void release() {
        if (lease == null) return;
        lease.release();
        lease = null;
    }
}
