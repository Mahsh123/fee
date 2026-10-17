import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords.
 *
 * Implemented here rather than pulled from a dependency because the whole
 * surface is one HMAC: a base32 secret, a counter, and a six digit truncation.
 * Keeping it local means the enrolment and login paths share exactly one
 * implementation and there is no transitive supply chain in the sign-in route.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(byteLength = 20): string {
  const bytes = randomBytes(byteLength);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let secret = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    secret += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return secret;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const character of normalized) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value === -1) throw new Error('The stored authenticator secret is not valid base32.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpCodeForCounter(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Accepts the adjacent steps so a device clock slightly ahead of the server does
 * not lock a legitimate operator out, while still rejecting codes from minutes
 * ago that a shoulder-surfer might replay.
 */
export function verifyTotp(secret: string, code: string, window = 1, now = Date.now()): boolean {
  const candidate = code.trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const counter = Math.floor(now / (STEP_SECONDS * 1_000));
  for (let offset = -window; offset <= window; offset += 1) {
    let expected: string;
    try {
      expected = totpCodeForCounter(secret, counter + offset);
    } catch {
      return false;
    }
    if (expected.length === candidate.length && timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

export function totpOtpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Single-use recovery codes are high-entropy random strings, not passwords. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex'));
}
