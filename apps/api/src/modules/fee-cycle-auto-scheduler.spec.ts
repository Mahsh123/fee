import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { FeeAssignmentsService } from './assignments';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';

function setup(method: string, dueDate = '2026-04-01T00:00:00.000Z') {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const record = vi.fn(async () => undefined);
  const assignment = { id: assignmentId, feeStructureVersionId: 'version-a', needsAttention: false };
  const db = {
    tenant: { findFirst: vi.fn(async () => ({ enabledModules: ['FEES', 'PAYMENTS'] })) },
    tenantSubscription: { findFirst: vi.fn(async () => null) },
    tenantModuleOverride: { findMany: vi.fn(async () => []) },
    feeAssignment: { findMany: vi.fn(async () => [assignment]), updateMany },
    feeStructureItem: { findMany: vi.fn(async () => [{ id: itemId, frequency: 'MONTHLY', feeTypeVersionId: versionId }]) },
    feeAssignmentCycle: { findFirst: vi.fn(async () => ({
      id: 'cycle-previous', status: 'COMPLETED', periodStart: new Date('2026-03-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T00:00:00.000Z'), dueDate: new Date(dueDate),
    })) },
    feeTypeVersion: { findMany: vi.fn(async () => [{ id: versionId, calculationMethod: method }]) },
  };
  const prisma = { db, transactionWithRetry: vi.fn(async (work: (tx: unknown) => unknown) => work({ feeAssignment: { updateMany } })) };
  const context = new TenantContextService();
  const service = new FeeAssignmentsService(prisma as never, {} as never, {} as never, { record } as never, {} as never, context, {} as never);
  const generate = vi.spyOn(service, 'generateCycle').mockResolvedValue({ assignmentId, cycleId: 'new-cycle' } as never);
  return { service, context, generate, updateMany, db, record };
}

describe('automatic generic fee cycle generation', () => {
  it('generates a draft cycle at the scheduled period boundary for configured recurring amounts', async () => {
    const state = setup('FIXED', '2026-03-14T00:00:00.000Z');

    const result = await state.context.run({ tenantId, roles: ['SYSTEM'], requestId: 'cycle-scheduler-test' }, () =>
      state.service.reconcileAutomaticCycles(tenantId, new Date('2026-04-01T03:00:00.000Z')));

    expect(result).toEqual({ assignmentsChecked: 1, cyclesGenerated: 1, cyclesWaitingForInput: 0 });
    expect(state.generate).toHaveBeenCalledWith(tenantId, assignmentId, {
      frequency: 'MONTHLY', periodStart: '2026-04-01', periodEnd: '2026-04-30', dueDate: '2026-04-14', usageInputs: [],
    });
  });

  it.each(['USAGE', 'FORMULA', 'CUSTOM'])('pauses %s cycles until tenant staff enter current quantities', async (method) => {
    const state = setup(method);

    const result = await state.context.run({ tenantId, roles: ['SYSTEM'], requestId: 'cycle-scheduler-test' }, () =>
      state.service.reconcileAutomaticCycles(tenantId, new Date('2026-04-01T00:00:00.000Z')));

    expect(result).toEqual({ assignmentsChecked: 1, cyclesGenerated: 0, cyclesWaitingForInput: 1 });
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.updateMany).toHaveBeenCalledWith({ where: { tenantId, id: assignmentId, needsAttention: false }, data: { needsAttention: true } });
    expect(state.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorType: 'SYSTEM', action: 'FEE_ASSIGNMENT_CYCLE_NEEDS_INPUT' }));
  });

  it('does not generate a cycle before its period start date', async () => {
    const state = setup('FIXED');

    const result = await state.context.run({ tenantId, roles: ['SYSTEM'], requestId: 'cycle-scheduler-test' }, () =>
      state.service.reconcileAutomaticCycles(tenantId, new Date('2026-03-31T23:59:00.000Z')));

    expect(result).toEqual({ assignmentsChecked: 1, cyclesGenerated: 0, cyclesWaitingForInput: 0 });
    expect(state.generate).not.toHaveBeenCalled();
  });
});
