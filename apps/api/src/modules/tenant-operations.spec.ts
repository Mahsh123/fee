import { describe, expect, it, vi } from 'vitest';
import { CORE_TENANT_MODULES } from '@fee/types';
import { TenantContextService } from '../common/tenancy';
import { TenantConfigurationService } from './tenant-operations';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function numberingRecord() {
  return {
    id: 'numbering-a', tenantId, formatVersion: 2,
    receiptPrefix: 'RCPT', invoicePrefix: 'INV', paymentPrefix: 'PAY', demandPrefix: 'DMD', refundPrefix: 'REF',
    creditNotePrefix: 'CRN', adjustmentPrefix: 'ADJ', applicationPrefix: 'APP', studentPrefix: 'STU',
    padding: 6, includeYear: true, separator: '-', resetAnnually: false, resetAnnuallyFrom: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function planModuleAccess(enabledModules: string[]) {
  return {
    tenant: { findFirst: vi.fn(async () => ({ enabledModules: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS', 'ADMISSIONS'] })) },
    tenantSubscription: { findFirst: vi.fn(async () => ({ status: 'ACTIVE', plan: { modules: enabledModules.map((moduleKey) => ({ moduleKey, enabled: true })) } })) },
    tenantModuleOverride: { findMany: vi.fn(async () => []) },
  };
}

describe('module-scoped tenant document numbering', () => {
  it('hides numbering prefixes for optional modules absent from the current plan', async () => {
    const moduleAccess = planModuleAccess([...CORE_TENANT_MODULES]);
    const context = new TenantContextService();
    const prisma = { db: { ...moduleAccess, tenantNumberingSettings: { upsert: vi.fn(async () => numberingRecord()) } } };
    const service = new TenantConfigurationService(prisma as never, { record: vi.fn() } as never, context);

    const result = await context.run({ tenantId, userId: 'admin-a', roles: ['TENANT_ADMIN'], requestId: 'numbering-read' }, () => service.getNumbering(tenantId));

    expect(result).toMatchObject({ receiptPrefix: null, invoicePrefix: null, demandPrefix: null, applicationPrefix: null });
  });

  it('ignores fee/payment/admissions prefix writes when the live plan disables those modules', async () => {
    const moduleAccess = planModuleAccess([...CORE_TENANT_MODULES]);
    const before = numberingRecord();
    const upsert = vi.fn(async ({ update }: { update: Record<string, unknown> }) => ({ ...before, ...update }));
    const tx = {
      ...moduleAccess,
      lockNumberingConfiguration: vi.fn(async () => true),
      tenantNumberingSettings: { findUnique: vi.fn(async () => before), upsert },
    };
    const prisma = { transactionWithRetry: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
    const context = new TenantContextService();
    const service = new TenantConfigurationService(prisma as never, { record: vi.fn() } as never, context);

    await context.run({ tenantId, userId: 'admin-a', roles: ['TENANT_ADMIN'], requestId: 'numbering-write' }, () => service.updateNumbering(tenantId, {
      demandPrefix: 'CUSTOM', paymentPrefix: 'CUSTOMPAY', applicationPrefix: 'CUSTOMAPP', padding: 7,
    }));

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ padding: 7 }) }));
    const update = upsert.mock.calls[0]?.[0]?.update;
    expect(update).not.toHaveProperty('demandPrefix');
    expect(update).not.toHaveProperty('paymentPrefix');
    expect(update).not.toHaveProperty('applicationPrefix');
  });
});
