import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { FeeAssignmentsService } from './assignments';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const personId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const typeId = '55555555-5555-4555-8555-555555555555';
const typeVersionId = '66666666-6666-4666-8666-666666666666';
const assignment = {
  id: 'assignment-a', tenantId, targetType: 'PERSON', targetId: null, targetPersonIds: [personId],
  branchId, feeStructureVersionId: 'version-a', feeStructureId: 'structure-a', academicYearId: null,
  installmentRule: null, status: 'DRAFT',
};
const person = {
  id: personId, personNumber: 'MEM-001', typeKey: 'MEMBER', typeLabel: 'Member',
  firstName: 'Asha', middleName: null, lastName: 'Patel', status: 'ACTIVE', branchId,
};
const input = {
  frequency: 'MONTHLY' as const,
  periodStart: '2026-10-01', periodEnd: '2026-10-31', dueDate: '2026-10-15',
  usageInputs: [{ personId, feeStructureItemId: itemId, quantity: '3.5' }],
};

function setup(method: 'USAGE' | 'FORMULA' = 'USAGE', config: Record<string, unknown> = { schemaVersion: 1, kind: 'USAGE', quantityPath: 'fee.quantity' }) {
  const savedUsage = [{ tenantId, cycleId: 'cycle-a', personId, feeStructureItemId: itemId, quantity: { toString: () => '3.5' } }];
  const demandCreate = vi.fn(async () => undefined);
  const itemCreate = vi.fn(async () => undefined);
  const cycleCreate = vi.fn(async () => undefined);
  const cycleUpdate = vi.fn(async () => undefined);
  const usageCreateMany = vi.fn(async () => ({ count: 1 }));
  const assignmentUpdateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    feeAssignmentCycle: { create: cycleCreate, update: cycleUpdate },
    feeUsageInput: { createMany: usageCreateMany },
    feeDemand: { findFirst: vi.fn(async () => null), create: demandCreate },
    feeDemandItem: { create: itemCreate },
    feeDemandResponsibility: { create: vi.fn(async () => undefined) },
    feeDemandItemAdjustment: { create: vi.fn(async () => undefined) },
    feeAssignment: { updateMany: assignmentUpdateMany },
  };
  const prisma = {
    db: {
      feeAssignment: { findFirst: vi.fn(async () => assignment), updateMany: assignmentUpdateMany },
      feeAssignmentCycle: {
        findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      feeStructureItem: { findMany: vi.fn(async () => [{
        id: itemId, feeTypeId: typeId, feeTypeVersionId: typeVersionId, amount: { toString: () => '100' },
        quantity: null, percentBase: null, frequency: 'MONTHLY', optionality: 'MANDATORY', taxable: false,
        taxPercent: null, dueDate: null,
      }]) },
      feeType: { findMany: vi.fn(async () => [{ id: typeId, code: 'USAGE', name: 'Monthly usage' }]) },
      feeTypeVersion: { findMany: vi.fn(async () => [{ id: typeVersionId, calculationMethod: method, calculationConfig: config, taxPercent: null }]) },
      tenantPerson: { findMany: vi.fn(async () => [person]) },
      feeDemand: { findFirst: vi.fn(async () => null) },
      feeUsageInput: { findMany: vi.fn(async () => savedUsage) },
      tenantSettings: { findUnique: vi.fn(async () => ({ currency: 'INR', roundingMode: 'HALF_UP' })) },
    },
    transactionWithRetry: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const outbox = { publish: vi.fn(async () => undefined) };
  const context = new TenantContextService();
  const service = new FeeAssignmentsService(
    prisma as never, {} as never, { allocate: vi.fn(async () => 'D-2026-001') } as never,
    audit as never, outbox as never, context, {} as never,
  );
  return { service, context, prisma, tx, audit, demandCreate, itemCreate, cycleCreate, cycleUpdate, usageCreateMany };
}

describe('generic fee assignment cycles', () => {
  it('persists period and usage inputs, then creates a person-scoped demand with a calculation snapshot', async () => {
    const state = setup();
    const result = await state.context.run({ tenantId, userId: 'admin-a', requestId: 'fee-cycle-test' }, () => state.service.generateCycle(tenantId, assignment.id, input));

    expect(result).toMatchObject({ status: 'COMPLETED', frequency: 'MONTHLY', periodStart: input.periodStart, periodEnd: input.periodEnd, demandsCreated: 1 });
    expect(state.cycleCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, feeAssignmentId: assignment.id, branchId, frequency: 'MONTHLY', status: 'GENERATING' }) });
    expect(state.usageCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ tenantId, personId, feeStructureItemId: itemId, quantity: expect.objectContaining({}) })] });
    expect(state.demandCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, personId, cycleId: expect.any(String), financialPeriod: 'MONTHLY:2026-10-01:2026-10-31', dueDate: new Date('2026-10-15T00:00:00.000Z'), netAmount: '350.0000' }) });
    expect(state.itemCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ baseAmount: '350.0000', quantity: '3.5', periodStart: new Date('2026-10-01T00:00:00.000Z'), periodEnd: new Date('2026-10-31T00:00:00.000Z') }) });
    expect(state.cycleUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
    expect(state.audit.record).toHaveBeenCalled();
  });

  it('rejects a cycle with missing per-person formula or usage inputs before creating it', async () => {
    const state = setup();
    await expect(state.context.run({ tenantId, userId: 'admin-a', requestId: 'fee-cycle-test' }, () => state.service.generateCycle(tenantId, assignment.id, { ...input, usageInputs: [] }))).rejects.toMatchObject({ status: 422 });
    expect(state.cycleCreate).not.toHaveBeenCalled();
    expect(state.demandCreate).not.toHaveBeenCalled();
  });

  it('evaluates a formula against the captured cycle quantity and stores the calculated demand', async () => {
    const state = setup('FORMULA', { schemaVersion: 1, kind: 'FORMULA', expression: 'fee.amount * fee.quantity' });
    const result = await state.context.run({ tenantId, userId: 'admin-a', requestId: 'fee-cycle-formula-test' }, () => state.service.generateCycle(tenantId, assignment.id, input));

    expect(result).toMatchObject({ status: 'COMPLETED', demandsCreated: 1 });
    expect(state.demandCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ netAmount: '350.0000' }) });
  });

  it('marks automatically generated cycle and demand events as system audit actions', async () => {
    const state = setup('FORMULA', { schemaVersion: 1, kind: 'FORMULA', expression: 'fee.amount * fee.quantity' });
    await state.context.run({ tenantId, roles: ['SYSTEM'], requestId: 'fee-cycle-scheduler-test' }, () => state.service.generateCycle(tenantId, assignment.id, input));

    expect(state.audit.record).toHaveBeenCalledTimes(3);
    for (let call = 1; call <= 3; call += 1) {
      expect(state.audit.record).toHaveBeenNthCalledWith(call, expect.anything(), expect.objectContaining({ actorType: 'SYSTEM' }));
    }
  });
});
