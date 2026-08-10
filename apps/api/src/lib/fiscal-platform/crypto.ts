import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

// AES-256-GCM at-rest cipher for fiscal-platform API keys stored in
// businesses.fiscal_platform_api_key_encrypted (bytea).
//
// Payload layout: iv(12) || authTag(16) || ciphertext(N)
//
// The key comes from FISCAL_ENCRYPTION_KEY (base64-encoded 32 bytes).
// Rotating this env var invalidates every ciphertext already in the DB —
// re-encryption must happen before the swap.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FISCAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'Missing FISCAL_ENCRYPTION_KEY (base64-encoded 32 bytes). Generate with `openssl rand -base64 32`.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `FISCAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes, got ${key.length}`,
    );
  }
  cachedKey = key;
  return key;
}

export function encryptApiKey(plaintext: string): Buffer {
  if (!plaintext) throw new Error('encryptApiKey: plaintext is empty');
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptApiKey(payload: Buffer): string {
  const key = getKey();
  const min = IV_LENGTH + AUTH_TAG_LENGTH + 1;
  if (payload.length < min) {
    throw new Error(
      `decryptApiKey: payload too short (${payload.length} bytes, need >= ${min})`,
    );
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// UI-safe hint: last 4 chars of the key with the fiscal-platform prefix.
// Stored in businesses.fiscal_platform_api_key_hint for display.
export function apiKeyHint(plaintext: string): string {
  const last4 = plaintext.slice(-4);
  return `fpk_…${last4}`;
}
