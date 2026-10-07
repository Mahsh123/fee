import { describe, expect, it, vi } from 'vitest';
import { CORE_TENANT_MODULES } from '@fee/types';
import { resolveTenantModuleAccess } from './entitlements';

function makeDatabase(input: {
  current?: { status: string; plan: { modules: Array<{ moduleKey: string; enabled: boolean }> } } | null;
  hasHistory?: boolean;
  projection?: string[];
  overrides?: Array<{ moduleKey: string; enabled: boolean }>;
}) {
  const subscriptionFindFirst = vi.fn(async ({ where }: { where: { isCurrent?: boolean } }) => {
    if (where.isCurrent) return input.current ?? null;
    return input.hasHistory ? { id: 'previous-subscription' } : null;
  });
  const db = {
    tenant: { findFirst: vi.fn(async () => ({ enabledModules: input.projection ?? [] })) },
    tenantSubscription: { findFirst: subscriptionFindFirst },
    tenantModuleOverride: { findMany: vi.fn(async () => input.overrides ?? []) },
  };
  return { db, subscriptionFindFirst };
}

function currentSubscription(status: string) {
  return {
    status,
    plan: { modules: [...CORE_TENANT_MODULES, 'PAYMENTS', 'FEES'].map((moduleKey) => ({ moduleKey, enabled: true })) },
  };
}

describe('effective module subscription lifecycle', () => {
  it.each(['TRIAL', 'ACTIVE', 'PAST_DUE'])('keeps plan modules available during %s access', async (status) => {
    const { db } = makeDatabase({ current: currentSubscription(status) });

    const access = await resolveTenantModuleAccess(db as never, 'tenant-a');

    expect(access?.enabledModules).toContain('FEES');
    expect(access?.enabledModules).toContain('PAYMENTS');
  });

  it.each(['PAUSED', 'CANCELLED', 'EXPIRED'])('retains only core modules for a current %s subscription', async (status) => {
    const { db } = makeDatabase({
      current: currentSubscription(status),
      projection: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS'],
      overrides: [{ moduleKey: 'FEES', enabled: true }],
    });

    const access = await resolveTenantModuleAccess(db as never, 'tenant-a');

    expect(access?.enabledModules).toEqual([...CORE_TENANT_MODULES].sort());
  });

  it('does not restore optional modules from stale projections or overrides after subscription history ends', async () => {
    const { db, subscriptionFindFirst } = makeDatabase({
      hasHistory: true,
      projection: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS'],
      overrides: [{ moduleKey: 'FEES', enabled: true }, { moduleKey: 'PAYMENTS', enabled: true }],
    });

    const access = await resolveTenantModuleAccess(db as never, 'tenant-a');

    expect(subscriptionFindFirst).toHaveBeenCalledTimes(2);
    expect(access?.enabledModules).toEqual([...CORE_TENANT_MODULES].sort());
  });

  it('keeps the legacy module projection only for a workspace with no subscription history', async () => {
    const { db, subscriptionFindFirst } = makeDatabase({ projection: ['FEES', 'PAYMENTS'] });

    const access = await resolveTenantModuleAccess(db as never, 'tenant-a');

    expect(subscriptionFindFirst).toHaveBeenCalledTimes(2);
    expect(access?.enabledModules).toEqual([...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS'].sort());
  });
});
