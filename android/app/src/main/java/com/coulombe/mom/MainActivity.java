package dev.coulombe.mom;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int APP_BACKGROUND = Color.rgb(16, 19, 16);
    private static volatile boolean appVisible = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundIntervalPlugin.class);
        registerPlugin(PasskeyPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.enableEdgeToEdge(getWindow());
        getWindow().getDecorView().setBackgroundColor(APP_BACKGROUND);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(APP_BACKGROUND);
            getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        appVisible = true;
    }

    @Override
    public void onPause() {
        appVisible = false;
        super.onPause();
    }

    public static boolean isAppVisible() {
        return appVisible;
    }
}
