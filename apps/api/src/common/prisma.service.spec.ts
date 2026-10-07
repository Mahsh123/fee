import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/env';
import { FINANCE_GROSS_PAYMENT_STATUSES, PrismaService, financeBranchFilter, summarizeFinanceCollections } from './prisma.service';
import { TenantContextService } from './tenancy';

describe('finance report gross and net collection facts', () => {
  it('retains fully and partially refunded captured payments in gross collection statuses', () => {
    expect(FINANCE_GROSS_PAYMENT_STATUSES).toEqual(['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED']);
  });

  it('keeps gross collections, completed refunds, and net distinct per currency', () => {
    expect(summarizeFinanceCollections(
      [
        { currency: 'INR', count: 3, amount: '100.1000' },
        { currency: 'USD', count: 1, amount: '25.0000' },
      ],
      [
        { currency: 'INR', count: 2, amount: '60.0100' },
        { currency: 'EUR', count: 1, amount: '5.5000' },
      ],
    )).toEqual([
      { currency: 'EUR', paymentCount: 0, refundCount: 1, grossCollected: '0.0000', refunds: '5.5000', netAfterRefunds: '-5.5000' },
      { currency: 'INR', paymentCount: 3, refundCount: 2, grossCollected: '100.1000', refunds: '60.0100', netAfterRefunds: '40.0900' },
      { currency: 'USD', paymentCount: 1, refundCount: 0, grossCollected: '25.0000', refunds: '0.0000', netAfterRefunds: '25.0000' },
    ]);
  });

  it('binds assigned branch IDs into report SQL and fails closed for an empty membership list', () => {
    const filter = financeBranchFilter(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(filter.sql).toContain('AND "branchId" IN (?::uuid,?::uuid)');
    expect(filter.values).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(financeBranchFilter([]).sql).toBe('AND FALSE');
    expect(financeBranchFilter(undefined).sql).toBe('');
  });
});

describe('PrismaService runtime boundary', () => {
  it('keeps the full client in a JavaScript private field and exposes only the guarded handle', async () => {
    const service = new PrismaService(
      { databaseUrl: 'postgresql://fee:fee@127.0.0.1:1/fee', isProduction: false } as AppConfigService,
      new TenantContextService(),
    );
    try {
      expect(Reflect.ownKeys(service)).not.toContain('client');
      expect(Reflect.ownKeys(service)).not.toContain('#client');
      expect(Reflect.ownKeys(service)).not.toContain('transactionContext');
      expect(Reflect.ownKeys(service)).not.toContain('#transactionContext');
      expect(service.db.student).toBeDefined();
      const studentDelegate = service.db.student as unknown as Record<string, unknown>;
      for (const internal of ['$queryRawUnsafe', '$executeRawInternal', '_request', '_executeRequest', '_runtimeDataModel']) {
        expect((service.db as unknown as Record<string, unknown>)[internal]).toBeUndefined();
        expect(Object.getOwnPropertyDescriptor(service.db, internal)).toBeUndefined();
        expect(studentDelegate[internal]).toBeUndefined();
      }
      expect(studentDelegate.$parent).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(studentDelegate, '$parent')).toBeUndefined();
      expect(Reflect.ownKeys(service.db)).toEqual([]);
      expect(Reflect.ownKeys(studentDelegate)).toEqual([]);
      expect(Reflect.getPrototypeOf(service.db)).toBeNull();
      expect(Reflect.getPrototypeOf(studentDelegate)).toBeNull();
    } finally {
      await service.onModuleDestroy();
    }
  });

  it('keeps control-plane raw aggregates behind a matching verified platform context', async () => {
    const context = new TenantContextService();
    const service = new PrismaService(
      { databaseUrl: 'postgresql://fee:fee@127.0.0.1:1/fee', isProduction: false } as AppConfigService,
      context,
    );
    try {
      await expect(service.platformDashboardMetrics('00000000-0000-4000-8000-000000000001'))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(context.run({
        tenantId: '00000000-0000-4000-8000-000000000002', userId: 'tenant-user', requestId: 'tenant-metrics', isPlatformAdmin: false,
      }, () => service.platformDashboardMetrics('00000000-0000-4000-8000-000000000002')))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await service.onModuleDestroy();
    }
  });
});
