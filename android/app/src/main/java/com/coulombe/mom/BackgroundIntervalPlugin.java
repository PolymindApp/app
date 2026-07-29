package com.coulombe.mom;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundInterval")
public class BackgroundIntervalPlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_REQUEST = 9017;

    @PluginMethod
    public void start(PluginCall call) {
        JSArray steps = call.getArray("steps");
        String sessionId = call.getString("sessionId", "");
        String sessionName = call.getString("sessionName", "Interval");
        Integer stepIndex = call.getInt("stepIndex", 0);
        Double remainingMs = call.getDouble("remainingMs", 1d);
        Boolean soundEnabled = call.getBoolean("soundEnabled", true);
        Boolean vibrationEnabled = call.getBoolean("vibrationEnabled", true);

        if (steps == null || steps.length() == 0) {
            call.reject("An interval sequence is required.");
            return;
        }

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                getActivity(),
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST
            );
        }

        Intent intent = new Intent(getContext(), BackgroundIntervalService.class);
        intent.setAction(BackgroundIntervalService.ACTION_START);
        intent.putExtra(BackgroundIntervalService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(BackgroundIntervalService.EXTRA_SESSION_NAME, sessionName);
        intent.putExtra(BackgroundIntervalService.EXTRA_STEPS, steps.toString());
        intent.putExtra(BackgroundIntervalService.EXTRA_STEP_INDEX, stepIndex == null ? 0 : stepIndex);
        intent.putExtra(BackgroundIntervalService.EXTRA_REMAINING_MS, remainingMs == null ? 1L : Math.max(1L, remainingMs.longValue()));
        intent.putExtra(BackgroundIntervalService.EXTRA_SOUND_ENABLED, soundEnabled == null || soundEnabled);
        intent.putExtra(BackgroundIntervalService.EXTRA_VIBRATION_ENABLED, vibrationEnabled == null || vibrationEnabled);

        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundIntervalService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
