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

        // Check if notification is from a target financial or SMS application
        if (!TARGET_PACKAGES.contains(packageName) && !packageName.contains("messaging") && !packageName.contains("sms")) {
            return;
        }

        Bundle extras = notification.extras;
        CharSequence titleCharSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        String title = titleCharSeq != null ? titleCharSeq.toString() : "";
        CharSequence textCharSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String text = textCharSeq != null ? textCharSeq.toString() : "";

        if (text.trim().isEmpty()) return;

        String fullContent = title + " " + text;
        Log.d(TAG, "Captured notification from " + packageName + ": " + fullContent);

        // Retrieve user_id stored by the web app session (if available)
        SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
        String userId = prefs.getString("user_id", "");

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

            // Escape special JSON characters cleanly
            String escapedText = rawText.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
            String jsonInputString = String.format(
                "{\"rawText\": \"%s\", \"sender\": \"%s\", \"user_id\": \"%s\"}",
                escapedText, senderApp, userId != null ? userId : ""
            );

            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            Log.d(TAG, "Ingestion API HTTP Response: " + code);
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification to API: " + e.getMessage());
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // No action required on remove
    }
}
