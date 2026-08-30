package com.financeme.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class FinanceNotificationListener extends NotificationListenerService {

    private static final String TAG = "FinanceNotifListener";
    private static final String API_URL = "https://finance-me-smoky-rho.vercel.app/api/ingest-notification";

    // Target financial & messaging package names
    private static final Set<String> TARGET_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nfc.phone",   // Google Pay
        "com.phonepe.app",                     // PhonePe
        "net.one97.paytm",                     // Paytm
        "com.google.android.apps.messaging",   // Android Messages / SMS
        "com.samsung.android.messaging",       // Samsung SMS
        "com.android.mms",                     // Stock SMS
        "com.hdfcbank.payzapp",                // HDFC PayZapp
        "com.sbi.upi",                         // BHIM SBI Pay
        "com.icicibank.imobile"                // ICICI iMobile
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String packageName = sbn.getPackageName();
        Notification notification = sbn.getNotification();

        if (notification == null || notification.extras == null) return;

        Bundle extras = notification.extras;
        CharSequence titleCharSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        String title = titleCharSeq != null ? titleCharSeq.toString() : "";
        
        CharSequence textCharSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String text = textCharSeq != null ? textCharSeq.toString() : "";

        CharSequence bigTextCharSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String bigText = bigTextCharSeq != null ? bigTextCharSeq.toString() : "";

        // Combine title, text, and bigText to get the complete multi-line SMS content
        StringBuilder sb = new StringBuilder();
        if (!title.isEmpty()) sb.append(title).append(" ");
        if (!text.isEmpty()) sb.append(text).append(" ");
        if (!bigText.isEmpty() && !bigText.equals(text)) sb.append(bigText);

        String fullContent = sb.toString().trim();
        if (fullContent.isEmpty()) return;

        // Package filtering: accept known financial packages, messaging apps, or notifications containing bank keywords
        boolean isTargetPkg = TARGET_PACKAGES.contains(packageName) || 
                              packageName.contains("messaging") || 
                              packageName.contains("sms") ||
                              packageName.contains("mms");
                              
        boolean hasFinancialKeywords = java.util.regex.Pattern.compile(
            "\\b(sent|debited|credited|paid|spent|hdfc|sbi|icici|axis|upi|a/c|rs|₹|inr)\\b",
            java.util.regex.Pattern.CASE_INSENSITIVE | java.util.regex.Pattern.DOTALL
        ).matcher(fullContent).find();

        if (!isTargetPkg && !hasFinancialKeywords) {
            return;
        }

        logEvent(this, "📩 Captured from [" + packageName + "]: " + fullContent);

        // Retrieve user_id stored by the web app session (if available)
        SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
        String userId = prefs.getString("user_id", "");

        if (userId == null || userId.isEmpty()) {
            logEvent(this, "⚠️ Warning: user_id is empty in SharedPreferences!");
        }

        // Asynchronously post to backend Vercel Ingestion API
        new Thread(() -> sendToIngestionApi(fullContent, packageName, userId)).start();
    }

    private void sendToIngestionApi(String rawText, String senderApp, String userId) {
        try {
            URL url = new URL(API_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; utf-8");
            conn.setRequestProperty("Accept", "application/json");
            if (userId != null && !userId.isEmpty()) {
                conn.setRequestProperty("X-USER-ID", userId);
            }
            conn.setDoOutput(true);

            org.json.JSONObject jsonPayload = new org.json.JSONObject();
            jsonPayload.put("rawText", rawText != null ? rawText : "");
            jsonPayload.put("sender", senderApp != null ? senderApp : "");
            jsonPayload.put("user_id", userId != null ? userId : "");

            byte[] input = jsonPayload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            Log.d(TAG, "Ingestion API HTTP Response: " + code);
            logEvent(this, "✅ Ingestion API Response: HTTP " + code);
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification to API: " + e.getMessage());
            logEvent(this, "❌ API Error: " + e.getMessage());
        }
    }

    public static void logEvent(Context ctx, String msg) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences("FinanceMeDebugLogs", Context.MODE_PRIVATE);
            String existing = prefs.getString("logs", "");
            java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault());
            String time = sdf.format(new java.util.Date());
            String newLine = "[" + time + "] " + msg;
            String updated = newLine + "\n" + existing;
            if (updated.length() > 3000) updated = updated.substring(0, 3000);
            prefs.edit().putString("logs", updated).apply();
        } catch (Exception ignored) {}
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // No action required on remove
    }
}
