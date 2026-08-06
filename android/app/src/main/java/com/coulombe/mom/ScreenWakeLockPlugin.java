package dev.coulombe.mom;

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "ScreenWakeLock")
public class ScreenWakeLockPlugin extends Plugin {

    private final Set<String> holders = new HashSet<>();

    @PluginMethod
    public void acquire(PluginCall call) {
        String token = call.getString("token", "").trim();
        Activity activity = getActivity();
        if (token.isEmpty() || activity == null) {
            call.reject("A screen wake lock token and active screen are required.");
            return;
        }

        activity.runOnUiThread(() -> {
            holders.add(token);
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        String token = call.getString("token", "").trim();
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }

        activity.runOnUiThread(() -> {
            holders.remove(token);
            if (holders.isEmpty()) {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        Activity activity = getActivity();
        holders.clear();
        if (activity != null) {
            activity.runOnUiThread(() ->
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            );
        }
        super.handleOnDestroy();
    }
}
