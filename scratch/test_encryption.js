const crypto = require('crypto').webcrypto;

// Fixed application salt for deterministic device key derivation if using PIN
const APP_SALT = new TextEncoder().encode('FinanceMe_Vault_Salt_2026');

async function deriveVaultKey(secret = 'finance_me_default_vault_secret') {
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
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
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
    console.error('Decryption failed (invalid key or tampered data):', err);
    return null;
  }
}

async function runTest() {
  console.log('--- Testing Zero-Knowledge AES-GCM 256-bit Encryption ---');
  const key = await deriveVaultKey('my_secret_vault_pin_1234');

  const sampleTxn = {
    merchant: 'Shansa',
    amount: 5000,
    type: 'Credit',
    category: 'Income',
    mode: 'GPay / UPI',
    notes: 'Inward payment received via UPI',
    date: '2026-10-05T14:30:00.000Z'
  };

  const encryptedString = await encryptData(sampleTxn, key);
  console.log('Encrypted Payload stored in DB:\n', encryptedString);

  // Decrypt
  const decrypted = await decryptData(encryptedString, key);
  console.log('\nDecrypted Transaction on Client:\n', decrypted);

  const match = JSON.stringify(sampleTxn) === JSON.stringify(decrypted);
  console.log('\nIntegrity Match:', match ? 'SUCCESS (100% Exact)' : 'FAILED');
  process.exit(match ? 0 : 1);
}

runTest();
