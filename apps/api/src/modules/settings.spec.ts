import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { TenantSettingsService } from './settings';

function settingsService(enabledModules: string[], planModules = enabledModules) {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const context = new TenantContextService();
  const settings = {
    id: 'settings-1', tenantId, currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2,
    roundingMode: 'HALF_UP', timezone: 'Asia/Kolkata', locale: 'en-IN', dateFormat: 'dd-MM-yyyy',
    defaultAcademicYearId: null, lateFeeMode: 'NONE', lateFeeGraceDays: 0, lateFeeFlatAmount: 0, lateFeePerDay: 0,
    lateFeePercent: 0, lateFeeMaxAmount: null, lateFeePaymentTermDays: 0, lateFeeFeeTypeId: null,
    partialPaymentPolicy: 'ALLOW', overpaymentPolicy: 'CREDIT_BALANCE', allowAdvancePayment: false, minimumPartialAmount: null,
    refundApprovalThreshold: null, waiverApprovalThreshold: null, adjustmentApprovalThreshold: null, reminderScheduleDays: [], allowNegativeDemand: false, allowPublicRegistration: false,
  };
  const upsert = vi.fn().mockResolvedValue(settings);
  const tx = {
    tenant: { findFirst: vi.fn().mockResolvedValue({ enabledModules }) },
    tenantSubscription: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE', plan: { modules: planModules.map((moduleKey) => ({ moduleKey, enabled: true })) } }) },
    tenantModuleOverride: { findMany: vi.fn().mockResolvedValue([]) },
    tenantSettings: { findUnique: vi.fn().mockResolvedValue(settings), create: vi.fn(), upsert },
  };
  const prisma = {
    db: {
      tenant: { findFirst: vi.fn().mockResolvedValue({ enabledModules }) },
      tenantSubscription: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE', plan: { modules: planModules.map((moduleKey) => ({ moduleKey, enabled: true })) } }) },
      tenantModuleOverride: { findMany: vi.fn().mockResolvedValue([]) },
      feeType: { findMany: vi.fn().mockResolvedValue([]) },
      feeTypeVersion: { findMany: vi.fn().mockResolvedValue([]) },
      feeCategory: { findMany: vi.fn().mockResolvedValue([]) },
      academicYear: { findMany: vi.fn().mockResolvedValue([]) },
    },
    transactionWithRetry: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  };
  const service = new TenantSettingsService(prisma as never, { record: vi.fn() } as never, context);
  const run = () => context.run({ tenantId, userId: 'tenant-admin', roles: ['TENANT_ADMIN'], requestId: 'settings-test-0001' }, () => service.get(tenantId));
  return { prisma, run, service: service as TenantSettingsService, tenantId, upsert, context };
}

describe('tenant settings module boundary', () => {
  it('does not query education or fee catalogs for a generic workspace', async () => {
    const { prisma, run } = settingsService(['USERS', 'BRANCHES', 'ORGANIZATION']);

    const result = await run();

    expect(prisma.db.feeType.findMany).not.toHaveBeenCalled();
    expect(prisma.db.academicYear.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ feeTypes: [], academicYears: [] });
  });

  it('loads optional catalogs only when their corresponding modules are enabled', async () => {
    const { prisma, run } = settingsService(['USERS', 'FEES', 'ADMISSIONS', 'PAYMENTS'], ['USERS', 'FEES', 'ADMISSIONS', 'PAYMENTS']);

    await run();

    expect(prisma.db.feeType.findMany).toHaveBeenCalledOnce();
    expect(prisma.db.academicYear.findMany).toHaveBeenCalledOnce();
  });

  it('ignores stale tenant projections when the current plan disables an optional module', async () => {
    const { prisma, run } = settingsService(['USERS', 'BRANCHES', 'ORGANIZATION', 'FEES'], ['USERS', 'BRANCHES', 'ORGANIZATION']);

    const result = await run();

    expect(prisma.db.feeType.findMany).not.toHaveBeenCalled();
    expect(result.enabledModules).not.toContain('FEES');
  });

  it('does not write optional settings when the current plan disables them, even if the projection is stale', async () => {
    const { service, tenantId, upsert, context } = settingsService(['USERS', 'FEES', 'PAYMENTS', 'ADMISSIONS'], ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS']);

    await context.run({ tenantId, userId: 'tenant-admin', roles: ['TENANT_ADMIN'], requestId: 'settings-update-test' }, () => service.update(tenantId, {
      currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2, roundingMode: 'HALF_UP', timezone: 'Asia/Kolkata', locale: 'en-IN', dateFormat: 'dd-MM-yyyy',
      defaultAcademicYearId: 'academic-year-id', lateFeeMode: 'FIXED', lateFeeGraceDays: 10, lateFeeFlatAmount: '50', lateFeePerDay: '2',
      lateFeePercent: '1', lateFeeMaxAmount: '500', lateFeePaymentTermDays: 7, lateFeeFeeTypeId: 'fee-type-id',
      partialPaymentPolicy: 'ALLOW', overpaymentPolicy: 'CREDIT_BALANCE', allowAdvancePayment: true, minimumPartialAmount: '10',
      refundApprovalThreshold: '100', waiverApprovalThreshold: '200', adjustmentApprovalThreshold: '300', reminderScheduleDays: [7, 3, 0], allowNegativeDemand: true,
      allowPublicRegistration: true,
    } as never));

    const write = upsert.mock.calls[0]?.[0] as { update?: Record<string, unknown> } | undefined;
    expect(write?.update).toMatchObject({ currency: 'INR', timezone: 'Asia/Kolkata' });
    expect(write?.update).not.toHaveProperty('defaultAcademicYearId');
    expect(write?.update).not.toHaveProperty('lateFeeMode');
    expect(write?.update).not.toHaveProperty('partialPaymentPolicy');
    expect(write?.update).toMatchObject({ allowPublicRegistration: true });
  });
});
