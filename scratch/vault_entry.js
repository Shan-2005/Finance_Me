import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const VAULT_SALT = new TextEncoder().encode('FinanceMe_Vault_Salt_2026');
const keyCache = new Map();

function getDerivedKey(secret) {
  if (keyCache.has(secret)) return keyCache.get(secret);
  const key = pbkdf2(sha256, secret, VAULT_SALT, { c: 100000, dkLen: 32 });
  keyCache.set(secret, key);
  return key;
}

function base64ToUint8(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decryptPayload(encryptedString, secret) {
  if (!encryptedString || typeof encryptedString !== 'string' || !encryptedString.startsWith('enc:v1:')) {
    return null;
  }
  const parts = encryptedString.split(':');
  if (parts.length !== 4) return null;

  try {
    const key = getDerivedKey(secret);
    const iv = base64ToUint8(parts[2]);
    const ciphertext = base64ToUint8(parts[3]);

    const cipher = gcm(key, iv);
    const decryptedBytes = cipher.decrypt(ciphertext);
    const jsonStr = new TextDecoder().decode(decryptedBytes);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.warn('[PureJS Decrypt Warning]:', err);
    return null;
  }
}

export function encryptPayload(plainObject, secret) {
  try {
    const key = getDerivedKey(secret);
    const iv = new Uint8Array(12);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(iv);
    } else {
      for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
    }

    const cipher = gcm(key, iv);
    const encoded = new TextEncoder().encode(JSON.stringify(plainObject));
    const encryptedBytes = cipher.encrypt(encoded);

    const ivB64 = uint8ToBase64(iv);
    const cipherB64 = uint8ToBase64(encryptedBytes);

    return `enc:v1:${ivB64}:${cipherB64}`;
  } catch (err) {
    console.error('[PureJS Encrypt Warning]:', err);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.NobleCryptoVault = {
    encryptPayload,
    decryptPayload
  };
}
