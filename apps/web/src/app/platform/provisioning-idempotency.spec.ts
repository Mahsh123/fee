import { describe, expect, it, vi } from 'vitest';
import type { TenantProvisionPayload } from './provision-tenant-wizard';
import { buildProvisionTenantRequest, createProvisioningIdempotencyKeyManager } from './provisioning-idempotency';

const payload: TenantProvisionPayload = {
  name: 'Cedar Club', organizationType: 'Club', contactEmail: null, contactPhone: null, countryCode: 'IN',
  enabledModules: ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS'],
  currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2, timezone: 'Asia/Kolkata', locale: 'en-IN',
  tenantAdminEmail: 'admin@cedar.test', tenantAdminFirstName: 'Asha', tenantAdminLastName: null,
  planId: 'plan-id', billingInterval: 'MONTHLY',
};

describe('tenant provisioning idempotency', () => {
  it('reuses the same key for a retry and rotates it after a payload edit', () => {
    const generateKey = vi.fn().mockReturnValueOnce('attempt-uuid-0001').mockReturnValueOnce('attempt-uuid-0002');
    const manager = createProvisioningIdempotencyKeyManager(generateKey);

    const firstAttempt = manager.forAttempt();
    const retry = manager.forAttempt();
    manager.payloadChanged();
    const changedRequest = manager.forAttempt();

    expect(firstAttempt).toBe('attempt-uuid-0001');
    expect(retry).toBe(firstAttempt);
    expect(changedRequest).toBe('attempt-uuid-0002');
    expect(generateKey).toHaveBeenCalledTimes(2);
  });

  it('sends the key in the Idempotency-Key request header', () => {
    const request = buildProvisionTenantRequest(payload, 'attempt-uuid-0001');
    expect(request.method).toBe('POST');
    expect(new Headers(request.headers).get('idempotency-key')).toBe('attempt-uuid-0001');
    expect(JSON.parse(String(request.body))).toEqual(payload);
  });

  it('clears the prior attempt after success so the next tenant gets a fresh key', () => {
    const generateKey = vi.fn().mockReturnValueOnce('attempt-uuid-0001').mockReturnValueOnce('attempt-uuid-0002');
    const manager = createProvisioningIdempotencyKeyManager(generateKey);

    const first = manager.forAttempt();
    manager.clear();

    expect(manager.forAttempt()).toBe('attempt-uuid-0002');
    expect(first).not.toBe('attempt-uuid-0002');
  });
});
