package com.financeme.app;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("https://finance-me-smoky-rho.vercel.app");

        // Ask for notification access on first launch
        if (!isNotificationListenerEnabled()) {
            showNotificationPermissionDialog();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-check every time app comes to foreground
        if (!isNotificationListenerEnabled()) {
            showNotificationPermissionDialog();
        }
    }

    private boolean isNotificationListenerEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(),
                "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            String[] components = flat.split(":");
            for (String c : components) {
                ComponentName cn = ComponentName.unflattenFromString(c);
                if (cn != null && getPackageName().equals(cn.getPackageName())) {
                    return true;
                }
            }
        }
        return false;
    }

    private void showNotificationPermissionDialog() {
        new AlertDialog.Builder(this)
            .setTitle("Enable Notification Access")
            .setMessage("Finance Me needs Notification Access to automatically read your bank transaction alerts and save them to your account.\n\nTap 'Allow' and enable Finance Me in the list.")
            .setPositiveButton("Allow", (dialog, which) -> {
                Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                startActivity(intent);
            })
            .setNegativeButton("Later", null)
            .setCancelable(false)
            .show();
    }

    public class AndroidBridge {

        /** Called by the web app after Supabase login — saves user_id for the notification listener */
        @JavascriptInterface
        public void saveUserId(String userId) {
            if (userId == null || userId.isEmpty()) return;
            SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
            prefs.edit().putString("user_id", userId).apply();
            android.util.Log.d("AndroidBridge", "Saved user_id: " + userId);
        }

        /** Called by the web app on logout — clears the stored user_id */
        @JavascriptInterface
        public void clearUserId() {
            SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
            prefs.edit().remove("user_id").apply();
        }

        /** Opens Android Notification Listener settings screen */
        @JavascriptInterface
        public void openNotificationSettings() {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        }

        /** Returns whether notification access is granted — readable from JS */
        @JavascriptInterface
        public boolean isNotificationAccessGranted() {
            return isNotificationListenerEnabled();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
