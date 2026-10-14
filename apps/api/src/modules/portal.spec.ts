import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { PortalService } from './portal';

function portalService(options: { receipt?: Record<string, unknown> | null; openItems?: Array<Record<string, unknown>> } = {}) {
  const context = new TenantContextService();
  const guardianFindMany = vi.fn(async () => [{ studentId: 'student-a' }, { studentId: 'student-b' }, { studentId: 'student-a' }]);
  const receiptFindFirst = vi.fn(async () => options.receipt === undefined ? ({ id: 'receipt-a', tenantId: 'tenant-a', studentId: 'student-a', receiptNumber: 'R-001' }) : options.receipt);
  const receiptLineFindMany = vi.fn(async () => [{ id: 'line-a', sequence: 1, amount: '1500.00', currency: 'INR', description: 'Term fee', feeTypeName: 'Term fee' }]);
  const notificationFindMany = vi.fn(async () => [{ id: 'notice-a', readAt: null }]);
  const notificationCount = vi.fn(async () => 7);
  const notificationFindFirst = vi.fn(async () => ({ id: 'notice-a', readAt: null }));
  const notificationUpdateMany = vi.fn(async () => ({ count: 1 }));
  const studentFindMany = vi.fn(async () => [{ id: 'student-a', admissionNumber: 'W-001', firstName: 'Asha', middleName: null, lastName: 'Rao', status: 'ACTIVE' }]);
  const creditGroupBy = vi.fn(async () => [{ currency: 'INR', _sum: { availableAmount: '999.00' } }]);
  const paymentOpenItems = vi.fn(async (_tenantId: string, studentId: string) => options.openItems?.filter((item) => item.studentId === studentId) ?? []);
  const database = {
    studentGuardian: { findMany: guardianFindMany },
    student: { findMany: studentFindMany },
    feeDemand: { findMany: vi.fn(async () => []) },
    payment: { findMany: vi.fn(async () => []) },
    credit: { findMany: vi.fn(async () => []), groupBy: creditGroupBy },
    paymentMethod: { findMany: vi.fn(async () => []) },
    installment: { findMany: vi.fn(async () => []) },
    adjustment: { findMany: vi.fn(async () => []) },
    receipt: { findFirst: receiptFindFirst },
    receiptLine: { findMany: receiptLineFindMany },
    notification: { findMany: notificationFindMany, findFirst: notificationFindFirst, updateMany: notificationUpdateMany, count: notificationCount },
  };
  const service = new PortalService({ db: database } as never, context, { openItemsForStudent: paymentOpenItems } as never);
  const asPortal = <T>(work: () => T, identity: { roles: string[]; studentId?: string; guardianId?: string } = { roles: ['PARENT'], guardianId: 'guardian-a' }) => context.run({
    tenantId: 'tenant-a', userId: 'portal-user', ...identity, requestId: 'portal-receipt-test', isPlatformAdmin: false,
  }, work);
  return { service, database, guardianFindMany, receiptFindFirst, receiptLineFindMany, notificationFindMany, notificationCount, notificationFindFirst, notificationUpdateMany, studentFindMany, creditGroupBy, paymentOpenItems, asPortal };
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

  it('returns only notifications addressed to the signed-in guardian and its own user account', async () => {
    const { service, notificationFindMany, notificationCount, asPortal } = portalService();

    const result = await asPortal(() => service.listNotifications('tenant-a'));

    expect(notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', OR: [{ recipientType: 'USER', recipientId: 'portal-user' }, { recipientType: 'GUARDIAN', recipientId: 'guardian-a' }] },
      select: expect.not.objectContaining({ toAddress: expect.anything(), payload: expect.anything(), lastError: expect.anything() }),
    }));
    expect(notificationCount).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', OR: [{ recipientType: 'USER', recipientId: 'portal-user' }, { recipientType: 'GUARDIAN', recipientId: 'guardian-a' }], readAt: null } });
    expect(result).toMatchObject({ unreadCount: 7, items: [{ id: 'notice-a' }] });
  });

  it('marks a notification read only when it belongs to a linked portal identity', async () => {
    const { service, notificationFindFirst, notificationUpdateMany, asPortal } = portalService();

    await asPortal(() => service.markNotificationRead('tenant-a', 'notice-a'));

    expect(notificationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', id: 'notice-a', OR: [{ recipientType: 'USER', recipientId: 'portal-user' }, { recipientType: 'GUARDIAN', recipientId: 'guardian-a' }] },
    }));
    expect(notificationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', id: 'notice-a', readAt: null }) }));
  });

  it('renders a downloadable receipt PDF from the authorised receipt snapshot', async () => {
    const { service, asPortal } = portalService({ receipt: {
      id: 'receipt-a', tenantId: 'tenant-a', studentId: 'student-a', receiptNumber: 'RCPT-001',
      issueDate: new Date('2026-10-12T00:00:00.000Z'), status: 'GENERATED', totalAmount: '1500.00', currency: 'INR',
      snapshot: { organization: { organizationName: 'Northstar Academy', receiptFooter: 'Thank you' }, payer: { name: 'Asha Rao' }, student: { fullName: 'Mira Rao' } },
    } });

    const { pdf, receiptNumber } = await asPortal(() => service.receiptPdf('tenant-a', 'receipt-a'));

    expect(receiptNumber).toBe('RCPT-001');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('portal dashboard totals', () => {
  it('uses full payer balances and grouped credits instead of the limited display lists', async () => {
    const { service, creditGroupBy, paymentOpenItems, asPortal } = portalService({ openItems: [
      { studentId: 'student-a', demand: { id: 'demand-a', currency: 'INR' }, outstandingAmount: '1500.00', installmentShares: [] },
      { studentId: 'student-b', demand: { id: 'demand-b', currency: 'INR' }, outstandingAmount: '500.00', installmentShares: [] },
    ] });

    const result = await asPortal(() => service.dashboard('tenant-a'));

    expect(paymentOpenItems).toHaveBeenCalledTimes(2);
    expect(creditGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['currency'],
      where: expect.objectContaining({ tenantId: 'tenant-a', studentId: { in: ['student-a', 'student-b'] } }),
    }));
    expect(result.totals).toEqual({
      linkedStudentCount: 1,
      openDemandCount: 2,
      outstandingByCurrency: [{ currency: 'INR', amount: '2000.0000' }],
      availableCreditByCurrency: [{ currency: 'INR', amount: '999.00' }],
      recentPaymentCount: 0,
    });
  });
});

describe('generic workspace person portal', () => {
  it('shows only the signed-in person’s fee balance and scopes every dashboard query', async () => {
    const personId = 'person-a';
    const demandFindMany = vi.fn(async () => [{
      id: 'demand-a', personId, studentId: null, demandNumber: 'D-001', currency: 'INR',
      dueDate: new Date('2026-11-01T00:00:00.000Z'), issueDate: new Date('2026-10-12T00:00:00.000Z'),
      status: 'ISSUED', netAmount: '1500.0000', adjustmentAmount: '0.0000', paidAmount: '0.0000', waivedAmount: '0.0000',
    }]);
    const paymentFindMany = vi.fn(async () => []);
    const creditFindMany = vi.fn(async () => []);
    const creditGroupBy = vi.fn(async () => []);
    const openItemsForPerson = vi.fn(async () => [{ demand: { id: 'demand-a', currency: 'INR' }, outstandingAmount: '1500.0000', installmentShares: [] }]);
    const userFindFirst = vi.fn(async () => ({ tenantPerson: {
      id: personId, personNumber: 'MEM-1042', typeKey: 'MEMBER', typeLabel: 'Member',
      firstName: 'Asha', middleName: null, lastName: 'Patel', preferredName: null, status: 'ACTIVE', branchId: 'branch-a', branch: null,
    } }));
    const database = {
      user: { findFirst: userFindFirst }, feeDemand: { findMany: demandFindMany }, payment: { findMany: paymentFindMany },
      credit: { findMany: creditFindMany, groupBy: creditGroupBy },
      paymentMethod: { findMany: vi.fn(async () => []) }, installment: { findMany: vi.fn(async () => []) },
      adjustment: { findMany: vi.fn(async () => []) },
    };
    const context = new TenantContextService();
    const service = new PortalService({ db: database } as never, context, { openItemsForPerson } as never);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'user-a', requestId: 'generic-person-dashboard-test', roles: ['WORKSPACE_PERSON'] }, () => service.dashboard('tenant-a'));

    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', id: 'user-a', status: 'ACTIVE', deletedAt: null } }));
    expect(demandFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', personId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }) }));
    expect(paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', personId }) }));
    expect(creditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', personId }) }));
    expect(openItemsForPerson).toHaveBeenCalledWith('tenant-a', personId);
    expect(result).toMatchObject({ person: { personNumber: 'MEM-1042' }, students: [], demands: [{ id: 'demand-a', outstandingAmount: '1500.0000' }], totals: { linkedPersonCount: 1, openDemandCount: 1 } });
  });

  it('restricts downloadable receipts to the authenticated person profile', async () => {
    const personId = 'person-a';
    const userFindFirst = vi.fn(async () => ({ tenantPersonId: personId }));
    const receiptFindFirst = vi.fn(async () => ({ id: 'receipt-a', tenantId: 'tenant-a', personId, receiptNumber: 'R-001' }));
    const receiptLineFindMany = vi.fn(async () => [{ id: 'line-a', amount: '1500.0000' }]);
    const context = new TenantContextService();
    const service = new PortalService({ db: { user: { findFirst: userFindFirst }, receipt: { findFirst: receiptFindFirst }, receiptLine: { findMany: receiptLineFindMany } } } as never, context, {} as never);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'user-a', requestId: 'generic-person-receipt-test', roles: ['WORKSPACE_PERSON'] }, () => service.getReceipt('tenant-a', 'receipt-a'));

    expect(receiptFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: 'receipt-a', personId } });
    expect(receiptLineFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', receiptId: 'receipt-a' }, orderBy: { sequence: 'asc' } });
    expect(result).toMatchObject({ personId, lines: [{ id: 'line-a' }] });
  });
});
