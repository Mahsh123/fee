import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { GatewaysService } from './gateways';

const tenantId = 'tenant-school';
type TestGatewayConfig = {
  id: string;
  tenantId: string;
  provider: 'MOCK' | 'RAZORPAY' | 'CASHFREE' | 'STRIPE' | 'PAYU';
  environment: 'TEST';
  webhookSecretCiphertext: string;
};
const provider: TestGatewayConfig['provider'] = 'MOCK';
const secret = 'test-webhook-secret';
const config: TestGatewayConfig = {
  id: 'gateway-school-mock',
  tenantId,
  provider,
  environment: 'TEST',
  webhookSecretCiphertext: 'encrypted-secret',
};
const rawBody = Buffer.from('{}');
const body = { eventId: 'provider-event-1', orderId: 'provider-order-1', status: 'SUCCESS', amount: '10.00', currency: 'INR' };

function signatureFor(bodyBytes = rawBody) {
  return createHmac('sha256', secret).update(bodyBytes).digest('hex');
}

function makeService(options: {
  gatewayConfig?: TestGatewayConfig;
  create?: ReturnType<typeof vi.fn>;
  findExisting?: ReturnType<typeof vi.fn>;
} = {}) {
  const gatewayConfig = options.gatewayConfig ?? config;
  const context = new TenantContextService();
  const create = options.create ?? vi.fn().mockResolvedValue({ id: 'webhook-verified', processingStatus: 'RECEIVED' });
  const findExisting = options.findExisting ?? vi.fn().mockResolvedValue(null);
  const tx = { gatewayWebhook: { create } };
  const prisma = {
    db: {
      tenantPaymentGateway: { findFirst: vi.fn().mockResolvedValue(gatewayConfig) },
      tenantSettings: { findUnique: vi.fn().mockResolvedValue({ currencyMinorUnits: 2 }) },
      gatewayWebhook: { findFirst: findExisting },
    },
    transactionWithRetry: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const service = new GatewaysService(
    prisma as never,
    { decrypt: vi.fn().mockReturnValue(secret) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    context,
    {} as never,
  );
  const processWebhook = vi.fn().mockResolvedValue({ accepted: true, processed: true });
  (service as unknown as { processWebhook: typeof processWebhook }).processWebhook = processWebhook;
  (service as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = { warn: vi.fn() };

  const receive = (sig: string, input: { rawBody?: Buffer; body?: unknown; headers?: Record<string, string> } = {}) => {
    const signatureHeader = gatewayConfig.provider === 'RAZORPAY' ? 'x-razorpay-signature'
      : gatewayConfig.provider === 'CASHFREE' ? 'x-webhook-signature'
      : gatewayConfig.provider === 'STRIPE' ? 'stripe-signature'
      : gatewayConfig.provider === 'PAYU' ? null : 'x-mock-signature';
    const headers = {
      ...(signatureHeader ? { [signatureHeader]: sig } : {}),
      ...(input.headers ?? {}),
    };
    return context.run({ tenantId, requestId: 'request-webhook-test' }, () =>
      service.receiveWebhook(tenantId, gatewayConfig.id, {
        rawBody: input.rawBody ?? rawBody,
        headers,
        body: input.body ?? body,
      } as never),
    );
  };

  return { receive, prisma, create, findExisting, processWebhook };
}

describe('gateway webhook verified-event deduplication', () => {
  it('rejects an invalid signature before persisting a provider event or looking up the event ID', async () => {
    const { receive, prisma, create, findExisting } = makeService();

    await expect(receive('attacker-controlled-invalid-signature')).rejects.toMatchObject({ status: 403 });

    expect(prisma.db.tenantPaymentGateway.findFirst).toHaveBeenCalledWith({ where: { tenantId, id: config.id, enabled: true, active: true } });
    expect(create).not.toHaveBeenCalled();
    expect(findExisting).not.toHaveBeenCalled();
    expect(prisma.transactionWithRetry).not.toHaveBeenCalled();
    expect(prisma.db.tenantSettings.findUnique).not.toHaveBeenCalled();
  });

  it('stores only a signature-verified event before handing it to the financial processor', async () => {
    const { receive, create, processWebhook } = makeService();

    await expect(receive(signatureFor())).resolves.toEqual({ accepted: true, processed: true });

    expect(create).toHaveBeenCalledOnce();
    const stored = create.mock.calls[0]?.[0].data;
    expect(stored).toMatchObject({ tenantId, provider, externalEventId: 'provider-event-1', signatureValid: true, processingStatus: 'RECEIVED', lastError: null });
    expect(processWebhook).toHaveBeenCalledWith(tenantId, config, 'webhook-verified', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('resolves a duplicate only through a verified row, so a legacy invalid row cannot suppress capture', async () => {
    const validExisting = { id: 'valid-webhook', signatureValid: true, processingStatus: 'RECEIVED', payload: body };
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findExisting = vi.fn().mockResolvedValue(validExisting);
    const { receive, processWebhook } = makeService({ create, findExisting });

    await expect(receive(signatureFor())).resolves.toEqual({ accepted: true, processed: true });

    expect(findExisting).toHaveBeenCalledWith({ where: { tenantId, provider, environment: 'TEST', externalEventId: 'provider-event-1', signatureValid: true } });
    expect(processWebhook).toHaveBeenCalledWith(tenantId, config, 'valid-webhook', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('rejects the same verified event ID when its JSON payload differs from the persisted event', async () => {
    const validExisting = { id: 'valid-webhook', signatureValid: true, processingStatus: 'RECEIVED', payload: { ...body, orderId: 'another-order' } };
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findExisting = vi.fn().mockResolvedValue(validExisting);
    const { receive, processWebhook } = makeService({ create, findExisting });

    await expect(receive(signatureFor())).rejects.toMatchObject({ code: 'WEBHOOK_EVENT_PAYLOAD_MISMATCH', status: 409 });

    expect(processWebhook).not.toHaveBeenCalled();
  });

  it('ignores an unsigned Razorpay event-ID header and uses the ID in the signed body', async () => {
    const eventBody = { id: 'signed-razorpay-event', event: 'payment.captured', payload: { payment: { entity: { id: 'pay-1', order_id: 'order-1', status: 'captured', amount: 1000, currency: 'INR' } } } };
    const eventRaw = Buffer.from(JSON.stringify(eventBody));
    const signature = createHmac('sha256', secret).update(eventRaw).digest('hex');
    const { receive, create } = makeService({ gatewayConfig: { ...config, provider: 'RAZORPAY' } });

    await receive(signature, { rawBody: eventRaw, body: eventBody, headers: { 'x-razorpay-event-id': 'attacker-chosen-id' } });

    expect(create.mock.calls[0]?.[0].data.externalEventId).toBe('signed-razorpay-event');
  });

  it('ignores an unsigned Cashfree event-ID header and accepts delayed signed resends by body ID', async () => {
    const eventBody = { id: 'signed-cashfree-event', type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'order-1', order_currency: 'INR' }, payment: { cf_payment_id: 'payment-1', payment_status: 'SUCCESS', payment_amount: 1000 } } };
    const eventRaw = Buffer.from(JSON.stringify(eventBody));
    const timestamp = String(Date.now() - 25 * 60 * 60 * 1000);
    const signature = createHmac('sha256', secret).update(timestamp).update(eventRaw).digest('base64');
    const { receive, create } = makeService({ gatewayConfig: { ...config, provider: 'CASHFREE' } });

    await receive(signature, { rawBody: eventRaw, body: eventBody, headers: { 'x-webhook-timestamp': timestamp, 'x-webhook-id': 'attacker-chosen-id' } });

    expect(create.mock.calls[0]?.[0].data.externalEventId).toBe('signed-cashfree-event');
  });

  it('derives PayU event identity from the verified signature rather than unsigned mihpayid', async () => {
    const signedFields = { status: 'success', email: 'payer@example.test', firstname: 'Payer', productinfo: 'Fees', amount: '10.00', txnid: 'order-1', key: 'merchant-key' };
    const signatureText = [secret, signedFields.status, '', '', '', '', '', '', '', '', '', '', signedFields.email, signedFields.firstname, signedFields.productinfo, signedFields.amount, signedFields.txnid, signedFields.key].join('|');
    const signature = createHash('sha512').update(signatureText).digest('hex');
    const eventBody = { ...signedFields, mihpayid: 'attacker-chosen-id', hash: signature };
    const eventRaw = Buffer.from(JSON.stringify(eventBody));
    const { receive, create, processWebhook } = makeService({ gatewayConfig: { ...config, provider: 'PAYU' } });

    await receive(signature, { rawBody: eventRaw, body: eventBody });

    expect(create.mock.calls[0]?.[0].data.externalEventId).toBe(`signature-${createHash('sha256').update(signature).digest('hex')}`);
    expect(processWebhook.mock.calls[0]?.[3]).toMatchObject({ providerOrderId: 'order-1', providerPaymentId: null });
  });
});
