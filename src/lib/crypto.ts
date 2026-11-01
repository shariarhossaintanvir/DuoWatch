/**
 * DuoWatch Web Crypto Utilities
 * Uses Web Crypto API (globalThis.crypto) for secure random values and SHA-256 hashing.
 * Works seamlessly in both browser and test environments.
 */

export function generateSecureToken(byteLength: number = 24): string {
  const array = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function generateRoomCode(): string {
  // 8 chars uppercase alphanumeric, easy to read and share
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omitted easily confused 0, O, 1, I
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return generateSecureToken(16);
}

export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
