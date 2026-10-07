import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { PortalService } from './portal';

function portalService(options: { receipt?: Record<string, unknown> | null } = {}) {
  const context = new TenantContextService();
  const guardianFindMany = vi.fn(async () => [{ studentId: 'student-a' }, { studentId: 'student-b' }, { studentId: 'student-a' }]);
  const receiptFindFirst = vi.fn(async () => options.receipt === undefined ? ({ id: 'receipt-a', tenantId: 'tenant-a', studentId: 'student-a', receiptNumber: 'R-001' }) : options.receipt);
  const receiptLineFindMany = vi.fn(async () => [{ id: 'line-a', sequence: 1 }]);
  const database = {
    studentGuardian: { findMany: guardianFindMany },
    receipt: { findFirst: receiptFindFirst },
    receiptLine: { findMany: receiptLineFindMany },
  };
  const service = new PortalService({ db: database } as never, context, {} as never);
  const asPortal = <T>(work: () => T, identity: { roles: string[]; studentId?: string; guardianId?: string } = { roles: ['PARENT'], guardianId: 'guardian-a' }) => context.run({
    tenantId: 'tenant-a', userId: 'portal-user', ...identity, requestId: 'portal-receipt-test', isPlatformAdmin: false,
  }, work);
  return { service, database, guardianFindMany, receiptFindFirst, receiptLineFindMany, asPortal };
}

describe('portal receipt access', () => {
  it('returns a linked-parent receipt and reads its lines within the tenant scope', async () => {
    const { service, receiptFindFirst, receiptLineFindMany, guardianFindMany, asPortal } = portalService();

    const result = await asPortal(() => service.getReceipt('tenant-a', 'receipt-a'));

    expect(guardianFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', guardianId: 'guardian-a' }, select: { studentId: true } });
    expect(receiptFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: 'receipt-a', studentId: { in: ['student-a', 'student-b'] } } });
    expect(receiptLineFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', receiptId: 'receipt-a' }, orderBy: { sequence: 'asc' } });
    expect(result).toMatchObject({ receiptNumber: 'R-001', lines: [{ id: 'line-a' }] });
  });

  it('limits a student account to its own receipts', async () => {
    const { service, receiptFindFirst, guardianFindMany, asPortal } = portalService();

    await asPortal(() => service.getReceipt('tenant-a', 'receipt-a'), { roles: ['STUDENT'], studentId: 'student-a' });

    expect(guardianFindMany).not.toHaveBeenCalled();
    expect(receiptFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: 'receipt-a', studentId: { in: ['student-a'] } } });
  });

  it('does not reveal a receipt for an unlinked student', async () => {
    const { service, receiptFindFirst, receiptLineFindMany, asPortal } = portalService({ receipt: null });

    await expect(asPortal(() => service.getReceipt('tenant-a', 'receipt-other'))).rejects.toMatchObject({ status: 404 });

    expect(receiptFindFirst).toHaveBeenCalledOnce();
    expect(receiptLineFindMany).not.toHaveBeenCalled();
  });

  it('rejects a requested tenant that differs from the authenticated tenant before reading data', async () => {
    const { service, receiptFindFirst, asPortal } = portalService();

    await expect(asPortal(() => service.getReceipt('tenant-b', 'receipt-a'))).rejects.toMatchObject({ status: 403 });

    expect(receiptFindFirst).not.toHaveBeenCalled();
  });
});
