import { describe, expect, it } from 'vitest';
import { generateRecoveryCodes, generateTotpSecret, totpCodeForCounter, verifyTotp } from './totp';

const SECRET = 'JBSWY3DPEHPK3PXP'; // RFC 4648 base32 sample
const STEP_MS = 30_000;

describe('TOTP authenticator codes', () => {
  it('generates a base32 secret of usable length', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('matches the published RFC 6238 SHA-1 vectors', () => {
    // RFC 6238 Appendix B: secret "12345678901234567890" as base32.
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const counterAt = (seconds: number) => Math.floor(seconds / 30);
    expect(totpCodeForCounter(rfcSecret, counterAt(59))).toBe('287082');
    expect(totpCodeForCounter(rfcSecret, counterAt(1_111_111_109))).toBe('081804');
    expect(totpCodeForCounter(rfcSecret, counterAt(1_234_567_890))).toBe('005924');
  });

  it('accepts the current code and the adjacent steps', () => {
    const now = 1_760_000_000_000;
    const current = totpCodeForCounter(SECRET, Math.floor(now / STEP_MS));
    const previous = totpCodeForCounter(SECRET, Math.floor(now / STEP_MS) - 1);
    const next = totpCodeForCounter(SECRET, Math.floor(now / STEP_MS) + 1);

    expect(verifyTotp(SECRET, current, 1, now)).toBe(true);
    expect(verifyTotp(SECRET, previous, 1, now)).toBe(true);
    expect(verifyTotp(SECRET, next, 1, now)).toBe(true);
  });

  it('rejects a code from outside the accepted window', () => {
    const now = 1_760_000_000_000;
    const stale = totpCodeForCounter(SECRET, Math.floor(now / STEP_MS) - 5);

    expect(verifyTotp(SECRET, stale, 1, now)).toBe(false);
  });

  it('rejects malformed or wrong codes without throwing', () => {
    const now = 1_760_000_000_000;
    const current = totpCodeForCounter(SECRET, Math.floor(now / STEP_MS));
    const wrong = current === '000000' ? '000001' : '000000';

    expect(verifyTotp(SECRET, wrong, 1, now)).toBe(false);
    expect(verifyTotp(SECRET, '12345', 1, now)).toBe(false);
    expect(verifyTotp(SECRET, 'abcdef', 1, now)).toBe(false);
    expect(verifyTotp('not-base32!', current, 1, now)).toBe(false);
  });

  it('issues distinct single-use recovery codes', () => {
    const codes = generateRecoveryCodes(5);
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{10}$/);
  });
});
