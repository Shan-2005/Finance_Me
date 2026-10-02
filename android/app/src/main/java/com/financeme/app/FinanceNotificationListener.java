package com.financeme.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.PowerManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class FinanceNotificationListener extends NotificationListenerService {

    private static final String TAG = "FinanceNotifListener";
    private static final String API_URL = "https://n1ej1706me.execute-api.ap-south-1.amazonaws.com/api/ingest-notification";
    private static final long DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minute duplicate suppression window

    // In-memory cache of recent signatures to instantly drop duplicate events
    private static final ConcurrentHashMap<String, Long> recentSignatures = new ConcurrentHashMap<>();

    // Target financial, banking, UPI & messaging package names in India and worldwide
    private static final Set<String> TARGET_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user", // Google Pay India (Tez)
        "com.google.android.apps.nfc.phone",      // Google Pay Global
        "com.phonepe.app",                        // PhonePe
        "net.one97.paytm",                        // Paytm
        "in.org.npci.upiapp",                     // BHIM UPI
        "com.dreamplug.androidapp",               // CRED
        "in.amazon.mShop.android.shopping",       // Amazon Pay
        "com.whatsapp",                           // WhatsApp Payments (UPI)
        "com.myairtelapp",                        // Airtel Thanks / Payments Bank
        "com.mobikwik_new",                       // MobiKwik
        "com.freecharge.android",                 // Freecharge
        "com.slicepay",                           // Slice
        "club.jupiter",                           // Jupiter
        "money.fi",                               // Fi Money
        "com.fampay.in",                          // FamPay
        "com.google.android.apps.messaging",      // Google Messages
        "com.samsung.android.messaging",          // Samsung SMS
        "com.android.mms",                        // Stock Android SMS
        "com.coloros.mms",                        // Realme / Oppo ColorOS SMS
        "com.oppo.mms",                           // Oppo SMS
        "com.oneplus.mms",                        // OnePlus SMS
        "com.miui.sms",                           // Xiaomi MIUI SMS
        "com.xiaomi.mms",                         // Xiaomi MMS
        "com.vivo.mms",                           // Vivo SMS
        "com.truecaller",                         // Truecaller SMS
        "com.hdfcbank.payzapp",                   // HDFC PayZapp
        "com.snapwork.hdfc",                      // HDFC Mobile Banking
        "com.sbi.upi",                            // BHIM SBI Pay
        "com.sbi.lotusintouch",                   // YONO SBI
        "com.icicibank.imobile",                  // ICICI iMobile
        "com.axis.mobile",                        // Axis Mobile
        "com.msf.kbank.mobile",                   // Kotak Bank
        "com.bankofbaroda.mconnect",              // bob World
        "com.canarabank.mobility",                // Canara ai1
        "com.unionbank.ecommerce.mobile.android"  // Union Bank Vyom
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String packageName = sbn.getPackageName();
        Notification notification = sbn.getNotification();
        if (notification == null || notification.extras == null) return;

        Bundle extras = notification.extras;
        CharSequence titleCharSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        String title = sanitizeString(titleCharSeq != null ? titleCharSeq.toString() : "");

        CharSequence textCharSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String text = sanitizeString(textCharSeq != null ? textCharSeq.toString() : "");

        CharSequence bigTextCharSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String bigText = sanitizeString(bigTextCharSeq != null ? bigTextCharSeq.toString() : "");

        CharSequence subTextCharSeq = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
        String subText = sanitizeString(subTextCharSeq != null ? subTextCharSeq.toString() : "");

        CharSequence summaryCharSeq = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT);
        String summaryText = sanitizeString(summaryCharSeq != null ? summaryCharSeq.toString() : "");

        // Combine title, text, bigText, subText to get complete SMS/Notification content
        StringBuilder sb = new StringBuilder();
        if (!title.isEmpty()) sb.append(title).append(" ");
        if (!subText.isEmpty()) sb.append(subText).append(" ");
        if (!text.isEmpty()) sb.append(text).append(" ");
        if (!bigText.isEmpty() && !bigText.equals(text)) sb.append(bigText).append(" ");
        if (!summaryText.isEmpty() && !summaryText.equals(title)) sb.append(summaryText).append(" ");

        // Also check InboxStyle bundled messages (e.g. from Google Messages)
        CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null && lines.length > 0) {
            for (CharSequence line : lines) {
                if (line != null) sb.append(sanitizeString(line.toString())).append(" ");
            }
        }

        String fullContent = sb.toString().replaceAll("\\s+", " ").trim();
        if (fullContent.length() < 5) return;

        // 1. Target Package & Keyword filtering
        boolean isTargetPkg = TARGET_PACKAGES.contains(packageName) ||
                              packageName.contains("messaging") ||
                              packageName.contains("sms") ||
                              packageName.contains("mms") ||
                              packageName.contains("bank") ||
                              packageName.contains("paisa") ||
                              packageName.contains("upi");

        boolean hasFinancialKeywords = Pattern.compile(
            "\\b(sent|debited|credited|paid|spent|withdrawn|refund|reversed|cashback|hdfc|sbi|icici|axis|kotak|upi|a/c|rs|₹|inr)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL
        ).matcher(fullContent).find();

        if (!isTargetPkg && !hasFinancialKeywords) {
            return;
        }

        // 2. Reject OTPs, Promos, Non-transactional notifications
        boolean isExplicitFinancial = Pattern.compile(
            "\\b(debited|credited|refunded|reversed|withdrawn|salary credited|spent rs|paid rs)\\b",
            Pattern.CASE_INSENSITIVE
        ).matcher(fullContent).find();

        boolean isNoise = Pattern.compile(
            "\\b(otp|one time password|verification code|secret code|pre-approved|apply now|flat \\d+% off|declined|insufficient funds|bill due|payment due)\\b",
            Pattern.CASE_INSENSITIVE
        ).matcher(fullContent).find();

        if (isNoise && !isExplicitFinancial) {
            return;
        }

        // 3. Multi-Factor Deduplication Check
        String signature = computeNotificationSignature(packageName, fullContent);
        if (isDuplicateSignature(signature)) {
            Log.d(TAG, "Duplicate notification suppressed: " + signature);
            logEvent(this, "🛡️ [Deduplicated]: Ignored repeat notification (" + signature.substring(0, Math.min(signature.length(), 16)) + ")");
            return;
        }

        logEvent(this, "📩 Captured from [" + packageName + "]: " + fullContent);

        // 4. Acquire WakeLock to guarantee background completion while phone is locked
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FinanceMe:NotifLock");
            wakeLock.acquire(15000); // 15 seconds max
        }

        final PowerManager.WakeLock finalLock = wakeLock;

        // 5. Always persist to local queue so notifications received while locked/closed are NEVER lost
        persistCapturedNotification(fullContent, packageName);

        // 6. Update local sync timestamp immediately
        updateLastSyncTimestamp();

        // 7. If MainActivity is alive, immediately flush and notify WebView!
        if (MainActivity.getInstance() != null) {
            MainActivity.getInstance().flushPendingNotificationsToWebView();
        }

        // 8. Ingest to cloud asynchronously
        SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
        String userId = prefs.getString("user_id", "");

        new Thread(() -> {
            try {
                sendToIngestionApi(fullContent, packageName, userId);
            } finally {
                if (finalLock != null && finalLock.isHeld()) {
                    try { finalLock.release(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    /** Cleans NBSP, zero-width spaces, and HTML entities */
    private String sanitizeString(String input) {
        if (input == null) return "";
        return input.replace("\u00A0", " ")
                    .replace("\u200B", "")
                    .replace("\u200C", "")
                    .replace("\u200D", "")
                    .replace("\uFEFF", "")
                    .replace("&amp;", "&")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .trim();
    }

    /** Stores notification in durable queue so it can be ingested when app opens */
    private synchronized void persistCapturedNotification(String rawText, String packageName) {
        try {
            SharedPreferences queuePrefs = getSharedPreferences("FinanceMeCapturedQueue", Context.MODE_PRIVATE);
            String rawJson = queuePrefs.getString("pending_notifications", "[]");
            JSONArray array = new JSONArray(rawJson);

            JSONObject item = new JSONObject();
            item.put("rawText", rawText);
            item.put("packageName", packageName);
            item.put("timestamp", System.currentTimeMillis());
            array.put(item);

            queuePrefs.edit().putString("pending_notifications", array.toString()).apply();
            Log.d(TAG, "Persisted notification to local queue. Total pending: " + array.length());
        } catch (Exception e) {
            Log.e(TAG, "Failed to persist captured notification: " + e.getMessage());
        }
    }

    /**
     * Computes a deterministic transaction fingerprint for deduplication.
     * If a reference number/UPI Ref is present, uses the reference number.
     * Otherwise, uses amount + normalized text hash.
     */
    private String computeNotificationSignature(String pkg, String content) {
        String clean = content.toLowerCase().replaceAll("[\\r\\n\\s]+", " ").trim();

        // 1. Try to extract UPI Reference / RRN (e.g. "UPI Ref 423456789012" or "Ref No 998811")
        Matcher refMatcher = Pattern.compile("\\b(?:upi\\s*ref(?:erence)?|rrn|txn\\s*id|ref\\s*no)\\s*[:.-]?\\s*([0-9a-zA-Z]{6,16})\\b", Pattern.CASE_INSENSITIVE).matcher(clean);
        if (refMatcher.find()) {
            return "ref_" + refMatcher.group(1).toLowerCase();
        }

        // 2. Extract monetary amount
        Matcher amtMatcher = Pattern.compile("(?:rs\\.?|inr|₹)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE).matcher(clean);
        String amt = "0";
        if (amtMatcher.find()) {
            amt = amtMatcher.group(1).replaceAll(",", "");
        }

        // 3. Hash the key semantic tokens + amount
        String seed = pkg + "_" + amt + "_" + clean.replaceAll("[^a-z0-9]", "");
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] hash = md.digest(seed.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return "hash_" + hexString.toString();
        } catch (Exception e) {
            return "fallback_" + Math.abs(seed.hashCode());
        }
    }

    private boolean isDuplicateSignature(String signature) {
        long now = System.currentTimeMillis();
        // Prune signatures older than DEDUP_WINDOW_MS
        recentSignatures.entrySet().removeIf(entry -> (now - entry.getValue()) > DEDUP_WINDOW_MS);

        if (recentSignatures.containsKey(signature)) {
            return true;
        }
        recentSignatures.put(signature, now);
        return false;
    }

    private void sendToIngestionApi(String rawText, String senderApp, String userId) {
        boolean sentSuccessfully = false;
        try {
            URL url = new URL(API_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            if (userId != null && !userId.isEmpty()) {
                conn.setRequestProperty("X-USER-ID", userId);
            }
            conn.setDoOutput(true);

            JSONObject jsonPayload = new JSONObject();
            jsonPayload.put("rawText", rawText != null ? rawText : "");
            jsonPayload.put("sender", senderApp != null ? senderApp : "");
            jsonPayload.put("user_id", userId != null ? userId : "");
            jsonPayload.put("timestamp", System.currentTimeMillis());

            byte[] input = jsonPayload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            Log.d(TAG, "Ingestion API Response: " + code);
            if (code >= 200 && code < 300) {
                sentSuccessfully = true;
                logEvent(this, "✅ Ingested to Cloud (HTTP " + code + ")");
                updateLastSyncTimestamp();
                flushOfflineQueue(userId);
            } else {
                logEvent(this, "⚠️ API Server returned HTTP " + code);
            }
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification to API: " + e.getMessage());
            logEvent(this, "❌ Offline or Network Error: " + e.getMessage());
        }

        // If delivery failed while phone was asleep/offline, store in persistent offline queue
        if (!sentSuccessfully) {
            enqueueOfflineNotification(rawText, senderApp, userId);
        }
    }

    private void updateLastSyncTimestamp() {
        long now = System.currentTimeMillis();
        SharedPreferences prefs = getSharedPreferences("FinanceMePrefs", Context.MODE_PRIVATE);
        prefs.edit().putLong("last_sync_timestamp", now).apply();
        if (MainActivity.getInstance() != null) {
            MainActivity.getInstance().updateLastSyncTimeInWebView(now);
        }
    }

    private synchronized void enqueueOfflineNotification(String rawText, String sender, String userId) {
        try {
            SharedPreferences queuePrefs = getSharedPreferences("FinanceMeOfflineQueue", Context.MODE_PRIVATE);
            String rawJson = queuePrefs.getString("queue", "[]");
            JSONArray queue = new JSONArray(rawJson);

            JSONObject item = new JSONObject();
            item.put("rawText", rawText);
            item.put("sender", sender);
            item.put("user_id", userId);
            item.put("timestamp", System.currentTimeMillis());
            queue.put(item);

            queuePrefs.edit().putString("queue", queue.toString()).apply();
            logEvent(this, "📦 Queued offline notification. Queue size: " + queue.length());
        } catch (Exception e) {
            Log.e(TAG, "Failed to enqueue offline notification: " + e.getMessage());
        }
    }

    public synchronized void flushOfflineQueue(String userId) {
        try {
            SharedPreferences queuePrefs = getSharedPreferences("FinanceMeOfflineQueue", Context.MODE_PRIVATE);
            String rawJson = queuePrefs.getString("queue", "[]");
            JSONArray queue = new JSONArray(rawJson);
            if (queue.length() == 0) return;

            logEvent(this, "🚀 Flushing " + queue.length() + " offline notifications to cloud...");
            JSONArray remaining = new JSONArray();

            for (int i = 0; i < queue.length(); i++) {
                JSONObject item = queue.getJSONObject(i);
                boolean success = false;
                try {
                    URL url = new URL(API_URL);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; utf-8");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setDoOutput(true);
                    byte[] input = item.toString().getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(input, 0, input.length);
                    }
                    if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                        success = true;
                    }
                    conn.disconnect();
                } catch (Exception ignored) {}

                if (!success) {
                    remaining.put(item);
                }
            }

            queuePrefs.edit().putString("queue", remaining.toString()).apply();
            if (remaining.length() == 0) {
                logEvent(this, "✅ All offline notifications successfully synced!");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error flushing queue: " + e.getMessage());
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
        // No action needed
    }
}
