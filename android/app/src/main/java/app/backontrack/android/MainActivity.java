package app.backontrack.android;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int APP_BACKGROUND = Color.rgb(16, 19, 16);
    private static volatile boolean appVisible = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundIntervalPlugin.class);
        registerPlugin(BackgroundSyncStagePlugin.class);
        registerPlugin(FlashcardSpeechPlugin.class);
        registerPlugin(ScreenWakeLockPlugin.class);
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(PasskeyPlugin.class);
        registerPlugin(TaskReminderSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        IntervalCuePlayer.preload(this);

        WindowCompat.enableEdgeToEdge(getWindow());
        getWindow().getDecorView().setBackgroundColor(APP_BACKGROUND);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(APP_BACKGROUND);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        updateSystemBarVisibility();

        if (getBridge() != null && getBridge().getWebView() != null) {
            View webView = getBridge().getWebView();
            webView.setBackgroundColor(APP_BACKGROUND);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        appVisible = true;
        updateSystemBarVisibility();
    }

    @Override
    public void onPause() {
        appVisible = false;
        super.onPause();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateSystemBarVisibility();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) updateSystemBarVisibility();
    }

    private void updateSystemBarVisibility() {
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decorView);
        boolean isLandscape = getResources().getConfiguration().orientation
            == Configuration.ORIENTATION_LANDSCAPE;

        if (isLandscape) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            return;
        }

        controller.show(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
    }

    public static boolean isAppVisible() {
        return appVisible;
    }
}
