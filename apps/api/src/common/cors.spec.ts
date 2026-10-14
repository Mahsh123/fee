import { describe, expect, it } from 'vitest';
import { API_CORS_ALLOWED_HEADERS } from './cors';

describe('browser API CORS headers', () => {
  it('allows the idempotency header used by Super Admin tenant provisioning', () => {
    expect(API_CORS_ALLOWED_HEADERS).toContain('idempotency-key');
    expect(API_CORS_ALLOWED_HEADERS).toContain('x-idempotency-key');
  });
});
