import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { TenantContextService } from '../common/tenancy';
import { ReportsService } from './reports';

function createService(contextValue: Record<string, unknown>) {
  const financeReportData = vi.fn(async () => ({}));
  const prisma = {
    db: { tenantSettings: { findUnique: vi.fn(async () => ({ timezone: 'Asia/Kolkata' })) } },
    financeReportData,
  } as unknown as PrismaService;
  const context = {
    requireTenantId: vi.fn(() => 'tenant-a'),
    require: vi.fn(() => ({ tenantId: 'tenant-a', ...contextValue })),
  } as unknown as TenantContextService;
  return { service: new ReportsService(prisma, context), financeReportData };
}

describe('finance report branch authorization', () => {
  it('passes live assigned branch memberships to every report query and returns visible scope metadata', async () => {
    const { service, financeReportData } = createService({ branchScopeEnabled: true, branchIds: ['branch-a', 'branch-b', 'branch-a'] });

    const report = await service.financeSummary('tenant-a', { from: '2026-10-01', to: '2026-10-07' });

    expect(financeReportData).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      from: '2026-10-01',
      to: '2026-10-07',
      branchIds: ['branch-a', 'branch-b'],
    }));
    expect(report.branchScope).toEqual({ mode: 'ASSIGNED_BRANCHES', branchCount: 2 });
  });

  it('passes an empty branch list as no access and leaves tenant administrators organization-wide', async () => {
    const scoped = createService({ branchScopeEnabled: true, branchIds: [] });
    const scopedReport = await scoped.service.financeSummary('tenant-a', { from: '2026-10-01', to: '2026-10-07' });
    expect(scoped.financeReportData).toHaveBeenCalledWith(expect.objectContaining({ branchIds: [] }));
    expect(scopedReport.branchScope).toEqual({ mode: 'ASSIGNED_BRANCHES', branchCount: 0 });

    const administrator = createService({ branchScopeEnabled: false, roles: ['TENANT_ADMIN'] });
    const adminReport = await administrator.service.financeSummary('tenant-a', { from: '2026-10-01', to: '2026-10-07' });
    expect(administrator.financeReportData).toHaveBeenCalledWith(expect.not.objectContaining({ branchIds: expect.anything() }));
    expect(adminReport.branchScope).toEqual({ mode: 'ORGANIZATION', branchCount: null });
  });
});
