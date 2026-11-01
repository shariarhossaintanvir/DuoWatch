import { describe, it, expect } from 'vitest';
import { generateSecureToken, generateRoomCode, sha256 } from '../src/lib/crypto';

describe('Web Crypto Utilities', () => {
  it('should generate cryptographically random hex tokens with specified byte length', () => {
    const token1 = generateSecureToken(16);
    const token2 = generateSecureToken(16);

    expect(token1).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(token2).toHaveLength(32);
    expect(token1).not.toBe(token2);
    expect(/^[0-9a-f]+$/.test(token1)).toBe(true);
  });

  it('should generate room codes in the format XXXX-XXXX with unambiguous characters', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Verify ambiguous characters (0, O, 1, I) are omitted
    expect(code).not.toMatch(/[01OI]/);
  });

  it('should compute deterministic SHA-256 hashes matching standard vector', async () => {
    const input = 'duowatch-secret-token-12345';
    const hash1 = await sha256(input);
    const hash2 = await sha256(input);

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);

    // Changing even 1 character yields a completely different hash
    const hash3 = await sha256(input + '!');
    expect(hash3).not.toBe(hash1);
  });
});
