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
import android.net.Uri;
import android.os.PowerManager;
import android.database.ContentObserver;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_POST_NOTIFICATIONS = 101;
    private static final int REQUEST_READ_SMS = 1002;
    private static MainActivity instance;
    private static final java.util.concurrent.ConcurrentHashMap<String, Long> nativeRecentCaptures = new java.util.concurrent.ConcurrentHashMap<>();
    private WebView webView;
    private ContentObserver smsObserver;

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.clearCache(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, android.webkit.JsResult result) {
                result.confirm();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
                result.confirm();
                return true;
            }
        });

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

        // Load native assets for instant offline responsiveness & reliable background sync
        webView.loadUrl("file:///android_asset/index.html");

        // Step 1: Request POST_NOTIFICATIONS runtime permission (Android 13+)
        requestPostNotificationsPermission();

        // Step 2: Auto-check SMS permissions & register ContentObserver for 100% capture
        checkAndRequestSmsPermissions();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Step 3: Every time app comes to foreground, check if Notification Listener is enabled
        if (!isNotificationListenerEnabled()) {
            showNotificationListenerDialog();
        } else {
            tryRebindListenerService();
        }
        // Update JS with current status
        updateNotificationStatusInWebView();
        
        SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
        long lastSync = prefs.getLong("last_sync_timestamp", 0);
        updateLastSyncTimeInWebView(lastSync);

        // Step 4: Flush any notifications captured while phone was locked or app was closed
        flushPendingNotificationsToWebView();

        // Step 5: Catch-up on any SMS received while app was in background or closed
        registerSmsObserver();
        scanRecentSmsInternal(10);
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
            checkAndRequestSmsPermissions();
            // After POST_NOTIFICATIONS result, now check Notification Listener access
            if (!isNotificationListenerEnabled()) {
                showNotificationListenerDialog();
            }
        } else if (requestCode == REQUEST_READ_SMS) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                registerSmsObserver();
                scanRecentSmsInternal(20);
            } else {
                new AlertDialog.Builder(this)
                    .setTitle("SMS Permission Required")
                    .setMessage("Finance Me needs SMS permission to reconstruct your bank passbook & credit card statements.\n\nTap 'Open Settings' -> Permissions -> SMS -> Allow.")
                    .setPositiveButton("Open Settings", (d, w) -> {
                        try {
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
            }
            String js = "if(window.onSmsPermissionResult) window.onSmsPermissionResult(" + granted + ");";
            if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    /** Requests runtime SMS permissions if not already granted */
    private void checkAndRequestSmsPermissions() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{android.Manifest.permission.READ_SMS, android.Manifest.permission.RECEIVE_SMS},
                REQUEST_READ_SMS
            );
        } else {
            registerSmsObserver();
        }
    }

    /** Registers a real-time ContentObserver on the Android SMS provider */
    private void registerSmsObserver() {
        if (smsObserver != null) return;
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            smsObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
                @Override
                public void onChange(boolean selfChange, Uri uri) {
                    super.onChange(selfChange, uri);
                    scanRecentSmsInternal(5);
                }
            };
            getContentResolver().registerContentObserver(
                Uri.parse("content://sms"),
                true,
                smsObserver
            );
            android.util.Log.d("MainActivity", "Registered SMS ContentObserver successfully");
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Error registering SMS ContentObserver: " + e.getMessage());
        }
    }

    /** Scans recent SMS inbox messages to guarantee 100% payment capture */
    private void scanRecentSmsInternal(int limit) {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        new Thread(() -> {
            android.net.Uri uri = android.net.Uri.parse("content://sms/inbox");
            String[] projection = new String[]{"_id", "address", "body", "date"};
            android.database.Cursor cursor = null;
            try {
                SharedPreferences prefs = getSharedPreferences("FinanceMeSmsTracker", Context.MODE_PRIVATE);
                long lastScannedDate = prefs.getLong("last_scanned_sms_date", System.currentTimeMillis());
                String selection = "date > ?";
                String[] selectionArgs = new String[]{String.valueOf(lastScannedDate)};

                cursor = getContentResolver().query(uri, projection, selection, selectionArgs, "date ASC");
                if (cursor != null && cursor.moveToFirst()) {
                    int bodyIdx = cursor.getColumnIndex("body");
                    int addrIdx = cursor.getColumnIndex("address");
                    int dateIdx = cursor.getColumnIndex("date");

                    java.util.regex.Pattern financialPattern = java.util.regex.Pattern.compile(
                        "\\b(debited|credited|spent|paid|withdrawn|salary|refund|reversed|avl bal|avail bal|balance|statement|total due|min due|upi ref|a/c|rs\\.?|inr|₹|vpa|neft|imps|rtgs|hdfc|sbi|icici|axis|kotak)\\b",
                        java.util.regex.Pattern.CASE_INSENSITIVE
                    );

                    long newestDate = lastScannedDate;
                    do {
                        String body = bodyIdx != -1 ? cursor.getString(bodyIdx) : "";
                        String sender = addrIdx != -1 ? cursor.getString(addrIdx) : "";
                        long date = dateIdx != -1 ? cursor.getLong(dateIdx) : 0;

                        if (date > newestDate) {
                            newestDate = date;
                        }

                        if (body != null && financialPattern.matcher(body).find()) {
                            android.util.Log.d("MainActivity", "Realtime SMS detected from [" + sender + "]: " + body);
                            onNativeNotificationCaptured(body, sender, date > 0 ? date : System.currentTimeMillis());
                        }
                    } while (cursor.moveToNext());

                    prefs.edit().putLong("last_scanned_sms_date", newestDate).apply();
                }
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Error in scanRecentSmsInternal: " + e.getMessage());
            } finally {
                if (cursor != null) cursor.close();
            }
        }).start();
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

    /** Push last sync timestamp to WebView JS */
    public void updateLastSyncTimeInWebView(long timestamp) {
        String js = "if(window.onLastSyncUpdated) window.onLastSyncUpdated(" + timestamp + ");";
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    /** Pass real-time captured notification text directly into WebView JS */
    public void onNativeNotificationCaptured(String rawText, String packageName) {
        onNativeNotificationCaptured(rawText, packageName, System.currentTimeMillis());
    }

    public void onNativeNotificationCaptured(String rawText, String packageName, long timestamp) {
        if (rawText == null || rawText.trim().isEmpty()) return;

        // Native 5-minute atomic deduplication window
        String cleanSig = rawText.replaceAll("\\s+", " ").trim().toLowerCase();
        long now = System.currentTimeMillis();
        Long lastSeen = nativeRecentCaptures.get(cleanSig);
        if (lastSeen != null && (now - lastSeen) < (5 * 60 * 1000)) {
            android.util.Log.d("MainActivity", "🛡️ Suppressed duplicate capture at native layer: " + cleanSig);
            return;
        }
        nativeRecentCaptures.put(cleanSig, now);

        runOnUiThread(() -> {
            if (webView != null) {
                String safeText = org.json.JSONObject.quote(rawText != null ? rawText : "");
                String safePkg = org.json.JSONObject.quote(packageName != null ? packageName : "");
                long validTs = timestamp > 0 ? timestamp : System.currentTimeMillis();
                String js = "if(window.onNotificationCaptured) window.onNotificationCaptured(" + safeText + ", " + safePkg + ", " + validTs + ");";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    /** Flushes any notifications captured while app was in background or device was locked */
    public void flushPendingNotificationsToWebView() {
        runOnUiThread(() -> {
            if (webView == null) return;
            try {
                SharedPreferences queuePrefs = getSharedPreferences("FinanceMeCapturedQueue", Context.MODE_PRIVATE);
                String rawJson = queuePrefs.getString("pending_notifications", "[]");
                org.json.JSONArray array = new org.json.JSONArray(rawJson);
                if (array.length() == 0) return;

                android.util.Log.d("MainActivity", "Flushing " + array.length() + " pending notifications to WebView");
                for (int i = 0; i < array.length(); i++) {
                    org.json.JSONObject item = array.getJSONObject(i);
                    String rawText = item.optString("rawText", "");
                    String pkg = item.optString("packageName", "");
                    long ts = item.optLong("timestamp", System.currentTimeMillis());
                    if (!rawText.isEmpty()) {
                        String safeText = org.json.JSONObject.quote(rawText);
                        String safePkg = org.json.JSONObject.quote(pkg);
                        String js = "if(window.onNotificationCaptured) window.onNotificationCaptured(" + safeText + ", " + safePkg + ", " + ts + ");";
                        webView.evaluateJavascript(js, null);
                    }
                }
                queuePrefs.edit().putString("pending_notifications", "[]").apply();
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Error flushing pending notifications: " + e.getMessage());
            }
        });
    }

    // ── JavaScript Bridge ────────────────────────────────────────────────────

    public class AndroidBridge {

        /** Returns all pending notifications captured while app was closed or device was locked */
        @JavascriptInterface
        public String getPendingNotificationsJson() {
            SharedPreferences prefs = getSharedPreferences("FinanceMeCapturedQueue", Context.MODE_PRIVATE);
            String raw = prefs.getString("pending_notifications", "[]");
            prefs.edit().putString("pending_notifications", "[]").apply();
            return raw;
        }

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

        /** Checks if runtime READ_SMS permission is granted */
        @JavascriptInterface
        public boolean isSmsPermissionGranted() {
            return ContextCompat.checkSelfPermission(MainActivity.this, android.Manifest.permission.READ_SMS)
                    == PackageManager.PERMISSION_GRANTED;
        }

        /** Requests runtime READ_SMS permission */
        @JavascriptInterface
        public void requestSmsPermission() {
            runOnUiThread(() -> {
                if (isSmsPermissionGranted()) {
                    String js = "if(window.onSmsPermissionResult) window.onSmsPermissionResult(true);";
                    if (webView != null) webView.evaluateJavascript(js, null);
                    return;
                }
                ActivityCompat.requestPermissions(
                    MainActivity.this,
                    new String[]{android.Manifest.permission.READ_SMS, android.Manifest.permission.RECEIVE_SMS},
                    REQUEST_READ_SMS
                );
            });
        }

        /** Opens Android Application Details Settings screen to grant permissions manually */
        @JavascriptInterface
        public void openAppSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                android.util.Log.e("AndroidBridge", "Failed to open app settings: " + e.getMessage());
            }
        }

        /**
         * Scans existing SMS inbox messages (Axio/Walnut style)
         * Filters financial SMS, extracts body, sender, date
         * @param daysLimit number of past days to scan (0 for all time)
         * @return JSON string array of SMS objects
         */
        @JavascriptInterface
        public String scanInboxSms(int daysLimit) {
            if (!isSmsPermissionGranted()) {
                return "{\"error\":\"PERMISSION_DENIED\"}";
            }

            org.json.JSONArray array = new org.json.JSONArray();
            android.net.Uri uri = android.net.Uri.parse("content://sms/inbox");
            String[] projection = new String[]{"_id", "address", "body", "date"};

            String selection = null;
            String[] selectionArgs = null;

            if (daysLimit > 0) {
                long cutoff = System.currentTimeMillis() - ((long) daysLimit * 24 * 60 * 60 * 1000);
                selection = "date >= ?";
                selectionArgs = new String[]{String.valueOf(cutoff)};
            }

            android.database.Cursor cursor = null;
            try {
                cursor = getContentResolver().query(uri, projection, selection, selectionArgs, "date DESC");
                if (cursor != null && cursor.moveToFirst()) {
                    int bodyIdx = cursor.getColumnIndex("body");
                    int addrIdx = cursor.getColumnIndex("address");
                    int dateIdx = cursor.getColumnIndex("date");

                    int count = 0;
                    java.util.regex.Pattern financialPattern = java.util.regex.Pattern.compile(
                        "\\b(debited|credited|spent|paid|withdrawn|salary|refund|reversed|avl bal|avail bal|balance|statement|total due|min due|upi ref|a/c|rs\\.?|inr|₹|vpa|neft|imps|rtgs)\\b",
                        java.util.regex.Pattern.CASE_INSENSITIVE
                    );
                    java.util.regex.Pattern senderPattern = java.util.regex.Pattern.compile(
                        "(hdfc|sbi|icici|axis|kotak|pnb|bob|canara|union|idfc|indus|yes|rbl|amex|paytm|phonepe|gpay|cred)",
                        java.util.regex.Pattern.CASE_INSENSITIVE
                    );

                    do {
                        String body = bodyIdx != -1 ? cursor.getString(bodyIdx) : "";
                        String sender = addrIdx != -1 ? cursor.getString(addrIdx) : "";
                        long date = dateIdx != -1 ? cursor.getLong(dateIdx) : 0;

                        boolean match = false;
                        if (body != null && financialPattern.matcher(body).find()) {
                            match = true;
                        } else if (sender != null && senderPattern.matcher(sender).find()) {
                            match = true;
                        }

                        if (match && body != null) {
                            org.json.JSONObject obj = new org.json.JSONObject();
                            obj.put("body", body);
                            obj.put("sender", sender != null ? sender : "");
                            obj.put("date", date);
                            array.put(obj);
                            count++;
                            if (count >= 1000) break; // Safety cap
                        }
                    } while (cursor.moveToNext());
                }
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Error scanning SMS inbox: " + e.getMessage());
                return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
            } finally {
                if (cursor != null) cursor.close();
            }

            return array.toString();
        }

        /**
         * Asynchronously streams inbox SMS scan with real-time progress callbacks to WebView.
         */
        @JavascriptInterface
        public void startDeepSmsScanAsync(final int daysLimit) {
            if (!isSmsPermissionGranted()) {
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript("if(window.onSmsScanError) window.onSmsScanError('PERMISSION_DENIED');", null);
                });
                return;
            }

            new Thread(() -> {
                android.net.Uri uri = android.net.Uri.parse("content://sms/inbox");
                String[] projection = new String[]{"_id", "address", "body", "date"};
                String selection = null;
                String[] selectionArgs = null;

                if (daysLimit > 0) {
                    long cutoff = System.currentTimeMillis() - ((long) daysLimit * 24 * 60 * 60 * 1000);
                    selection = "date >= ?";
                    selectionArgs = new String[]{String.valueOf(cutoff)};
                }

                android.database.Cursor cursor = null;
                try {
                    cursor = getContentResolver().query(uri, projection, selection, selectionArgs, "date DESC");
                    if (cursor == null) {
                        runOnUiThread(() -> {
                            if (webView != null) webView.evaluateJavascript("if(window.onSmsScanComplete) window.onSmsScanComplete('[]');", null);
                        });
                        return;
                    }

                    final int total = cursor.getCount();
                    int bodyIdx = cursor.getColumnIndex("body");
                    int addrIdx = cursor.getColumnIndex("address");
                    int dateIdx = cursor.getColumnIndex("date");

                    org.json.JSONArray financialArray = new org.json.JSONArray();
                    int processed = 0;
                    int financialCount = 0;

                    java.util.regex.Pattern financialPattern = java.util.regex.Pattern.compile(
                        "\\b(debited|credited|spent|paid|withdrawn|salary|refund|reversed|avl bal|avail bal|balance|statement|total due|min due|upi ref|a/c|rs\\.?|inr|₹|vpa|neft|imps|rtgs)\\b",
                        java.util.regex.Pattern.CASE_INSENSITIVE
                    );
                    java.util.regex.Pattern senderPattern = java.util.regex.Pattern.compile(
                        "(hdfc|sbi|icici|axis|kotak|pnb|bob|canara|union|idfc|indus|yes|rbl|amex|paytm|phonepe|gpay|cred)",
                        java.util.regex.Pattern.CASE_INSENSITIVE
                    );

                    while (cursor.moveToNext()) {
                        processed++;
                        String body = bodyIdx != -1 ? cursor.getString(bodyIdx) : "";
                        String sender = addrIdx != -1 ? cursor.getString(addrIdx) : "";
                        long date = dateIdx != -1 ? cursor.getLong(dateIdx) : 0;

                        boolean isFinancial = false;
                        if (body != null && financialPattern.matcher(body).find()) {
                            isFinancial = true;
                        } else if (sender != null && senderPattern.matcher(sender).find()) {
                            isFinancial = true;
                        }

                        String snippet = "";
                        if (isFinancial && body != null) {
                            org.json.JSONObject obj = new org.json.JSONObject();
                            obj.put("body", body);
                            obj.put("sender", sender != null ? sender : "");
                            obj.put("date", date);
                            financialArray.put(obj);
                            financialCount++;
                            snippet = body.replaceAll("[\\r\\n]+", " ").trim();
                            if (snippet.length() > 50) snippet = snippet.substring(0, 50) + "...";
                        }

                        // Emit progress periodically or when financial SMS found
                        if (processed % 15 == 0 || processed == total || isFinancial) {
                            final int currentProcessed = processed;
                            final int currentTotal = total;
                            final int currentFound = financialCount;
                            final String currentSnippet = snippet.replace("'", "\\'").replace("\"", "\\\"");

                            runOnUiThread(() -> {
                                if (webView != null) {
                                    String js = String.format(
                                        java.util.Locale.US,
                                        "if(window.onSmsScanProgress) window.onSmsScanProgress(%d, %d, %d, '%s');",
                                        currentProcessed, currentTotal, currentFound, currentSnippet
                                    );
                                    webView.evaluateJavascript(js, null);
                                }
                            });
                        }

                        if (financialCount >= 1000) break; // Safety cap
                    }

                    // Complete!
                    final String resultJson = financialArray.toString();
                    runOnUiThread(() -> {
                        if (webView != null) {
                            webView.evaluateJavascript("window.__smsScanResult = " + resultJson + "; if(window.onSmsScanComplete) window.onSmsScanComplete(window.__smsScanResult);", null);
                        }
                    });

                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Error in async SMS scan: " + e.getMessage());
                    final String errMsg = e.getMessage() != null ? e.getMessage().replace("'", "\\'") : "Scan error";
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript("if(window.onSmsScanError) window.onSmsScanError('" + errMsg + "');", null);
                    });
                } finally {
                    if (cursor != null) cursor.close();
                }
            }).start();
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

        /** Returns last sync timestamp in milliseconds */
        @JavascriptInterface
        public long getLastSyncTimestamp() {
            SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
            return prefs.getLong("last_sync_timestamp", 0);
        }

        /** Returns count of pending offline notifications */
        @JavascriptInterface
        public int getOfflineQueueCount() {
            SharedPreferences queuePrefs = getSharedPreferences("FinanceMeOfflineQueue", Context.MODE_PRIVATE);
            String rawJson = queuePrefs.getString("queue", "[]");
            try {
                return new org.json.JSONArray(rawJson).length();
            } catch (Exception e) {
                return 0;
            }
        }

        /** Request ignoring battery optimizations so listener works in background / lock screen */
        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    String pkg = getPackageName();
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + pkg));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    }
                } catch (Exception e) {
                    android.util.Log.e("AndroidBridge", "Failed battery optimization request: " + e.getMessage());
                }
            }
        }

        /** Returns true if battery optimizations are ignored */
        @JavascriptInterface
        public boolean isBatteryOptimizationIgnored() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
            }
            return true;
        }

        /** Trigger manual flush of offline queue */
        @JavascriptInterface
        public void triggerManualSync() {
            SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
            String userId = prefs.getString("user_id", "");
            FinanceNotificationListener listener = new FinanceNotificationListener();
            new Thread(() -> listener.flushOfflineQueue(userId)).start();
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

        /** Saves CSV report file directly into native Android Downloads folder */
        @JavascriptInterface
        public void downloadCSV(String csvData, String filename) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    android.content.ContentValues values = new android.content.ContentValues();
                    values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename);
                    values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/csv");
                    values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);

                    android.net.Uri uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                        if (os != null) {
                            os.write(csvData.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            os.close();
                            runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this, "📥 CSV saved to Downloads folder!", android.widget.Toast.LENGTH_LONG).show());
                        }
                    }
                } else {
                    java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                    java.io.File file = new java.io.File(downloadsDir, filename);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
                    fos.write(csvData.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    fos.close();
                    runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this, "📥 CSV saved to Downloads folder!", android.widget.Toast.LENGTH_LONG).show());
                }
            } catch (Exception e) {
                android.util.Log.e("AndroidBridge", "Error saving CSV to downloads: " + e.getMessage());
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (smsObserver != null) {
            try {
                getContentResolver().unregisterContentObserver(smsObserver);
            } catch (Exception ignored) {}
            smsObserver = null;
        }
        super.onDestroy();
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
