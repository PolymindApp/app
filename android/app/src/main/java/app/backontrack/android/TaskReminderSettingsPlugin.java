package app.backontrack.android;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TaskReminderSettings")
public class TaskReminderSettingsPlugin extends Plugin {

    private static final String CHANNEL_ID = "task-reminders";
    @PluginMethod
    public void getStatus(PluginCall call) {
        NotificationManager manager = (NotificationManager) getContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? manager.getNotificationChannel(CHANNEL_ID)
            : null;
        JSObject result = new JSObject();
        result.put(
            "notificationsEnabled",
            NotificationManagerCompat.from(getContext()).areNotificationsEnabled()
        );
        result.put(
            "channelEnabled",
            channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE
        );
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        NotificationManager manager = (NotificationManager) getContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? manager.getNotificationChannel(CHANNEL_ID)
            : null;
        boolean channelBlocked = channel != null
            && channel.getImportance() == NotificationManager.IMPORTANCE_NONE;

        Intent intent = channelBlocked
            ? new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        if (channelBlocked) intent.putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
        openSettings(call, intent);
    }

    @ActivityCallback
    private void settingsResult(PluginCall call, ActivityResult result) {
        call.resolve();
    }

    private void openSettings(PluginCall call, Intent intent) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android settings screen is unavailable.");
            return;
        }

        try {
            startActivityForResult(call, intent, "settingsResult");
        } catch (ActivityNotFoundException exception) {
            call.reject("The Android settings screen is unavailable.", exception);
        }
    }
}
