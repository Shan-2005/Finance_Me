// Vercel Serverless Function with Ultra-Forgiving RegEx Ingestion & Supabase Storage
// Endpoint: POST/GET https://finance-me-smoky-rho.vercel.app/api/ingest-notification

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let rawText = '';

    // Universal Payload Parser - Extract text from EVERY possible format MacroDroid can send
    // 1. Check URL Query Parameters FIRST (e.g. ?sms=[sms_body] from MacroDroid)
    if (req.query) {
      rawText = req.query.sms || req.query.rawText || req.query.text || req.query.message || req.query.body || '';
    }

    // 2. If query parameter is empty, check HTTP Body (POST body)
    if (!rawText || rawText.trim().length < 3) {
      if (typeof req.body === 'string' && req.body.trim().length > 0) {
        rawText = req.body;
      } else if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        rawText = req.body.rawText || req.body.notificationText || req.body.text || req.body.message ||
                  req.body.sms_body || req.body.sms_message || req.body.body || req.body.sms ||
                  req.body.content || req.body.data || '';
        if (!rawText) {
          const vals = Object.values(req.body).filter(v => typeof v === 'string' && v.trim().length > 3);
          if (vals.length > 0) rawText = vals.join(' ');
        }
      }
    }

    // 3. Sanitizer: If rawText is an unparsed JSON string like {"sms": "..."}, extract the string content
    if (typeof rawText === 'string' && (rawText.trim().startsWith('{') || rawText.includes('"sms":') || rawText.includes('"text":'))) {
      const jsonMatch = rawText.match(/"(?:sms|text|message|sms_body|rawText|content)"\s*:\s*"([\s\S]*?)"(?:\s*\}|\s*,)/i);
      if (jsonMatch && jsonMatch[1]) {
        rawText = jsonMatch[1];
      } else {
        rawText = rawText.replace(/^\s*\{\s*"(?:sms|text|message)"\s*:\s*"?/i, '').replace(/["\}]*\s*$/g, '');
      }
    }

    // Check for un-expanded MacroDroid placeholder variables (e.g. "[sms_body]", "{sms_body}", "[not_text]")
    const isPlaceholder = /^[\{\[\(]\s*(sms_body|sms_message|not_text|notification_text|sms_number|not_title)\s*[\}\]\)]$/i.test(rawText.trim()) ||
                          /^(?:\[|\{)?sms_body(?:\]|\})?$/i.test(rawText.trim()) ||
                          /^(?:\[|\{)?not_text(?:\]|\})?$/i.test(rawText.trim());

    // If STILL empty or contains unexpanded placeholder - reject silently (don't create junk ₹0 entries)
    if (isPlaceholder || !rawText || rawText.trim().length < 3) {
      console.warn('[INGEST DEBUG] MacroDroid placeholder variable or empty body received:', rawText);
      return res.status(200).json({ 
        success: false, 
        error: 'MACRODROID_UNEXPANDED_VARIABLE - MacroDroid sent the variable name literally instead of actual SMS/notification text.',
        tip: 'In MacroDroid HTTP GET configuration, click the Magic Text button (...) to select "SMS Body" or "Notification Text".'
      });
    }

    // Clean multiline newlines into single spaces for robust regex matching
    const cleanText = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Pass 1: ₹/Rs/Rs./INR prefix directly before number (e.g. "Rs.1.00", "Rs 1.00", "₹500")
    const rsPrefixRegex = /(?:₹|rs\.?|re\.?|rupee|rupees|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
    // Pass 2: number followed by currency suffix (e.g. "450 rs", "450rs", "450 rupees", "450 INR")
    const rsSuffixRegex = /([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|re\.?|rupee|rupees|inr)\b/i;
    // Pass 3: number BEFORE debit/credit keyword (e.g. "1.00 sent", "500 debited")
    const beforeKwRegex = /([\d,]+(?:\.\d{1,2})?)\s+(?:debited|credited|sent|paid|spent|deducted)/i;
    // Pass 4: number AFTER keyword (e.g. "sent Rs.1.00", "paid 450", "paid 500")
    const afterKwRegex = /(?:debited|credited|paid|sent|spent|transferred|amount|sum)\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i;

    let amount = 0;
    let amtM;
    if ((amtM = cleanText.match(rsPrefixRegex)))   amount = parseFloat(amtM[1].replace(/,/g, ''));
    if (!amount && (amtM = cleanText.match(rsSuffixRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
    if (!amount && (amtM = cleanText.match(beforeKwRegex))) amount = parseFloat(amtM[1].replace(/,/g, ''));
    if (!amount && (amtM = cleanText.match(afterKwRegex)))  amount = parseFloat(amtM[1].replace(/,/g, ''));

    // Pass 4: smart fallback — strip 9+ digit ref/account/phone numbers & dates, then grab first decimal
    if (!amount || amount === 0) {
      const stripped = cleanText
        .replace(/\b\d{9,}\b/g, '')
        .replace(/\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b/g, '');
      const numMatch = stripped.match(/(\d{1,7}(?:,\d{2,3})*(?:\.\d{1,2})?)/);
      if (numMatch) amount = parseFloat(numMatch[1].replace(/,/g, ''));
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      console.warn('[INGEST DEBUG] No valid transaction amount found in text:', cleanText);
      return res.status(200).json({
        success: false,
        error: 'NO_TRANSACTION_AMOUNT_FOUND',
        message: 'Could not extract a valid non-zero transaction amount from the provided text.',
        receivedText: cleanText
      });
    }

    // --- CREDIT vs DEBIT DETECTION ---
    const isDebitText = /\bsent\b|\bdebited\b|\bspent\b|\bpaid\b|\bwithdrawn\b/i.test(cleanText);
    const isCreditText = /credit alert|credited|received rs|received inr|received ₹|\bcredited to\b|\breceived\b/i.test(cleanText);
    
    let type = 'Debit';
    if (isDebitText) type = 'Debit';
    else if (isCreditText) type = 'Credit';
    const isCredit = type === 'Credit';

    // --- MERCHANT / SENDER EXTRACTION (multi-pass) ---
    let merchant = 'UPI Transfer';

    if (!isCredit) {
      // P1: "To <Merchant>" followed by On / Ref / Not / A/C / line end (e.g., "To SOPHY ROSE JOSEPHINA On 27/08/26")
      const p1 = cleanText.match(/\bTo\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+On\b|\s+on\b|\s+Ref\b|\s+ref\b|\s+Not\b|\s+not\b|\s+A\/C\b|\.|$)/i);
      // P2: "to <merchant> via" — stops before "via"
      const p2 = cleanText.match(/\bto\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,35}?)\s+via\b/i);
      // P3: "towards <merchant>"
      const p3 = cleanText.match(/\btowards\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+via|\s+on|\s+ref|\.|$)/i);
      // P4: "at <merchant>"
      const p4 = cleanText.match(/\bat\s+([A-Za-z][A-Za-z0-9\s&.\-]{1,35}?)(?=\s+on|\s+via|\s+ref|\.|$)/i);

      const BANK_ONLY = /^(hdfc|sbi|icici|axis|kotak|paytm|phonepe|npci|bank|a\/c|account)$/i;

      for (const m of [p1, p2, p3, p4]) {
        if (m) {
          const candidate = m[1].trim();
          if (!BANK_ONLY.test(candidate) && !/^\d+$/.test(candidate)) {
            merchant = candidate;
            break;
          }
        }
      }
    } else {
      const fromMatch = cleanText.match(/\bfrom\s+(?:VPA\s+)?([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+\(UPI|\s+Ref\b|\s+on\b|\.|$)/i);
      if (fromMatch) {
        let sender = fromMatch[1].trim();
        if (sender.includes('@')) sender = sender.split('@')[0].replace(/\d+$/, '');
        if (!/^(hdfc|sbi|icici|axis|kotak|bank|npci|system)$/i.test(sender)) {
          merchant = sender;
        }
      }
    }

    merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 36).trim();

    // --- CATEGORY ---
    let category = 'Unwanted / Leak';
    if (isCredit) {
      category = 'Income';
    } else if (/sip|mutual|zerodha|groww|invest|stocks|gold|nps/i.test(cleanText + merchant)) {
      category = 'Investments';
    } else if (/rent|loan|emi|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(cleanText + merchant)) {
      category = 'Unavoidable / Rent';
    }

    // --- MODE ---
    let mode = 'GPay / UPI Auto-Sync';
    if (/credit card|card ending/i.test(cleanText)) mode = 'Credit Card';
    else if (/netbank|neft|rtgs|imps/i.test(cleanText)) mode = 'Net Banking';

    // --- TIMESTAMP (IST = UTC+5:30) ---
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + (5.5 * 60 * 60 * 1000));
    const dateIST = nowIST.toISOString().split('T')[0];
    const hh = String(nowIST.getUTCHours()).padStart(2, '0');
    const mm = String(nowIST.getUTCMinutes()).padStart(2, '0');
    const ss = String(nowIST.getUTCSeconds()).padStart(2, '0');
    const ampm = nowIST.getUTCHours() < 12 ? 'AM' : 'PM';
    const h12 = nowIST.getUTCHours() % 12 || 12;
    const timeIST = `${String(h12).padStart(2,'0')}:${mm}:${ss} ${ampm}`;

    // --- MERCHANT & NOTES SANITIZATION ---
    if (merchant.toLowerCase().startsWith('hdfc') || merchant.toLowerCase().startsWith('sbi') || merchant.toLowerCase().startsWith('icici') || merchant.toLowerCase().startsWith('axis')) {
      if (isCredit) {
        if (/salary/i.test(cleanText)) merchant = 'Salary Credit';
        else merchant = `${merchant} Deposit`;
      } else {
        merchant = `${merchant} Bank Transfer`;
      }
    }

    // Capitalize words nicely
    merchant = merchant.replace(/\b\w/g, l => l.toUpperCase());

    const crypto = require('crypto');
    const generateUuid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : 'f' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9));

    // --- MULTI-TENANT USER ID EXTRACTION ---
    const userId = req.headers['x-user-id'] || 
                   (req.query && (req.query.user_id || req.query.uid)) || 
                   (req.body && typeof req.body === 'object' && (req.body.user_id || req.body.uid)) || 
                   null;

    const parsedTransaction = {
      id: generateUuid(),
      merchant: merchant || (isCredit ? 'Received Payment' : 'UPI Transfer'),
      amount: amount,
      type,
      category,
      mode,
      date: nowIST.toISOString(),
      tags: ['#auto-ingested'],
      notes: `Auto-captured via ${mode}`,
      raw_text: rawText
    };

    if (userId) {
      parsedTransaction.user_id = userId;
    }

    // Supabase REST API Persistence
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qtejgfhuzquifcobdvfo.supabase.co';
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const authHeader = req.headers['authorization'] || `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

    // --- BUG-09: DUPLICATE GUARD ---
    // MacroDroid can retry the same SMS. Check if we already have a row with the
    // same raw_text and amount inserted within the last 90 seconds (UTC time).
    const ninetySecondsAgoUTC = new Date(Date.now() - 90 * 1000).toISOString();
    const userFilter = userId ? `&user_id=eq.${userId}` : '';
    const dupCheckRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?amount=eq.${amount}&created_at=gte.${ninetySecondsAgoUTC}${userFilter}&select=id,merchant&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': authHeader
        }
      }
    ).catch(() => null);

    if (dupCheckRes && dupCheckRes.ok) {
      const dupRows = await dupCheckRes.json().catch(() => []);
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        console.log('[INGEST]: Duplicate SMS detected, skipping insert. Existing id:', dupRows[0].id);
        return res.status(200).json({
          success: true,
          deduplicated: true,
          message: 'Duplicate SMS detected within 90s window — skipped to prevent double-entry.',
          parsed: { merchant: parsedTransaction.merchant, amount: parsedTransaction.amount, type }
        });
      }
    }

    // Supabase REST API Persistence
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': authHeader,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(parsedTransaction)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('[INGEST SUPABASE ERROR]:', insertRes.status, errText);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_INSERT_FAILED',
        details: errText
      });
    }

    const insertedData = await insertRes.json().catch(() => []);

    return res.status(200).json({
      success: true,
      inserted: insertedData,
      parsed: {
        merchant: parsedTransaction.merchant,
        amount: parsedTransaction.amount,
        type: parsedTransaction.type,
        category: parsedTransaction.category,
        time_ist: timeIST,
        raw_received: cleanText.substring(0, 100)
      }
    });

  } catch (error) {
    console.error('[Ingest Error]:', error);
    return res.status(200).json({ success: true, warning: 'Fallback mode', error: error.message });
  }
};
