const https = require('https');

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

function extractRef(text) {
  if (!text) return null;
  const refPatterns = [
    /\b(?:upi\s*ref(?:erence)?(?:\s*no)?|rrn|txn\s*(?:id|no)?|ref\s*no|ref|utr|urn)\s*[:.-]?\s*([0-9a-zA-Z]{6,18})\b/i,
    /\bupi[\s/:]+(?:cr|dr|p2p|p2m)?[\s/:]*([0-9]{8,16})\b/i,
    /\(upi\s+([0-9]{8,16})\)/i,
    /\b(?:ref|rrn)\s+([0-9]{8,16})\b/i
  ];
  for (const rx of refPatterns) {
    const m = String(text).match(rx);
    if (m && m[1]) return m[1].trim().toLowerCase();
  }
  return null;
}

function normalizeBody(text) {
  if (!text) return '';
  return String(text)
    .replace(/^\[(?:SMS Inbox Scan|Auto-Captured)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const getUrl = SUPABASE_URL + '/rest/v1/transactions?select=*&order=id.desc';

https.get(getUrl, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', async () => {
    try {
      const txns = JSON.parse(data);
      console.log('Total transactions in Supabase:', txns.length);

      const kept = [];
      const duplicateIds = [];

      txns.forEach(cand => {
        const candAmt = Number(cand.amount);
        const candType = cand.type || 'Debit';
        const candRef = cand.reference_id || cand.referenceId || extractRef(cand.notes) || extractRef(cand.raw_text);
        const candBody = normalizeBody(cand.notes || cand.raw_text);
        const candDate = cand.date ? cand.date.slice(0, 10) : '';

        let found = null;
        for (const existing of kept) {
          const extAmt = Number(existing.amount);
          const extType = existing.type || 'Debit';
          if (Math.abs(candAmt - extAmt) > 0.01 || candType !== extType) continue;

          const extRef = existing.reference_id || existing.referenceId || extractRef(existing.notes) || extractRef(existing.raw_text);
          if (candRef && extRef && candRef === extRef) {
            found = { existing, reason: 'REF_ID: ' + candRef };
            break;
          }

          const extBody = normalizeBody(existing.notes || existing.raw_text);
          if (candBody && extBody && candBody.length >= 15 && candBody === extBody) {
            found = { existing, reason: 'EXACT_BODY' };
            break;
          }

          const extDate = existing.date ? existing.date.slice(0, 10) : '';
          if (candDate && extDate && candDate === extDate) {
            const m1 = (cand.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const m2 = (existing.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const isGeneric = !m1 || m1 === 'upipayment' || m1 === 'payment' || !m2 || m2 === 'upipayment' || m2 === 'payment';
            if (m1 === m2 || isGeneric || m1.includes(m2) || m2.includes(m1)) {
              found = { existing, reason: 'SAME_DAY_MERCHANT: ' + (cand.merchant || m1) };
              break;
            }
          }
        }

        if (found) {
          duplicateIds.push(cand.id);
        } else {
          kept.push(cand);
        }
      });

      console.log('Will delete ' + duplicateIds.length + ' duplicate records from Supabase...');

      let deletedCount = 0;
      for (let i = 0; i < duplicateIds.length; i += 20) {
        const batch = duplicateIds.slice(i, i + 20);
        const inClause = batch.join(',');
        const delUrl = SUPABASE_URL + '/rest/v1/transactions?id=in.(' + inClause + ')';
        await new Promise((resolve) => {
          const req = https.request(delUrl, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: 'Bearer ' + SUPABASE_KEY,
              Prefer: 'return=minimal'
            }
          }, delRes => {
            delRes.on('data', () => {});
            delRes.on('end', () => {
              deletedCount += batch.length;
              console.log('Deleted batch ' + Math.floor(i / 20 + 1) + ': ' + deletedCount + '/' + duplicateIds.length + ' done');
              resolve();
            });
          });
          req.on('error', e => {
            console.error('Delete batch error:', e);
            resolve();
          });
          req.end();
        });
      }

      console.log('Successfully purged all duplicates from Supabase! Remaining unique records:', kept.length);
    } catch (e) {
      console.error('Error during cleanup:', e);
    }
  });
});
