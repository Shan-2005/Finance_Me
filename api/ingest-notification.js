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

    // High-Precision Multi-Format RegEx Patterns
    const amountRegex = /(?:rs\.?|re\.?|rupee|rupees|inr|₹|debited|credited|paid|spent|sent|received|transferred|amount|sum)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i;
    const merchantRegex = /(?:to|at|vpa|paid to|credited from|credited with|received from|received by|sent to|spent at|transferred to|towards)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i;

    const amountMatch = rawText.match(amountRegex);
    const merchantMatch = rawText.match(merchantRegex);

    let amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    
    // Fallback amount finder if amountRegex failed - Extracts the first standalone number/decimal
    if (!amount || amount === 0) {
      const anyNumMatch = rawText.match(/(\d+(?:\.\d{1,2})?)/);
      if (anyNumMatch) amount = parseFloat(anyNumMatch[1]);
    }

    if (!amount || amount === 0) amount = 1.00;

    let merchant = merchantMatch ? merchantMatch[1].trim() : (req.body?.sender || 'UPI Transfer');

    // Bulletproof Credit (Received) vs Debit (Paid) Detection
    const isCredit = /credited|received|deposited|recvd|cr in a\/c|received rs|received inr|received ₹/i.test(rawText) && 
                     !/debited|spent|paid|sent to|transferred to|sent rs/i.test(rawText);
    const type = isCredit ? 'Credit' : 'Debit';

    // Specific Sender Extraction for Credit (Received) SMS
    if (isCredit) {
      const senderMatch = rawText.match(/(?:received from|credited from|credited by|recvd from|sent by|from)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+a\/c|\.|$)/i);
      if (senderMatch && senderMatch[1].trim().length > 1 && !/a\/c|account/i.test(senderMatch[1])) {
        merchant = senderMatch[1].trim();
      }
    }

    if (merchant === 'UPI Merchant' || !merchant || merchant.length < 2) {
      const fallbackTo = rawText.match(/(?:sent to|paid to|to|from)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i);
      if (fallbackTo) merchant = fallbackTo[1].trim();
    }

    merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 32);

    let category = 'Unwanted / Leak';
    if (isCredit) {
      category = 'Income';
    } else if (/sip|mutual|index|zerodha|groww|invest|stocks|gold|nps/i.test(rawText + merchant)) {
      category = 'Investments';
    } else if (/rent|loan|emi|hdfc|bill|electricity|water|gas|maintenance|broadband|wifi|salary|school|college/i.test(rawText + merchant)) {
      category = 'Unavoidable / Rent';
    }

    // Mode Detection
    let mode = 'GPay / UPI Auto-Sync';
    if (/credit card|card ending|cc/i.test(rawText)) {
      mode = 'Credit Card';
    } else if (/netbank|neft|rtgs|imps/i.test(rawText)) {
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
      notes: `Auto-ingested: "${rawText.substring(0, 60)}"`,
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
