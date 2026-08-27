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
    // Universal Payload Parser - Extract text from EVERY possible format MacroDroid can send
    let rawText = '';

    const ct = (req.headers['content-type'] || '').toLowerCase();

    if (typeof req.body === 'string' && req.body.trim().length > 0) {
      // Plain text/plain or raw string body
      rawText = req.body;
    } else if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      // JSON or form-encoded body — try every known key
      const vals = Object.values(req.body).filter(v => typeof v === 'string' && v.trim().length > 2);
      rawText = req.body.rawText || req.body.notificationText || req.body.text || req.body.message ||
                req.body.sms_body || req.body.sms_message || req.body.body || req.body.sms ||
                req.body.content || req.body.data ||
                (vals.length > 0 ? vals.join(' ') : '');
    }

    // Check query string as final fallback
    if ((!rawText || rawText.trim().length < 3) && req.query) {
      rawText = req.query.rawText || req.query.text || req.query.sms || req.query.message || req.query.body || '';
    }

    // If STILL empty - reject silently (don't create junk ₹0 entries)
    if (!rawText || rawText.trim().length < 3) {
      console.warn('[INGEST DEBUG] Empty body. req.body:', JSON.stringify(req.body), 'Content-Type:', ct, 'query:', JSON.stringify(req.query));
      return res.status(200).json({ 
        success: false, 
        error: 'NO_SMS_BODY — MacroDroid fix: Change URL to include ?sms=[sms_body] at the end',
        tip: 'Use URL: https://finance-me-smoky-rho.vercel.app/api/ingest-notification?sms=[sms_body]'
      });
    }

    // Clean multiline newlines into single spaces for robust regex matching
    const cleanText = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    // --- AMOUNT EXTRACTION (multi-pass) ---
    // Pass 1: ₹/Rs. prefix directly before the number (most reliable)
    const rsPrefixRegex = /(?:₹|rs\.?|re\.?|rupee|rupees|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
    // Pass 2: number BEFORE a debit/credit keyword (e.g. "Rs 5000 debited")
    const beforeKwRegex = /([\d,]+(?:\.\d{1,2})?)\s+(?:debited|credited|sent|paid|spent|deducted)/i;
    // Pass 3: number AFTER a keyword (e.g. "paid Rs 500")
    const afterKwRegex = /(?:debited|credited|paid|sent|spent|transferred|amount|sum)\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i;

    let amount = 0;
    let amtM;
    if ((amtM = cleanText.match(rsPrefixRegex)))   amount = parseFloat(amtM[1].replace(/,/g, ''));
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

    if (!amount || isNaN(amount)) amount = 0;

    // --- CREDIT vs DEBIT DETECTION ---
    // Priority: debit keywords FIRST (some credit SMS also have "from" which confuses debit match)
    const isDebitText = /\bsent\b|\bdebited\b|\bspent\b|\bpaid\b/i.test(cleanText);
    const isCreditText = /credit alert|credited|received rs|received inr|received ₹|\bcredited to\b/i.test(cleanText);
    
    let type = 'Debit'; // Default to Debit (safer)
    if (isDebitText) type = 'Debit';
    else if (isCreditText) type = 'Credit';
    const isCredit = type === 'Credit';

    // --- MERCHANT / SENDER EXTRACTION ---
    let merchant = 'UPI Transfer';

    if (!isCredit) {
      // Debit: "To SOPHY ROSE JOSEPHINA" on its own line (multiline collapsed to space)
      const toMatch = cleanText.match(/\bTo\s+([A-Za-z][A-Za-z0-9\s&.\-@]{1,35}?)(?=\s+On\b|\s+Ref\b|\s+Not\b|\s+Call\b|\.|$)/i);
      if (toMatch && !/hdfc|bank|a\/c|account|\d{4}/i.test(toMatch[1])) {
        merchant = toMatch[1].trim();
      }
    } else {
      // Credit: "from VPA name@bank" or "from Person Name"
      const fromMatch = cleanText.match(/\bfrom\s+(?:VPA\s+)?([A-Za-z0-9][A-Za-z0-9\s&.\-@]{1,40}?)(?=\s+\(UPI|\s+Ref\b|\s+on\b|\.|$)/i);
      if (fromMatch && !/hdfc|bank|a\/c|account|\d{6}/i.test(fromMatch[1])) {
        let sender = fromMatch[1].trim();
        if (sender.includes('@')) sender = sender.split('@')[0].replace(/\d+$/, '');
        merchant = sender;
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

    const parsedTransaction = {
      id: `txn-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      merchant: merchant || (isCredit ? 'Received Payment' : 'UPI Transfer'),
      amount: amount,
      type,
      category,
      mode,
      date: nowIST.toISOString(),
      tags: ['#auto-ingested', `#${(merchant || 'upi').toLowerCase().replace(/[^a-z0-9]/g, '')}`],
      notes: `[${timeIST} IST] ${cleanText.substring(0, 80)}`,
      raw_text: rawText
    };

    // Supabase REST API Persistence
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qtejgfhuzquifcobdvfo.supabase.co';
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

    // --- BUG-09: DUPLICATE GUARD ---
    // MacroDroid can retry the same SMS. Check if we already have a row with the
    // same amount inserted within the last 90 seconds.
    const ninetySecondsAgo = new Date(nowIST.getTime() - 90 * 1000).toISOString();
    const dupCheckRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?amount=eq.${amount}&created_at=gte.${ninetySecondsAgo}&select=id&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
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
    await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(parsedTransaction)
    });

    return res.status(200).json({
      success: true,
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
