import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { PaymentsService } from './payments';

const tenantId = '11111111-1111-4111-8111-111111111111';
const personId = '66666666-6666-4666-8666-666666666666';

function paymentService(userLinked: boolean) {
  const context = new TenantContextService();
  const userFindFirst = vi.fn(async () => userLinked ? ({ id: 'user-a' }) : null);
  const personFindFirst = vi.fn(async () => ({ id: personId }));
  const demandFindMany = vi.fn(async () => [{
    id: 'demand-a', tenantId, branchId: 'branch-a', studentId: null, personId,
    demandNumber: 'D-001', dueDate: new Date('2026-11-01T00:00:00.000Z'), issueDate: new Date('2026-10-12T00:00:00.000Z'),
    currency: 'INR', status: 'ISSUED', paidAmount: '0.0000', netAmount: '1500.0000', adjustmentAmount: '0.0000',
  }]);
  const itemFindMany = vi.fn(async () => [{
    id: 'item-a', tenantId, demandId: 'demand-a', feeTypeCode: 'MEMBERSHIP', feeTypeName: 'Monthly membership',
    netAmount: '1500.0000', adjustmentAmount: '0.0000', paidAmount: '0.0000', waivedAmount: '0.0000',
    status: 'UNPAID', sequence: 0, dueDate: new Date('2026-11-01T00:00:00.000Z'), updatedAt: new Date('2026-10-12T00:00:00.000Z'),
  }]);
  const tx = {
    user: { findFirst: userFindFirst },
    tenantPerson: { findFirst: personFindFirst },
    feeDemand: { findMany: demandFindMany },
    feeDemandItem: { findMany: itemFindMany },
    installment: { findMany: vi.fn(async () => []) },
    installmentItem: { findMany: vi.fn(async () => []) },
    feeDemandResponsibility: { findMany: vi.fn(async () => []) },
    paymentOrder: { findMany: vi.fn(async () => []) },
  };
  const prisma = { db: tx, transaction: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)) };
  const service = new PaymentsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, context);
  const asWorkspacePerson = <T>(work: () => T) => context.run({
    tenantId, userId: 'user-a', requestId: 'generic-person-payment-test', roles: ['WORKSPACE_PERSON'],
  }, work);
  return { service, asWorkspacePerson, userFindFirst, personFindFirst, demandFindMany, itemFindMany };
}

describe('generic person payment access', () => {
  it('returns only the signed-in person’s payable fee items and assigned responsibility', async () => {
    const { service, asWorkspacePerson, userFindFirst, personFindFirst, demandFindMany, itemFindMany } = paymentService(true);

    const result = await asWorkspacePerson(() => service.openItemsForPerson(tenantId, personId));

    expect(userFindFirst).toHaveBeenCalledWith({ where: { tenantId, id: 'user-a', tenantPersonId: personId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    expect(personFindFirst).toHaveBeenCalledWith({ where: { tenantId, id: personId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    expect(demandFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, personId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } } }));
    expect(itemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId, demandId: { in: ['demand-a'] } }) }));
    expect(result).toMatchObject([{ demand: { id: 'demand-a', personId }, feeTypeName: 'Monthly membership', outstandingAmount: '1500.0000', responsibilities: [{ payerType: 'MEMBER', outstandingAmount: '1500.0000' }] }]);
  });

  it('does not reveal another person’s balances when the portal account is not linked', async () => {
    const { service, asWorkspacePerson, userFindFirst, personFindFirst, demandFindMany } = paymentService(false);

    await expect(asWorkspacePerson(() => service.openItemsForPerson(tenantId, personId))).rejects.toMatchObject({ status: 404 });

    expect(userFindFirst).toHaveBeenCalledOnce();
    expect(personFindFirst).not.toHaveBeenCalled();
    expect(demandFindMany).not.toHaveBeenCalled();
  });
});
