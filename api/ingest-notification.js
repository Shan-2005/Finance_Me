// Vercel Serverless Function with Supabase Integration
// Endpoint: POST https://your-app.vercel.app/api/ingest-notification

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
    const { rawText, sender, timestamp } = req.body || {};

    if (!rawText) {
      return res.status(400).json({ error: 'rawText notification body is required' });
    }

    // RegEx Extraction Patterns
    const amountRegex = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
    const merchantRegex = /(?:at|vpa|to|info|paid to|credited with|transferred to)\s+([A-Za-z0-9\s&.\-@]+?)(?=\s+via|\s+for|\s+on|\s+ref|\s+vpa|\s+from|\.|$)/i;
    const typeRegex = /(debited|credited|sent|received|paid)/i;

    const amountMatch = rawText.match(amountRegex);
    const merchantMatch = rawText.match(merchantRegex);
    const typeMatch = rawText.match(typeRegex);

    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    const merchant = merchantMatch ? merchantMatch[1].trim() : (sender || 'GPay Merchant');
    const isCredit = typeMatch && /credited|received/i.test(typeMatch[1]);
    const type = isCredit ? 'Credit' : 'Debit';

    let category = 'Variable Wants';
    if (isCredit) {
      category = 'Income';
    } else if (/sip|mutual|index|zerodha|groww|invest|stocks/i.test(rawText + merchant)) {
      category = 'Investments';
    } else if (/loan|emi|rent|hdfc|bill|electricity|gas|maintenance|broadband/i.test(rawText + merchant)) {
      category = 'Fixed Needs';
    }

    const parsedTransaction = {
      id: `txn-${Date.now()}`,
      merchant,
      amount,
      type,
      category,
      mode: 'GPay / UPI Auto-Sync',
      date: timestamp ? new Date(timestamp).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      tags: ['#auto-ingested', `#${merchant.toLowerCase().replace(/[^a-z0-9]/g, '')}`],
      notes: `Auto-ingested via notification: "${rawText.substring(0, 50)}..."`,
      raw_text: rawText
    };

    // If Supabase environment variables are present, save to Supabase REST API
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
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
      console.log('[Supabase Write Success]:', dbData);
      return res.status(200).json({ success: true, database: 'Supabase', transaction: parsedTransaction });
    }

    // Default response if Supabase env vars not added yet
    return res.status(200).json({ success: true, database: 'LocalStorage Sync', transaction: parsedTransaction });

  } catch (error) {
    console.error('[Ingest Error]:', error);
    return res.status(500).json({ error: 'Failed to process notification', details: error.message });
  }
};
