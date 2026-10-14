import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { FeeAssignmentsService, FeeDemandsService } from './assignments';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const structureId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';

function setup(studentRows: Array<{ id: string }> = [{ id: studentId }]) {
  const assignment = { id: 'assignment-a', tenantId, targetType: 'STUDENT', targetStudentIds: [studentId] };
  const tx = {
    feeStructure: { findFirst: vi.fn(async () => ({ id: structureId, academicYearId: null })) },
    feeStructureVersion: { findFirst: vi.fn(async () => ({ id: versionId })) },
    tenantSettings: { findUnique: vi.fn(async () => ({ currency: 'INR' })) },
    branch: { findFirst: vi.fn(async () => ({ id: branchId })) },
    academicYear: { findFirst: vi.fn(async () => null) },
    student: { findMany: vi.fn(async () => studentRows) },
    feeAssignment: { create: vi.fn(async () => assignment) },
  };
  const prisma = { transactionWithRetry: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) };
  const audit = { record: vi.fn(async () => undefined) };
  const context = new TenantContextService();
  const service = new FeeAssignmentsService(prisma as never, {} as never, {} as never, audit as never, {} as never, context, {} as never);
  const create = () => context.run({ tenantId, userId: 'admin-a', requestId: 'fee-assignment-test' }, () => service.create(tenantId, {
    branchId,
    feeStructureId: structureId,
    feeStructureVersionId: versionId,
    targetType: 'STUDENT',
    targetStudentIds: [studentId],
    dueDateOverride: '2026-11-01',
  }));
  return { tx, audit, create };
}

describe('direct fee assignment', () => {
  it('persists the selected active student inside the chosen tenant branch', async () => {
    const { tx, audit, create } = setup();

    await create();

    expect(tx.student.findMany).toHaveBeenCalledWith({
      where: { tenantId, branchId, id: { in: [studentId] }, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(tx.feeAssignment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId,
      branchId,
      targetType: 'STUDENT',
      targetStudentIds: [studentId],
      status: 'DRAFT',
    }) }));
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('rejects a selected person who is not in the chosen tenant branch', async () => {
    const { tx, audit, create } = setup([]);

    await expect(create()).rejects.toMatchObject({ status: 422 });

    expect(tx.feeAssignment.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('creates a generic people assignment scoped to active tenant people in the selected branch', async () => {
    const personId = '66666666-6666-4666-8666-666666666666';
    const assignment = { id: 'assignment-person', tenantId, targetType: 'PERSON', targetPersonIds: [personId] };
    const tx = {
      feeStructure: { findFirst: vi.fn(async () => ({ id: structureId, academicYearId: null })) },
      feeStructureVersion: { findFirst: vi.fn(async () => ({ id: versionId })) },
      tenantSettings: { findUnique: vi.fn(async () => ({ currency: 'INR' })) },
      branch: { findFirst: vi.fn(async () => ({ id: branchId })) },
      tenantPerson: { findMany: vi.fn(async () => [{ id: personId }]) },
      feeAssignment: { create: vi.fn(async () => assignment) },
    };
    const prisma = { transactionWithRetry: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) };
    const audit = { record: vi.fn(async () => undefined) };
    const context = new TenantContextService();
    const service = new FeeAssignmentsService(prisma as never, {} as never, {} as never, audit as never, {} as never, context, {} as never);

    await context.run({ tenantId, userId: 'admin-a', requestId: 'generic-person-assignment-test' }, () => service.create(tenantId, {
      branchId,
      feeStructureId: structureId,
      feeStructureVersionId: versionId,
      targetType: 'PERSON',
      targetPersonIds: [personId],
      dueDateOverride: '2026-11-01',
    }));

    expect(tx.tenantPerson.findMany).toHaveBeenCalledWith({
      where: { tenantId, branchId, id: { in: [personId] }, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(tx.feeAssignment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId, branchId, targetType: 'PERSON', targetPersonIds: [personId], status: 'DRAFT',
    }) }));
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('lists generic person demands with tenant-scoped person identity for the fee register', async () => {
    const context = new TenantContextService();
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const service = new FeeDemandsService({ db: { feeDemand: { findMany, count } } } as never, {} as never, {} as never, {} as never, context);

    await context.run({ tenantId, userId: 'admin-a', requestId: 'generic-demand-list-test' }, () => service.list(tenantId, { search: 'Asha', pageSize: '20' }));

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId }),
      include: expect.objectContaining({ person: expect.objectContaining({ select: expect.objectContaining({ personNumber: true, firstName: true }) }) }),
    }));
  });

  it.each([
    { method: 'FIXED', amount: '1500', quantity: null, percentBase: null, expectedAmount: '1500.0000' },
    { method: 'QUANTITY', amount: '500', quantity: '3', percentBase: null, expectedAmount: '1500.0000' },
    { method: 'PERCENTAGE', amount: '10', quantity: null, percentBase: '15000', expectedAmount: '1500.0000' },
  ])('generates a person-linked demand using $method fee calculations', async ({ method, amount, quantity, percentBase, expectedAmount }) => {
    const personId = '66666666-6666-4666-8666-666666666666';
    const feeTypeId = '77777777-7777-4777-8777-777777777777';
    const feeTypeVersionId = '88888888-8888-4888-8888-888888888888';
    const demandCreate = vi.fn(async () => undefined);
    const itemCreate = vi.fn(async () => undefined);
    const responsibilityCreate = vi.fn(async () => undefined);
    const assignmentUpdateMany = vi.fn(async () => ({ count: 1 }));
    const assignment = {
      id: 'assignment-person', tenantId, status: 'DRAFT', generatedAt: null, targetType: 'PERSON',
      targetId: null, targetPersonIds: [personId], academicYearId: null, branchId,
      feeStructureId: structureId, feeStructureVersionId: versionId,
      dueDateOverride: new Date('2026-11-01T00:00:00.000Z'), installmentRule: null,
    };
    const tx = {
      feeDemand: { findFirst: vi.fn(async () => null), create: demandCreate },
      feeDemandItem: { create: itemCreate },
      feeDemandResponsibility: { create: responsibilityCreate },
      feeDemandItemAdjustment: { create: vi.fn(async () => undefined) },
      feeAssignment: { updateMany: assignmentUpdateMany },
    };
    const prisma = {
      db: {
        feeAssignment: { findFirst: vi.fn(async () => assignment), updateMany: vi.fn(async () => ({ count: 1 })) },
        feeStructure: { findFirst: vi.fn(async () => ({ id: structureId, academicYearId: null })) },
        feeStructureVersion: { findFirst: vi.fn(async () => ({ id: versionId, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null })) },
        feeStructureItem: { findMany: vi.fn(async () => [{
          id: 'structure-item-a', feeTypeId, feeTypeVersionId, amount, quantity, percentBase,
          frequency: 'ONE_TIME', optionality: 'MANDATORY', taxable: false, taxPercent: null, dueDate: null,
        }]) },
        tenantSettings: { findUnique: vi.fn(async () => ({ currency: 'INR', roundingMode: 'HALF_UP' })) },
        feeType: { findMany: vi.fn(async () => [{ id: feeTypeId, code: 'MEMBERSHIP', name: 'Monthly membership' }]) },
        feeTypeVersion: { findMany: vi.fn(async () => [{ id: feeTypeVersionId, calculationMethod: method, calculationConfig: null, taxPercent: null }]) },
        tenantPersonGroup: { findFirst: vi.fn(async () => null) },
        tenantPerson: { findMany: vi.fn(async () => [{
          id: personId, personNumber: 'MEM-1042', typeKey: 'MEMBER', typeLabel: 'Member',
          firstName: 'Asha', middleName: null, lastName: 'Patel', status: 'ACTIVE', branchId, metadata: null,
        }]) },
        feeDemand: { findFirst: vi.fn(async () => null) },
      },
      transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)),
    };
    const audit = { record: vi.fn(async () => undefined) };
    const outbox = { publish: vi.fn(async () => undefined) };
    const context = new TenantContextService();
    const service = new FeeAssignmentsService(
      prisma as never, {} as never, { allocate: vi.fn(async () => 'D-2026-001') } as never,
      audit as never, outbox as never, context, {} as never,
    );

    const result = await context.run({ tenantId, userId: 'admin-a', requestId: 'generic-demand-generation-test' }, () => service.generate(tenantId, assignment.id));

    expect(result).toMatchObject({ matchedPeople: 1, demandsCreated: 1, demandsSkipped: 0 });
    expect(demandCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId, personId, studentId: null, academicYearId: null, branchId, currency: 'INR', status: 'DRAFT', netAmount: expectedAmount,
    }) });
    expect(itemCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      baseAmount: expectedAmount, quantity: quantity ?? null, rate: method === 'PERCENTAGE' ? amount : null,
    }) });
    expect(responsibilityCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ payerType: 'MEMBER', payerName: 'Asha Patel', amount: expectedAmount }) });
    expect(assignmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('issues a generic person demand to the member receivable and fee income ledger accounts', async () => {
    const personId = '66666666-6666-4666-8666-666666666666';
    const demand = {
      id: 'demand-person', tenantId, studentId: null, personId, branchId, demandNumber: 'D-2026-001',
      status: 'DRAFT', netAmount: '1500.0000', baseAmount: '1500.0000', currency: 'INR',
      issueDate: new Date('2026-10-12T00:00:00.000Z'), updatedAt: new Date('2026-10-12T00:00:00.000Z'),
      creditedAmount: '0.0000',
    };
    const tx = {
      feeDemand: {
        findFirst: vi.fn().mockResolvedValueOnce(demand).mockResolvedValueOnce({ ...demand, status: 'ISSUED' }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      feeDemandItem: { findMany: vi.fn(async () => [{ id: 'demand-item-a', sequence: 0 }]) },
      feeDemandItemAdjustment: { findMany: vi.fn(async () => []) },
    };
    const ledgerPost = vi.fn(async () => ({ transactionGroupId: 'ledger-person-issue' }));
    const audit = { record: vi.fn(async () => undefined) };
    const outbox = { publish: vi.fn(async () => undefined) };
    const context = new TenantContextService();
    const service = new FeeDemandsService({ transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)) } as never, { post: ledgerPost } as never, audit as never, outbox as never, context);

    const result = await context.run({ tenantId, userId: 'admin-a', requestId: 'generic-demand-issue-test' }, () => service.issue(tenantId, demand.id));

    expect(result).toMatchObject({ id: demand.id, status: 'ISSUED' });
    expect(ledgerPost).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      personId, studentId: null, demandId: demand.id,
      lines: expect.arrayContaining([
        expect.objectContaining({ accountKey: 'TENANT_PERSON_RECEIVABLE', side: 'DEBIT', amount: '1500.0000' }),
        expect.objectContaining({ accountKey: 'FEE_INCOME', side: 'CREDIT', amount: '1500.0000' }),
      ]),
    }));
    expect(audit.record).toHaveBeenCalledOnce();
    expect(outbox.publish).toHaveBeenCalledOnce();
  });
});
