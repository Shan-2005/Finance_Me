const crypto = require('crypto').webcrypto;
global.window = {
  atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
  btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
  location: { href: 'http://localhost' },
  crypto: { subtle: crypto.subtle }
};

const SUPABASE_URL = 'https://qtejgfhuzquifcobdvfo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lzW8KJcHnrknUmyB42suyg_ZMYng2fG';
const VAULT_SALT = new TextEncoder().encode('FinanceMe_Vault_Salt_2026');
const DEFAULT_VAULT_SECRET = 'finance_me_master_vault_key_2026';

let cachedCryptoKey = null;

async function getVaultEncryptionKey() {
  if (cachedCryptoKey) return cachedCryptoKey;
  const rawKeyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(DEFAULT_VAULT_SECRET),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  cachedCryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: VAULT_SALT, iterations: 100000, hash: 'SHA-256' },
    rawKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedCryptoKey;
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

async function decryptTransactionPayload(encryptedString) {
  if (!encryptedString || typeof encryptedString !== 'string' || !encryptedString.startsWith('enc:v1:')) {
    return null;
  }
  const parts = encryptedString.split(':');
  if (parts.length !== 4) return null;
  try {
    const key = await getVaultEncryptionKey();
    const iv = base64ToArrayBuffer(parts[2]);
    const ciphertext = base64ToArrayBuffer(parts[3]);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  } catch (err) {
    return null;
  }
}

async function decryptDbRecord(row) {
  if (!row) return row;
  if (row.notes && typeof row.notes === 'string' && row.notes.startsWith('enc:v1:')) {
    const decrypted = await decryptTransactionPayload(row.notes);
    if (decrypted) {
      return {
        id: row.id,
        user_id: row.user_id,
        created_at: row.created_at,
        date: decrypted.date || row.date,
        merchant: decrypted.merchant,
        amount: parseFloat(decrypted.amount) || 0,
        type: decrypted.type || 'Debit',
        category: decrypted.category || 'General',
        mode: decrypted.mode || 'GPay / UPI',
        notes: decrypted.notes || '',
        tags: Array.isArray(decrypted.tags) ? decrypted.tags : (row.tags || []),
        accountMask: decrypted.accountMask || null,
        referenceId: decrypted.referenceId || null
      };
    }
  }
  return row;
}

async function main() {
  console.log('--- Simulating Web Client Fetch & Decryption ---');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*&order=date.desc`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  console.log(`Fetched ${data.length} raw rows from Supabase.`);

  let bankAccounts = {};
  const decryptedData = await Promise.all(data.map(item => decryptDbRecord(item)));
  const txnsList = [];

  for (const item of decryptedData) {
    if (item.id === 'user_vault_bank_accounts') {
      const cloudAccounts = await decryptTransactionPayload(item.notes);
      if (cloudAccounts && typeof cloudAccounts === 'object') {
        bankAccounts = { ...bankAccounts, ...cloudAccounts };
      }
      continue; // Filter out system sync row!
    }
    txnsList.push(item);
  }

  console.log('\n=== REAL TRANSACTIONS DECRYPTED ON CLIENT (Count: ' + txnsList.length + ') ===');
  console.table(txnsList.map(t => ({ id: t.id.substring(0, 8), merchant: t.merchant, amount: t.amount, type: t.type })));

  console.log('\n=== DECRYPTED BANK PASSBOOK ACCOUNTS ON CLIENT ===');
  console.log(bankAccounts);

  let totalReceived = 0;
  let totalPaid = 0;
  txnsList.forEach(t => {
    if (t.type === 'Credit') totalReceived += t.amount;
    else totalPaid += t.amount;
  });

  console.log('\n=== CALCULATED CLIENT FINANCIAL METRICS ===');
  console.log('Total Received: ₹' + totalReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
  console.log('Total Paid: ₹' + totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
  console.log('Net Cash Flow: ₹' + (totalReceived - totalPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 }));
}

main().catch(console.error);
