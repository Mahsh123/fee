import type { TenantProvisionPayload } from './provision-tenant-wizard';

/** Keeps a request key in memory only; the form invalidates it whenever a field changes. */
export function createProvisioningIdempotencyKeyManager(generateKey: () => string = () => globalThis.crypto.randomUUID()) {
  let currentKey: string | null = null;

  return {
    forAttempt() {
      if (currentKey === null) currentKey = generateKey();
      return currentKey;
    },
    payloadChanged() {
      currentKey = null;
    },
    clear() {
      currentKey = null;
    },
  };
}

export function buildProvisionTenantRequest(payload: TenantProvisionPayload, idempotencyKey: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  };
}
