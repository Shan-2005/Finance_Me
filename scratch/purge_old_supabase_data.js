const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

const ALLOWED_IDS = new Set([
  'eb82b8e6-aac6-4413-b1e7-0a39e9760c11', // -30 UPI
  'e18ed279-b63e-4300-9463-f25055add19d', // -1200 UPI
  'de3795e9-97e4-43a8-81f7-572e6a8f165e', // -160 UPI
  'ae3b1916-aff5-4c92-a300-da0648799ce9', // -500 UPI
  '5f896e06-a9dd-43f8-846a-8cd2a4c99575', // -908 UPI
  '47eb6ea0-a669-4273-8e9f-359a20a4ecef', // -300 UPI
  'f3941fb2-0b2a-43ee-8119-ebfca10b40d1'  // +5000 Shansa
]);

async function main() {
  console.log('Fetching all transactions from Supabase...');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=id,merchant,amount`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${await res.text()}`);
  }

  const all = await res.json();
  console.log(`Total transactions in Supabase: ${all.length}`);

  const toDelete = all.filter(item => !ALLOWED_IDS.has(String(item.id)));
  console.log(`Transactions to delete: ${toDelete.length}`);
  console.log(`Transactions to keep: ${all.length - toDelete.length}`);

  // Delete in batches of 50 using `id=in.(id1,id2,...)`
  const BATCH_SIZE = 50;
  let deletedCount = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    const idList = chunk.map(c => `"${c.id}"`).join(',');
    const deleteUrl = `${SUPABASE_URL}/rest/v1/transactions?id=in.(${encodeURIComponent(chunk.map(c => c.id).join(','))})`;

    const delRes = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal'
      }
    });

    if (delRes.ok) {
      deletedCount += chunk.length;
      process.stdout.write(`Deleted ${deletedCount}/${toDelete.length}...\r`);
    } else {
      console.error(`Batch delete error: ${delRes.status} ${await delRes.text()}`);
      // Fallback single delete
      for (const item of chunk) {
        await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${item.id}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          }
        });
      }
      deletedCount += chunk.length;
    }
  }

  console.log(`\n✅ Successfully purged ${deletedCount} old transactions!`);

  // Verify what remains in Supabase
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=id,merchant,amount,type,date&order=date.desc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const remaining = await checkRes.json();
  console.log('\n=== REMAINING TRANSACTIONS IN SUPABASE ===');
  console.log(`Count: ${remaining.length}`);
  remaining.forEach(t => console.log(`${t.id} | ${t.type} | ₹${t.amount} | ${t.merchant} | ${t.date}`));
}

main().catch(console.error);
