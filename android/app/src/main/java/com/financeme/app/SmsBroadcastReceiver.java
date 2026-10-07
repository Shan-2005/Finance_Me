package com.financeme.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

public class SmsBroadcastReceiver extends BroadcastReceiver {

    private static final String TAG = "FinanceSmsReceiver";
    private static final String API_URL = "https://n1ej1706me.execute-api.ap-south-1.amazonaws.com/api/ingest-notification";

    private static final Pattern FINANCIAL_PATTERN = Pattern.compile(
        "\\b(sent|debited|credited|paid|spent|withdrawn|refund|reversed|cashback|bill|due|statement|balance|bal|hdfc|sbi|icici|axis|kotak|upi|a/c|card|rs|₹|inr)\\b",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }

        try {
            SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (messages == null || messages.length == 0) return;

            StringBuilder bodyBuilder = new StringBuilder();
            String sender = "";
            long timestamp = System.currentTimeMillis();

            for (SmsMessage msg : messages) {
                if (msg != null) {
                    if (sender.isEmpty()) sender = msg.getDisplayOriginatingAddress();
                    bodyBuilder.append(msg.getDisplayMessageBody());
                    timestamp = msg.getTimestampMillis();
                }
            }

            String fullText = bodyBuilder.toString().trim();
            if (fullText.isEmpty()) return;

            Log.d(TAG, "Incoming SMS from [" + sender + "]: " + fullText);

            if (!FINANCIAL_PATTERN.matcher(fullText).find()) {
                return;
            }

            final String finalSender = sender;
            final long finalTimestamp = timestamp;

            // 1. Pass directly to MainActivity if alive with genuine SMS timestamp
            MainActivity main = MainActivity.getInstance();
            if (main != null) {
                main.onNativeNotificationCaptured(fullText, finalSender, finalTimestamp);
            } else {
                // If app is closed, dispatch to AWS Lambda in background thread
                new Thread(() -> dispatchToAws(fullText, finalSender, finalTimestamp)).start();
            }

        } catch (Exception e) {
            Log.e(TAG, "Error handling incoming SMS: " + e.getMessage(), e);
        }
    }

    private void dispatchToAws(String text, String sender, long timestamp) {
        HttpURLConnection conn = null;
        try {
            JSONObject payload = new JSONObject();
            payload.put("rawText", text);
            payload.put("packageName", "com.android.mms");
            payload.put("sender", sender);
            payload.put("timestamp", timestamp);

            URL url = new URL(API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("X-User-Id", "efe975a6-6460-4153-b715-2bb05ef1c171");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setDoOutput(true);

            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
                os.flush();
            }

            int responseCode = conn.getResponseCode();
            Log.d(TAG, "Dispatched SMS to AWS Lambda: code=" + responseCode);
        } catch (Exception err) {
            Log.w(TAG, "AWS SMS dispatch warning: " + err.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
