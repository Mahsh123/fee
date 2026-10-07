import { describe, expect, it, vi } from 'vitest';
import type { TransactionClient } from '@fee/database';
import { IdempotencyService, ledgerBalanceWhere, summarizeLedgerBalance } from './financial';

describe('ledger historical balance derivation', () => {
  it('keeps original postings in an as-of balance after a later compensating reversal', () => {
    const where = ledgerBalanceWhere({ tenantId: 'tenant-a', accountId: 'cash-a', asOfDate: '2026-09-30' });
    expect(where).toEqual({ tenantId: 'tenant-a', accountId: 'cash-a', entryDate: { lte: new Date('2026-09-30') } });
    expect('status' in where).toBe(false);

    // The original debit is now REVERSED in current state, but it belongs in
    // the September 30 balance because its mirrored credit is dated October 2.
    expect(summarizeLedgerBalance([{ side: 'DEBIT', amount: '125.2500' }])).toEqual({
      debits: '125.2500', credits: '0.0000', net: '125.2500',
    });
    expect(summarizeLedgerBalance([
      { side: 'DEBIT', amount: '125.2500' },
      { side: 'CREDIT', amount: '125.2500' },
    ])).toEqual({ debits: '125.2500', credits: '125.2500', net: '0.0000' });
  });

  it('sums grouped ledger sides without floating point arithmetic', () => {
    expect(summarizeLedgerBalance([
      { side: 'DEBIT', amount: '0.0001' },
      { side: 'DEBIT', amount: '0.0002' },
      { side: 'CREDIT', amount: '0.0001' },
    ])).toEqual({ debits: '0.0003', credits: '0.0001', net: '0.0002' });
  });
});

describe('IdempotencyService resource references', () => {
  it('persists and replays a resource ID with its discriminator', async () => {
    const row: Record<string, unknown> = {
      id: 'reservation-a',
      tenantId: 'tenant-a',
      scope: 'payment.create',
      key: 'request-key',
      requestHash: 'hash',
      status: 'IN_PROGRESS',
      responseCode: null,
      responseBody: null,
      resourceId: null,
      resourceType: null,
    };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      return row;
    });
    const tx = {
      idempotencyKey: {
        update,
        create: vi.fn(async () => {
          throw { code: 'P2002' };
        }),
        findFirst: vi.fn(async () => row),
      },
    } as unknown as TransactionClient;
    const service = new IdempotencyService();

    await service.complete(tx, {
      id: 'reservation-a',
      responseCode: 201,
      responseBody: { paymentId: 'payment-a' },
      resourceId: 'payment-a',
      resourceType: 'Payment',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reservation-a' },
      data: expect.objectContaining({ resourceId: 'payment-a', resourceType: 'Payment', status: 'COMPLETED' }),
    }));
    await expect(service.reserve(tx, {
      tenantId: 'tenant-a',
      scope: 'payment.create',
      key: 'request-key',
      requestHash: 'hash',
    })).resolves.toMatchObject({
      id: 'reservation-a',
      isNew: false,
      cachedResponse: {
        code: 201,
        body: { paymentId: 'payment-a' },
        resourceId: 'payment-a',
        resourceType: 'Payment',
      },
    });
  });

  it('rejects incomplete resource reference pairs before writing', async () => {
    const update = vi.fn();
    const service = new IdempotencyService();
    const tx = { idempotencyKey: { update } } as unknown as TransactionClient;

    await expect(service.complete(tx, {
      id: 'reservation-a',
      responseCode: 201,
      responseBody: {},
      resourceId: 'payment-a',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(update).not.toHaveBeenCalled();
  });
});
