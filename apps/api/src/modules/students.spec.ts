import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { StudentsService } from './students';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';

function setup() {
  const findMany = vi.fn(async () => []);
  const count = vi.fn(async () => 0);
  const context = new TenantContextService();
  const service = new StudentsService({ db: { student: { findMany, count } } } as never, {} as never, {} as never, {} as never, context);
  const list = (query: Record<string, unknown>) => service.listStudents(tenantId, query);
  return { service, context, findMany, count, list };
}

describe('student search branch scope', () => {
  it('passes the selected branch into the tenant-scoped search query', async () => {
    const { service, context, findMany, count } = setup();

    await context.run({ tenantId, requestId: 'student-branch-search' }, () => service.listStudents(tenantId, { branchId, status: 'ACTIVE', search: 'Asha' }));

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId, branchId, deletedAt: null, status: { in: ['ACTIVE'] } }) }));
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId, branchId }) }));
  });

  it('rejects malformed branch filters before reading student records', async () => {
    const { context, list, findMany } = setup();

    await expect(context.run({ tenantId, requestId: 'student-branch-search' }, () => list({ branchId: 'other-branch' }))).rejects.toMatchObject({ status: 422 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
