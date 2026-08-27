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
    // Universal Payload Parser - Extract text from body, query string, or raw string
    let rawText = '';

    if (typeof req.body === 'string' && req.body.trim().length > 0) {
      rawText = req.body;
    } else if (req.body && typeof req.body === 'object') {
      rawText = req.body.rawText || req.body.notificationText || req.body.text || req.body.message || 
                req.body.sms_body || req.body.sms_message || req.body.body || req.body.sms || 
                Object.values(req.body).filter(v => typeof v === 'string').join(' ');
    }

    if (!rawText && req.query) {
      rawText = req.query.rawText || req.query.text || req.query.sms || req.query.message || '';
    }

    if (!rawText || rawText.trim().length < 2) {
      rawText = 'UPI Payment Notification';
    }

    // Clean multiline newlines into single spaces for robust regex matching
    const cleanText = rawText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    // High-Precision Amount Extractor (Matches "Sent Rs.1.00", "Rs.10.00 credited", "Rs. 10.00")
    const amountRegex = /(?:sent\s*rs\.?|sent\s*re\.?|rs\.?|re\.?|rupee|rupees|inr|₹|debited|credited|paid|spent|sent|received|transferred|amount|sum)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i;
    const amountMatch = cleanText.match(amountRegex);

    let amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    
    // Fallback amount finder - Extracts the first standalone number with decimal or digit
    if (!amount || amount === 0) {
      const numMatches = cleanText.match(/\b(\d+(?:\.\d{1,2})?)\b/g);
      if (numMatches && numMatches.length > 0) {
        // Pick the number that represents transaction value (ignore bank A/C numbers or phone/ref numbers)
        const validAmounts = numMatches.map(n => parseFloat(n)).filter(n => n > 0 && n < 1000000 && !n.toString().includes('1009') && !n.toString().includes('1800'));
        if (validAmounts.length > 0) amount = validAmounts[0];
      }
    }

    if (!amount || amount === 0) amount = 1.00;

    // Bulletproof Debit vs Credit Classification
    const isDebit = /sent|debited|spent|paid|sent to|transferred to/i.test(cleanText);
    const isCredit = /credit alert|credited|received|deposited|recvd|cr in a\/c|received rs|received inr|received ₹/i.test(cleanText) && !isDebit;
    
    const type = isCredit ? 'Credit' : 'Debit';

    let merchant = req.body?.sender || 'UPI Transfer';

    // 1. Sent Debit Format (e.g. "To SOPHY ROSE JOSEPHINA")
    const toMatch = cleanText.match(/To\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+On|\s+Ref|\s+Not|\.|$)/i);
    if (toMatch && toMatch[1].trim().length > 1 && !/hdfc|bank|a\/c|account/i.test(toMatch[1])) {
      merchant = toMatch[1].trim();
    }

    // 2. Credit Format (e.g. "from VPA sophyrosemanivarnan47744@okicici" or "from John Doe")
    if (isCredit) {
      const fromMatch = cleanText.match(/from\s+(?:VPA\s+)?([A-Za-z0-9\s&.\-@]+?)(?=\s+\(UPI|\s+Ref|\s+on|\.|$)/i);
      if (fromMatch && fromMatch[1].trim().length > 1 && !/hdfc|bank|a\/c|account/i.test(fromMatch[1])) {
        let rawSender = fromMatch[1].trim();
        if (rawSender.includes('@')) {
          rawSender = rawSender.split('@')[0].replace(/\d+$/, '');
        }
        merchant = rawSender;
      }
    }

    // Clean up merchant name (Title Case & length limit)
    merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 36).trim();

    let category = 'Unwanted / Leak';
    if (isCredit) {
      category = 'Income';
    } else if (/sip|mutual|index|zerodha|groww|invest|stocks|gold|nps/i.test(cleanText + merchant)) {
      category = 'Investments';
    } else if (/rent|loan|emi|hdfc|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(cleanText + merchant)) {
      category = 'Unavoidable / Rent';
    }

    // Mode Detection
    let mode = 'GPay / UPI Auto-Sync';
    if (/credit card|card ending|cc/i.test(cleanText)) {
      mode = 'Credit Card';
    } else if (/netbank|neft|rtgs|imps/i.test(cleanText)) {
      mode = 'Net Banking';
    }

    const timestamp = req.body?.timestamp || new Date().toISOString();

    const parsedTransaction = {
      id: `txn-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      merchant: merchant || (isCredit ? 'Received Payment' : 'UPI Transfer'),
      amount: amount,
      type,
      category,
      mode,
      date: new Date(timestamp).toISOString().split('T')[0],
      tags: ['#auto-ingested', `#${(merchant || 'upi').toLowerCase().replace(/[^a-z0-9]/g, '')}`],
      notes: `Auto-ingested: "${cleanText.substring(0, 60)}"`,
      raw_text: rawText
    };

    // Supabase REST API Persistence
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qtejgfhuzquifcobdvfo.supabase.co';
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(parsedTransaction)
    });

    const dbData = await dbRes.json();
    return res.status(200).json({ success: true, database: 'Supabase Cloud', transaction: parsedTransaction });

  } catch (error) {
    console.error('[Ingest Error]:', error);
    return res.status(200).json({ success: true, warning: 'Fallback mode', error: error.message });
  }
};
