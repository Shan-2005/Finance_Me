const crypto = require('crypto').webcrypto;

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';

const VAULT_SECRET = 'finance_me_master_vault_key_2026';
const APP_SALT = new TextEncoder().encode('FinanceMe_Vault_Salt_2026');

async function deriveVaultKey(secret = VAULT_SECRET) {
  const enc = new TextEncoder();
  const rawKeyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: APP_SALT,
      iterations: 100000,
      hash: 'SHA-256'
    },
    rawKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(plainObject, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plainObject));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const ivB64 = Buffer.from(iv).toString('base64');
  const cipherB64 = Buffer.from(ciphertextBuffer).toString('base64');

  return `enc:v1:${ivB64}:${cipherB64}`;
}

async function decryptData(encryptedString, key) {
  if (!encryptedString || typeof encryptedString !== 'string' || !encryptedString.startsWith('enc:v1:')) {
    return null;
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 4) return null;

  const iv = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const decryptedStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedStr);
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('--- Migrating Supabase Plaintext Records to AES-GCM Encrypted ---');
  const key = await deriveVaultKey(VAULT_SECRET);

  // 1. Fetch current rows
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const rows = await res.json();
  console.log(`Fetched ${rows.length} rows from Supabase.`);

  let migratedCount = 0;

  for (const row of rows) {
    // If already encrypted, skip
    if (row.notes && row.notes.startsWith('enc:v1:')) {
      console.log(`Row ${row.id.substring(0, 8)} is already encrypted. Skipping.`);
      continue;
    }

    const sensitiveData = {
      merchant: row.merchant,
      amount: parseFloat(row.amount) || 0,
      type: row.type || 'Debit',
      category: row.category || 'General',
      mode: row.mode || 'GPay / UPI',
      notes: row.notes || '',
      tags: row.tags || [],
      date: row.date || new Date().toISOString()
    };

    const encryptedBlob = await encryptData(sensitiveData, key);

    const updatePayload = {
      merchant: `🔒 Encrypted (${row.id.substring(0, 8)})`,
      amount: 0.00,
      type: 'Encrypted',
      category: 'Encrypted',
      notes: encryptedBlob
    };

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(updatePayload)
    });

    if (updateRes.ok) {
      migratedCount++;
      console.log(`✅ Successfully encrypted row: ${row.id.substring(0, 8)} (${sensitiveData.merchant} ₹${sensitiveData.amount})`);
    } else {
      console.error(`❌ Failed to update row: ${row.id}`, await updateRes.text());
    }
  }

  console.log(`\nMigration Complete: Encrypted ${migratedCount} rows.`);

  // 2. Query back and verify decryption
  console.log('\n--- Verifying Encrypted DB State & Client Decryption ---');
  const verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const encryptedRows = await verifyRes.json();

  console.log('\nWhat Supabase Dashboard Now Sees (First 3 rows):');
  encryptedRows.slice(0, 3).forEach(r => {
    console.log({
      id: r.id.substring(0, 8) + '...',
      merchant: r.merchant,
      amount: r.amount,
      type: r.type,
      notes_ciphertext: r.notes.substring(0, 40) + '...'
    });
  });

  console.log('\nClient Decryption Output (First 3 rows):');
  for (const r of encryptedRows.slice(0, 3)) {
    const dec = await decryptData(r.notes, key);
    console.log({
      id: r.id.substring(0, 8) + '...',
      recoveredMerchant: dec.merchant,
      recoveredAmount: dec.amount,
      recoveredType: dec.type
    });
  }
}

main().catch(console.error);
