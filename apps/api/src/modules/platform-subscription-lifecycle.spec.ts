import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@fee/database';
import { TenantContextService } from '../common/tenancy';
import { PlatformSubscriptionLifecycleScheduler } from './platform-subscription-lifecycle';

function lifecycleHarness(overrides: Record<string, unknown> = {}) {
  const tenantSubscription = {
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const platformInvoice = {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'renewal-invoice', ...data })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const tenant = {
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const tx = { tenantSubscription, platformInvoice, tenant };
  const prisma = {
    transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const config = { isTest: true, platformSubscriptionLifecycle: { pollIntervalMs: 60_000, invoiceDueDays: 30, graceDays: 7 } };
  const scheduler = new PlatformSubscriptionLifecycleScheduler(prisma as never, new TenantContextService(), audit as never, config as never);
  return { scheduler, tenantSubscription, platformInvoice, tenant, prisma, audit, ...overrides };
}

describe('platform subscription lifecycle scheduler', () => {
  const now = new Date('2026-10-06T00:00:00.000Z');

  it('expires ended trials, disables their current subscription, and records a system audit', async () => {
    const harness = lifecycleHarness();
    harness.tenantSubscription.findMany.mockResolvedValue([{
      id: 'subscription-trial', tenantId: 'tenant-a', status: 'TRIAL', billingInterval: 'MONTHLY',
      amount: new Prisma.Decimal('0'), currency: 'USD', trialEndsAt: new Date('2026-10-05T00:00:00.000Z'),
      currentPeriodEnd: null, cancelAtPeriodEnd: false, isCurrent: true,
      plan: { id: 'plan-a', key: 'trial', name: 'Trial' },
    }] as never);
    harness.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });

    await harness.scheduler.reconcileTenant('tenant-a', now);

    expect(harness.tenantSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', id: 'subscription-trial', isCurrent: true, status: 'TRIAL', trialEndsAt: { lte: now } },
      data: { status: 'EXPIRED', isCurrent: false },
    }));
    expect(harness.tenant.update).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, data: { status: 'SUSPENDED', subscriptionStatus: 'EXPIRED' } });
    expect(harness.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-a', actorType: 'SYSTEM', action: 'platform.subscription.trial_expired',
    }));
  });

  it('cancels at the scheduled period boundary before expiring an ended trial', async () => {
    const harness = lifecycleHarness();
    harness.tenantSubscription.findMany.mockResolvedValue([{
      id: 'subscription-trial', tenantId: 'tenant-a', status: 'TRIAL', billingInterval: 'MONTHLY',
      amount: new Prisma.Decimal('0'), currency: 'USD', trialEndsAt: new Date('2026-10-05T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-05T00:00:00.000Z'), cancelAtPeriodEnd: true, isCurrent: true,
      plan: { id: 'plan-a', key: 'trial', name: 'Trial' },
    }] as never);
    harness.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });

    await harness.scheduler.reconcileTenant('tenant-a', now);

    expect(harness.tenantSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', id: 'subscription-trial', isCurrent: true, cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now } },
      data: { status: 'CANCELLED', isCurrent: false, cancelledAt: now, cancelAtPeriodEnd: false },
    }));
    expect(harness.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'platform.subscription.cancelled_at_period_end' }));
    expect(harness.audit.record).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'platform.subscription.trial_expired' }));
  });

  it('issues one deterministic renewal invoice when a paid period ends', async () => {
    const harness = lifecycleHarness();
    harness.tenantSubscription.findMany.mockResolvedValue([{
      id: 'subscription-12345678-90ab-4cde-8fab-1234567890ab', tenantId: 'tenant-a', status: 'ACTIVE', billingInterval: 'MONTHLY',
      amount: new Prisma.Decimal('29.0000'), currency: 'USD', trialEndsAt: null,
      currentPeriodEnd: new Date('2026-10-06T00:00:00.000Z'), cancelAtPeriodEnd: false, isCurrent: true,
      plan: { id: 'plan-a', key: 'team', name: 'Team' },
    }] as never);
    harness.platformInvoice.findFirst.mockResolvedValue(null);

    await harness.scheduler.reconcileTenant('tenant-a', now);

    expect(harness.platformInvoice.create).toHaveBeenCalledOnce();
    expect(harness.platformInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: 'tenant-a',
      invoiceNumber: 'SAAS-subscription-12345678-90ab-4cde-8fab-1234567890ab-20261006',
      status: 'OPEN',
      dueAt: new Date('2026-11-05T00:00:00.000Z'),
      lineSnapshot: expect.objectContaining({
        planKey: 'team', billingInterval: 'MONTHLY', periodStart: '2026-10-06T00:00:00.000Z', periodEnd: '2026-11-06T00:00:00.000Z',
      }),
    }) });
    expect(harness.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'platform.invoice.renewal_issued', actorType: 'SYSTEM' }));
  });

  it('marks due invoices and their current subscription past due', async () => {
    const harness = lifecycleHarness();
    harness.platformInvoice.findMany.mockResolvedValueOnce([{ id: 'invoice-a', subscriptionId: 'subscription-a' }] as never);
    harness.platformInvoice.updateMany.mockResolvedValue({ count: 1 });
    harness.tenantSubscription.updateMany.mockResolvedValue({ count: 1 });

    await harness.scheduler.reconcileTenant('tenant-a', now);

    expect(harness.platformInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAST_DUE' } }));
    expect(harness.tenantSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', id: 'subscription-a', isCurrent: true, status: 'ACTIVE' }, data: { status: 'PAST_DUE' },
    }));
    expect(harness.tenant.update).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, data: { subscriptionStatus: 'PAST_DUE' } });
  });

  it('suspends an active tenant only after an overdue invoice grace period', async () => {
    const harness = lifecycleHarness();
    harness.platformInvoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'invoice-a', subscriptionId: 'subscription-a' }] as never);
    harness.tenantSubscription.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'subscription-a' }] as never);
    harness.tenant.updateMany.mockResolvedValue({ count: 1 });

    await harness.scheduler.reconcileTenant('tenant-a', now);

    expect(harness.tenantSubscription.findMany).toHaveBeenNthCalledWith(2, {
      where: { tenantId: 'tenant-a', isCurrent: true, status: 'PAST_DUE' },
      select: { id: true },
    });
    expect(harness.platformInvoice.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a', subscriptionId: { in: ['subscription-a'] }, status: 'PAST_DUE' }),
    }));
    expect(harness.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-a', status: 'ACTIVE' }, data: { status: 'SUSPENDED', subscriptionStatus: 'PAST_DUE' },
    });
    expect(harness.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'platform.tenant.suspended_for_nonpayment', severity: 'WARN', actorType: 'SYSTEM',
    }));
  });
});
