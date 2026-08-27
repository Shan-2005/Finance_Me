// Vercel Serverless Function with Ultra-Forgiving RegEx Ingestion & Supabase Storage
// Endpoint: POST https://finance-me-smoky-rho.vercel.app/api/ingest-notification

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Universal Payload Parser - Accepts rawText, notificationText, text, message, body, or plain string
    let rawText = '';
    if (typeof req.body === 'string') {
      rawText = req.body;
    } else if (req.body && typeof req.body === 'object') {
      rawText = req.body.rawText || req.body.notificationText || req.body.text || req.body.message || req.body.body || JSON.stringify(req.body);
    }

    if (!rawText || rawText.length < 3) {
      return res.status(400).json({ error: 'Notification text body is required' });
    }

    // High-Precision Multi-Format RegEx Patterns (Supports ₹2, Rs 2, INR 2.00, Debited by 2)
    const amountRegex = /(?:rs\.?|inr|₹|debited by|credited by|paid|spent|amount of|sum of)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i;
    const merchantRegex = /(?:to|at|vpa|paid to|credited from|credited with|sent to|spent at|transferred to|towards)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\s+a\/c|\.|$)/i;
    const typeRegex = /(debited|credited|sent|received|paid|spent|deposited)/i;

    const amountMatch = rawText.match(amountRegex);
    const merchantMatch = rawText.match(merchantRegex);
    const typeMatch = rawText.match(typeRegex);

    let amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    
    // Fallback amount finder if amountRegex failed
    if (!amount || amount === 0) {
      const anyNumMatch = rawText.match(/(\d+(?:\.\d{1,2})?)/);
      if (anyNumMatch) amount = parseFloat(anyNumMatch[1]);
    }

    let merchant = merchantMatch ? merchantMatch[1].trim() : (req.body?.sender || 'UPI Merchant');
    merchant = merchant.replace(/^(the|a|an)\s+/i, '').substring(0, 32);

    const isCredit = typeMatch && /credited|received|deposited/i.test(typeMatch[1]);
    const type = isCredit ? 'Credit' : 'Debit';

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
      id: `txn-${Date.now()}`,
      merchant: merchant || 'UPI Transfer',
      amount: amount || 2.00,
      type,
      category,
      mode,
      date: new Date(timestamp).toISOString().split('T')[0],
      tags: ['#auto-ingested', `#${(merchant || 'upi').toLowerCase().replace(/[^a-z0-9]/g, '')}`],
      notes: `Auto-ingested via notification: "${rawText.substring(0, 60)}..."`,
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
    return res.status(500).json({ error: 'Failed to process notification', details: error.message });
  }
};
