import { describe, expect, it } from 'vitest';
import { Money } from '@fee/money';
import {
  MockGatewayAdapter,
  assertDemandTransition,
  assertPaymentTransition,
  canTransitionPayment,
  createAdapter,
  deriveDemandStatus,
  gatewayStatusToPaymentStatus,
  hmacSha256Base64,
  hmacSha256Hex,
  routeGateways,
  selectGateway,
  timingSafeEqualStrings,
  verifyCashfreeWebhookSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  verifyStripeWebhookSignature,
  type GatewayRouteCandidate,
  type GatewayCredentials,
} from './index';
import { InvalidTransitionError, assertRefundTransition } from './state-machine';

describe('payment state machine', () => {
  it('allows the forward lifecycle and rejects impossible jumps', () => {
    expect(canTransitionPayment('CREATED', 'INITIATED')).toBe(true);
    expect(canTransitionPayment('PENDING', 'SUCCESS')).toBe(true);
    expect(canTransitionPayment('SUCCESS', 'REFUNDED')).toBe(true);
    expect(canTransitionPayment('SUCCESS', 'PENDING')).toBe(false);
    expect(canTransitionPayment('REFUNDED', 'SUCCESS')).toBe(false);
    expect(canTransitionPayment('CANCELLED', 'SUCCESS')).toBe(false);
  });

  it('permits a late capture after a synchronous failure, because banks do that', () => {
    expect(canTransitionPayment('FAILED', 'SUCCESS')).toBe(true);
  });

  it('treats re-applying the same status as a no-op rather than an error', () => {
    expect(() => assertPaymentTransition('SUCCESS', 'SUCCESS')).not.toThrow();
  });

  it('rejects an invalid transition with an actionable message', () => {
    expect(() => assertPaymentTransition('REFUNDED', 'PENDING')).toThrow(InvalidTransitionError);
  });

  it('re-opens a settled demand only through the documented reversion paths', () => {
    expect(() => assertDemandTransition('DRAFT', 'ISSUED')).not.toThrow();
    expect(() => assertDemandTransition('PAID', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertDemandTransition('CANCELLED', 'PAID')).toThrow(InvalidTransitionError);
  });

  it('guards the refund lifecycle', () => {
    expect(() => assertRefundTransition('REQUESTED', 'APPROVED')).not.toThrow();
    expect(() => assertRefundTransition('COMPLETED', 'PROCESSING')).toThrow(InvalidTransitionError);
  });

  it('maps gateway statuses onto payment statuses consistently', () => {
    expect(gatewayStatusToPaymentStatus('CAPTURED')).toBe('SUCCESS');
    expect(gatewayStatusToPaymentStatus('FAILED')).toBe('FAILED');
    expect(gatewayStatusToPaymentStatus('PARTIALLY_REFUNDED')).toBe('PARTIALLY_REFUNDED');
  });
});

describe('demand status derivation', () => {
  const base = {
    current: 'ISSUED' as const,
    netAmount: '34000.0000',
    paidAmount: '0.0000',
    waivedAmount: '0.0000',
    creditedAmount: '0.0000',
    dueDate: '2026-04-05',
    asOfDate: '2026-04-01',
  };

  it('reports UNPAID as ISSUED before the due date', () => {
    expect(deriveDemandStatus(base)).toBe('ISSUED');
  });

  it('reports OVERDUE once the due date has passed', () => {
    expect(deriveDemandStatus({ ...base, asOfDate: '2026-05-01' })).toBe('OVERDUE');
  });

  it('reports PARTIALLY_PAID for a partial settlement in time', () => {
    expect(deriveDemandStatus({ ...base, paidAmount: '10000.0000' })).toBe('PARTIALLY_PAID');
  });

  it('reports PAID when the paid, waived and credited amounts cover the net', () => {
    expect(deriveDemandStatus({ ...base, paidAmount: '30000.0000', waivedAmount: '4000.0000' })).toBe('PAID');
  });

  it('never overrides a draft or a cancelled demand', () => {
    expect(deriveDemandStatus({ ...base, current: 'DRAFT' })).toBe('DRAFT');
    expect(deriveDemandStatus({ ...base, current: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('treats a fully waived zero demand as settled', () => {
    expect(deriveDemandStatus({ ...base, netAmount: '0.0000', current: 'WAIVED' })).toBe('WAIVED');
  });
});

describe('signature verification', () => {
  it('verifies a Razorpay payment signature and rejects a tampered one', () => {
    const secret = 'rzp_secret';
    const signature = hmacSha256Hex(secret, 'order_123|pay_456');
    expect(
      verifyRazorpayPaymentSignature({ secret, providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature }),
    ).toBe(true);
    expect(
      verifyRazorpayPaymentSignature({ secret, providerOrderId: 'order_123', providerPaymentId: 'pay_999', signature }),
    ).toBe(false);
  });

  it('verifies a Razorpay webhook over the raw body', () => {
    const webhookSecret = 'whsec';
    const rawBody = JSON.stringify({ event: 'payment.captured', id: 'evt_1' });
    const signature = hmacSha256Hex(webhookSecret, rawBody);
    expect(verifyRazorpayWebhookSignature({ webhookSecret, rawBody, signature })).toBe(true);
    // Re-serialising with different key order must not verify.
    expect(
      verifyRazorpayWebhookSignature({ webhookSecret, rawBody: JSON.stringify({ id: 'evt_1', event: 'payment.captured' }), signature }),
    ).toBe(false);
    expect(verifyRazorpayWebhookSignature({ webhookSecret, rawBody, signature: undefined })).toBe(false);
  });

  it('verifies a Cashfree webhook over timestamp plus body', () => {
    const webhookSecret = 'cf_secret';
    const timestamp = '1710000000';
    const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const signature = hmacSha256Base64(webhookSecret, `${timestamp}${rawBody}`);
    expect(verifyCashfreeWebhookSignature({ webhookSecret, timestamp, rawBody, signature })).toBe(true);
    expect(verifyCashfreeWebhookSignature({ webhookSecret, timestamp: '1710000001', rawBody, signature })).toBe(false);
    expect(verifyCashfreeWebhookSignature({ webhookSecret, timestamp, rawBody, signature: undefined })).toBe(false);
  });

  it('verifies a Stripe signature and rejects a replayed timestamp', () => {
    const webhookSecret = 'whsec_test';
    const rawBody = JSON.stringify({ type: 'payment_intent.succeeded' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
    const header = `t=${timestamp},v1=${signature}`;

    expect(verifyStripeWebhookSignature({ webhookSecret, rawBody, header })).toBe(true);
    // Same signature, evaluated two hours later: outside the tolerance.
    expect(
      verifyStripeWebhookSignature({
        webhookSecret,
        rawBody,
        header,
        nowSeconds: Math.floor(Date.now() / 1000) + 7200,
      }),
    ).toBe(false);
  });

  it('compares signatures in constant time and tolerates different lengths', () => {
    expect(timingSafeEqualStrings('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualStrings('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualStrings('abc', 'abcdef')).toBe(false);
  });
});

describe('mock gateway adapter', () => {
  const credentials: GatewayCredentials = {
    provider: 'MOCK',
    environment: 'TEST',
    keyId: 'key_test',
    secret: 'secret_test',
    webhookSecret: 'mock-webhook-secret',
  };

  it('creates an order and returns only client-safe fields', async () => {
    const adapter = createAdapter('MOCK');
    const result = await adapter.createOrder({
      credentials,
      orderNumber: 'PO-0001',
      amount: Money.fromString('5000', 'INR'),
      currency: 'INR',
    });
    expect(result.providerOrderId).toBe('mock_order_PO-0001');
    expect(result.checkout.keyId).toBe('key_test');
    // The secret must never appear in what the browser receives.
    expect(JSON.stringify(result.checkout)).not.toContain('secret_test');
  });

  it('can be driven to every terminal outcome a test needs', async () => {
    for (const status of ['CAPTURED', 'FAILED', 'AUTHORIZED', 'CANCELLED', 'EXPIRED'] as const) {
      const adapter = new MockGatewayAdapter({ forcedStatus: status });
      const result = await adapter.verifyPayment({ credentials, providerPaymentId: 'pay_1' });
      expect(result.status).toBe(status);
      expect(result.verified).toBe(status === 'CAPTURED');
    }
  });

  it('surfaces a provider outage as a retryable gateway error', async () => {
    const adapter = new MockGatewayAdapter({
      throwOnCreate: new (await import('./types')).GatewayError({
        message: 'provider down',
        code: 'GATEWAY_ERROR',
        retryable: true,
        provider: 'MOCK',
      }),
    });
    await expect(
      adapter.createOrder({ credentials, orderNumber: 'PO-0002', amount: Money.fromString('100', 'INR'), currency: 'INR' }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('verifies a correctly signed webhook and rejects a forged one', async () => {
    const adapter = createAdapter('MOCK');
    const payload = {
      event_id: 'evt_1',
      event_type: 'payment.captured',
      order_id: 'mock_order_PO-0001',
      payment_id: 'pay_1',
      amount: '5000',
      currency: 'INR',
      status: 'CAPTURED',
    };
    const signed = MockGatewayAdapter.buildSignedWebhook(payload);
    const verified = await adapter.verifyWebhook({ credentials, rawBody: signed.rawBody, headers: signed.headers });
    expect(verified.valid).toBe(true);
    expect(verified.externalEventId).toBe('evt_1');
    expect(verified.status).toBe('CAPTURED');
    expect(verified.amount?.toFixedString()).toBe('5000.00');

    const forged = await adapter.verifyWebhook({ credentials, rawBody: signed.rawBody, headers: { 'x-mock-signature': 'deadbeef' } });
    expect(forged.valid).toBe(false);
    expect(forged.error).toBe('Signature did not verify');
  });

  it('reports an unsigned webhook as invalid rather than guessing', async () => {
    const adapter = createAdapter('MOCK');
    const result = await adapter.verifyWebhook({ credentials, rawBody: '{"a":1}', headers: {} });
    expect(result.valid).toBe(false);
  });
});

describe('gateway routing', () => {
  const money = (value: string) => Money.fromString(value, 'INR');

  const razorpay: GatewayRouteCandidate = {
    id: 'gw-razorpay',
    provider: 'RAZORPAY',
    environment: 'LIVE',
    enabled: true,
    isDefault: true,
    isBackup: false,
    priority: 100,
    supportedMethods: ['UPI', 'CARD', 'NETBANKING'],
  };
  const stripe: GatewayRouteCandidate = {
    id: 'gw-stripe',
    provider: 'STRIPE',
    environment: 'LIVE',
    enabled: true,
    isDefault: false,
    isBackup: false,
    priority: 200,
    supportedMethods: ['CARD', 'INTERNATIONAL_CARD'],
  };
  const cashfree: GatewayRouteCandidate = {
    id: 'gw-cashfree',
    provider: 'CASHFREE',
    environment: 'LIVE',
    enabled: true,
    isDefault: false,
    isBackup: true,
    priority: 300,
    supportedMethods: ['UPI', 'CARD'],
  };

  it('prefers the tenant default when several gateways could serve the method', () => {
    const decision = selectGateway([razorpay, stripe, cashfree], {
      methodKind: 'UPI',
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(decision.selected?.id).toBe('gw-razorpay');
  });

  it('honours an explicit method routing rule over the default', () => {
    const withRule: GatewayRouteCandidate = {
      ...cashfree,
      enabled: true,
      routingRules: [{ method: 'UPI' }],
    };
    const decision = selectGateway([razorpay, withRule], {
      methodKind: 'UPI',
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(decision.selected?.id).toBe('gw-cashfree');
    expect(decision.reason).toContain('configured for UPI');
  });

  it('routes international cards to the provider that supports them', () => {
    const decision = selectGateway([razorpay, stripe, cashfree], {
      methodKind: 'INTERNATIONAL_CARD',
      amount: money('150000'),
      currency: 'INR',
      channel: 'ONLINE',
      isInternational: true,
    });
    expect(decision.selected?.id).toBe('gw-stripe');
  });

  it('excludes a gateway that does not support the requested method', () => {
    const decision = selectGateway([stripe], {
      methodKind: 'UPI',
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(decision.selected).toBeUndefined();
    expect(decision.rejected).toEqual([{ id: 'gw-stripe', reason: 'does not support UPI' }]);
  });

  it('excludes a disabled gateway and a gateway outside its amount bounds', () => {
    const disabled = selectGateway([{ ...razorpay, enabled: false }], {
      methodKind: 'UPI',
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(disabled.selected).toBeUndefined();

    const bounded = selectGateway([{ ...razorpay, maxAmount: money('2000') }], {
      methodKind: 'UPI',
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(bounded.selected).toBeUndefined();
    expect(bounded.rejected[0]!.reason).toContain('maximum');
  });

  it('returns an ordered fallback plan rather than a single answer', () => {
    const plan = routeGateways([razorpay, stripe, cashfree], {
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(plan.primary?.id).toBe('gw-razorpay');
    expect(plan.fallbacks.map((candidate) => candidate.id)).toEqual(['gw-stripe', 'gw-cashfree']);
    expect(plan.reason).toContain('Routed to RAZORPAY');
  });

  it('ranks a backup gateway below an equivalent primary', () => {
    const main: GatewayRouteCandidate = { ...razorpay, id: 'gw-main', isDefault: false, isBackup: false };
    const backup: GatewayRouteCandidate = { ...razorpay, id: 'gw-backup', isDefault: false, isBackup: true };
    const decision = selectGateway([backup, main], {
      amount: money('5000'),
      currency: 'INR',
      channel: 'ONLINE',
    });
    expect(decision.selected?.id).toBe('gw-main');
  });

  it('explains an unroutable payment instead of throwing', () => {
    const decision = selectGateway([], { amount: money('5000'), currency: 'INR', channel: 'ONLINE' });
    expect(decision.selected).toBeUndefined();
    expect(decision.reason).toContain('No enabled gateway');
  });
});
