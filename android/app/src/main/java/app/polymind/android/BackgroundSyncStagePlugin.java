package app.polymind.android;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundSyncStage")
public class BackgroundSyncStagePlugin extends Plugin {

    private static final String PREFERENCES_NAME = "app.polymind.sync";
    private static final String STAGED_SYNC_KEY = "polymind.background-sync";

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value");
        if (value == null) {
            call.reject("A background sync value is required.");
            return;
        }

        preferences().edit().putString(STAGED_SYNC_KEY, value).apply();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        preferences().edit().remove(STAGED_SYNC_KEY).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }
}
