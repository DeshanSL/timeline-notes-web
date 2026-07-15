// Client-side crypto helpers, built entirely on the browser's Web Crypto API.
// Nothing here is ever sent to the server except the output of computeAuthHash().

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

async function sha256Hex(message) {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(hashBuffer);
}

// Sent to the server in place of a raw password. Server hashes this again
// (bcrypt) before storing it, so the plaintext password never leaves the
// browser and the server never stores a single-hashed value directly.
async function computeAuthHash(password, username) {
  return sha256Hex(`${password}:${username}`);
}

// Deterministic, password-derived AES-GCM key used only for locking/unlocking
// notes. Deliberately a different derivation path than computeAuthHash() so
// the server's stored (bcrypt) hash can never be used to reconstruct this key.
async function deriveEncKey(password, username) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`timeline-app:${username}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function exportKeyB64(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufToBase64(raw);
}

async function importKeyB64(b64) {
  return crypto.subtle.importKey('raw', base64ToBuf(b64), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

async function encryptText(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { ciphertext: bufToBase64(ciphertextBuf), iv: bufToBase64(iv.buffer) };
}

async function decryptText(key, ciphertextB64, ivB64) {
  const iv = new Uint8Array(base64ToBuf(ivB64));
  const ciphertextBuf = base64ToBuf(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextBuf);
  return new TextDecoder().decode(plainBuf);
}

function encKeyStorageName(username) {
  return `encKey:${username}`;
}

async function storeEncKey(username, key) {
  const b64 = await exportKeyB64(key);
  localStorage.setItem(encKeyStorageName(username), b64);
}

async function loadEncKey(username) {
  const b64 = localStorage.getItem(encKeyStorageName(username));
  if (!b64) return null;
  try {
    return await importKeyB64(b64);
  } catch {
    return null;
  }
}
