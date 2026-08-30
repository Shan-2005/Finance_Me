package com.financeme.app;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_POST_NOTIFICATIONS = 101;
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
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.contains("github.com") || url.endsWith(".apk"))) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        android.util.Log.e("MainActivity", "Failed to open link externally: " + e.getMessage());
                    }
                }
                return false;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to handle download: " + e.getMessage());
            }
        });

        webView.loadUrl("https://finance-me-smoky-rho.vercel.app");

        // Step 1: Request POST_NOTIFICATIONS runtime permission (Android 13+)
        requestPostNotificationsPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Step 2: Every time app comes to foreground, check if Notification Listener is enabled
        if (!isNotificationListenerEnabled()) {
            showNotificationListenerDialog();
        } else {
            tryRebindListenerService();
        }
        // Update JS with current status
        updateNotificationStatusInWebView();
    }

    private void tryRebindListenerService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                ComponentName componentName = new ComponentName(this, FinanceNotificationListener.class);
                FinanceNotificationListener.requestRebind(componentName);
                android.util.Log.d("MainActivity", "Requested rebind for FinanceNotificationListener");
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to rebind listener: " + e.getMessage());
            }
        }
    }

    /** Request the standard Android 13+ POST_NOTIFICATIONS runtime permission */
    private void requestPostNotificationsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                    REQUEST_POST_NOTIFICATIONS
                );
            } else {
                // Already granted — now check Notification Listener
                if (!isNotificationListenerEnabled()) {
                    showNotificationListenerDialog();
                }
            }
        } else {
            // Android < 13: no runtime permission needed, go straight to listener check
            if (!isNotificationListenerEnabled()) {
                showNotificationListenerDialog();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            // After POST_NOTIFICATIONS result, now check Notification Listener access
            if (!isNotificationListenerEnabled()) {
                showNotificationListenerDialog();
            }
        }
    }

    /** Check if Finance Me is in the Notification Listener whitelist */
    private boolean isNotificationListenerEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            for (String c : flat.split(":")) {
                ComponentName cn = ComponentName.unflattenFromString(c);
                if (cn != null && getPackageName().equals(cn.getPackageName())) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Show dialog explaining why we need Notification Listener, then open system settings */
    private void showNotificationListenerDialog() {
        new AlertDialog.Builder(this)
            .setTitle("Allow Notification Access")
            .setMessage("Finance Me reads your bank & payment app notifications to automatically track transactions.\n\nTap 'Open Settings', then find Finance Me in the list and turn it ON.")
            .setPositiveButton("Open Settings", (dialog, which) -> {
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
            })
            .setNegativeButton("Skip for now", null)
            .setCancelable(true)
            .show();
    }

    /** Push notification access status into the WebView JS context */
    private void updateNotificationStatusInWebView() {
        boolean granted = isNotificationListenerEnabled();
        String js = "if(window.onAndroidNotifStatus) window.onAndroidNotifStatus(" + granted + ");";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    // ── JavaScript Bridge ────────────────────────────────────────────────────

    public class AndroidBridge {

        /** Called by web app after Supabase login — saves user_id for the notification listener */
        @JavascriptInterface
        public void saveUserId(String userId) {
            if (userId == null || userId.isEmpty()) return;
            SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
            prefs.edit().putString("user_id", userId).apply();
            android.util.Log.d("AndroidBridge", "Saved user_id: " + userId);
        }

        /** Called by web app on logout */
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

        /** Returns true if notification listener access is granted */
        @JavascriptInterface
        public boolean isNotificationAccessGranted() {
            return isNotificationListenerEnabled();
        }

        /** Returns live background notification debug logs for display on UI */
        @JavascriptInterface
        public String getDebugLogs() {
            SharedPreferences prefs = getSharedPreferences("FinanceMeDebugLogs", Context.MODE_PRIVATE);
            return prefs.getString("logs", "No notifications captured yet.");
        }

        /** Clears debug logs */
        @JavascriptInterface
        public void clearDebugLogs() {
            SharedPreferences prefs = getSharedPreferences("FinanceMeDebugLogs", Context.MODE_PRIVATE);
            prefs.edit().remove("logs").apply();
        }

        /** Opens external download URL for app update */
        @JavascriptInterface
        public void openDownloadUrl(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                android.util.Log.e("AndroidBridge", "Failed to open download url: " + e.getMessage());
            }
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
