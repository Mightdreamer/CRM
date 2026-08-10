import { beforeEach, describe, expect, it, vi } from 'vitest';

const validKey = Buffer.alloc(32, 7).toString('base64');

describe('fiscal API key crypto', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FISCAL_ENCRYPTION_KEY = validKey;
  });

  it('round-trips plaintext and uses a fresh IV', async () => {
    const { decryptApiKey, encryptApiKey } = await import(
      '../src/lib/fiscal-platform/crypto'
    );
    const first = encryptApiKey('fpk_test_secret_ab12');
    const second = encryptApiKey('fpk_test_secret_ab12');

    expect(first.equals(second)).toBe(false);
    expect(decryptApiKey(first)).toBe('fpk_test_secret_ab12');
    expect(decryptApiKey(second)).toBe('fpk_test_secret_ab12');
  });

  it('rejects tampered ciphertext', async () => {
    const { decryptApiKey, encryptApiKey } = await import(
      '../src/lib/fiscal-platform/crypto'
    );
    const encrypted = encryptApiKey('fpk_test_secret_ab12');
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;

    expect(() => decryptApiKey(encrypted)).toThrow();
  });

  it('rejects missing and incorrectly sized encryption keys', async () => {
    delete process.env.FISCAL_ENCRYPTION_KEY;
    let crypto = await import('../src/lib/fiscal-platform/crypto');
    expect(() => crypto.encryptApiKey('fpk_test_secret_ab12')).toThrow(
      'Missing FISCAL_ENCRYPTION_KEY',
    );

    vi.resetModules();
    process.env.FISCAL_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    crypto = await import('../src/lib/fiscal-platform/crypto');
    expect(() => crypto.encryptApiKey('fpk_test_secret_ab12')).toThrow(
      'exactly 32 bytes',
    );
  });

  it('creates a safe hint without the plaintext secret', async () => {
    const { apiKeyHint } = await import('../src/lib/fiscal-platform/crypto');
    const hint = apiKeyHint('fpk_test_secret_ab12');

    expect(hint).toBe('fpk_…ab12');
    expect(hint).not.toContain('test_secret');
  });
});
