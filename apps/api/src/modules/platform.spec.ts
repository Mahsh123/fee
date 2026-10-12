import { describe, expect, it, vi } from 'vitest';
import { resolveTxt } from 'node:dns/promises';
import { CORE_TENANT_MODULES, PERMISSIONS, SYSTEM_ROLE_NAMES } from '@fee/types';
import { createPlanSchema, provisionTenantIdempotencyKeySchema, provisionTenantSchema } from '@fee/validation';
import { Prisma } from '@fee/database';
import { TenantContextService } from '../common/tenancy';
import { PlatformService, TenantDomainDnsVerifier } from './platform';

vi.mock('node:dns/promises', () => ({ resolveTxt: vi.fn() }));

function platformService(options: {
  tenantFindFirst?: ReturnType<typeof vi.fn>;
  tenantFindUnique?: ReturnType<typeof vi.fn>;
  transactionWithRetry?: ReturnType<typeof vi.fn>;
  access?: Record<string, ReturnType<typeof vi.fn>>;
  db?: Record<string, unknown>;
  domainVerifier?: Pick<TenantDomainDnsVerifier, 'verify'>;
  dashboardMetrics?: ReturnType<typeof vi.fn>;
  organization?: Record<string, ReturnType<typeof vi.fn>>;
} = {}) {
  const context = new TenantContextService();
  const tenantDb = options.db?.tenant && typeof options.db.tenant === 'object' ? options.db.tenant as Record<string, unknown> : {};
  const userDb = options.db?.user && typeof options.db.user === 'object' ? options.db.user as Record<string, unknown> : {};
  const provisioningOperationDb = options.db?.tenantProvisioningOperation && typeof options.db.tenantProvisioningOperation === 'object' ? options.db.tenantProvisioningOperation as Record<string, unknown> : {};
  const prisma = {
    db: {
      ...(options.db ?? {}),
      tenant: {
        ...tenantDb,
        findFirst: options.tenantFindFirst ?? (tenantDb.findFirst as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue({ id: 'tenant-a' }),
        findUnique: options.tenantFindUnique ?? (tenantDb.findUnique as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue(null),
        count: (tenantDb.count as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue(0),
      },
      user: { ...userDb, count: (userDb.count as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue(0) },
      tenantProvisioningOperation: {
        ...provisioningOperationDb,
        findUnique: (provisioningOperationDb.findUnique as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue(null),
      },
    },
    transactionWithRetry: options.transactionWithRetry ?? vi.fn(),
    transaction: vi.fn(),
    platformDashboardMetrics: options.dashboardMetrics ?? vi.fn(async () => ({
      activePlans: 0, subscriptionsByCurrency: [], invoicesByCurrency: [], requestedRefundsByCurrency: [], domains: { verified: 0, pending: 0 },
    })),
  };
  const access = {
    listUsers: vi.fn(async () => ({ items: [], pagination: {} })),
    ...(options.access ?? {}),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const organization = {
    listBranches: vi.fn(async () => ({ items: [], pagination: {} })),
    createBranch: vi.fn(async () => ({ id: 'branch-new' })),
    updateBranch: vi.fn(async () => ({ id: 'branch-existing' })),
    replaceBranchMembers: vi.fn(async () => ({ branchId: 'branch-existing', userIds: [] })),
    ...(options.organization ?? {}),
  };
  const service = new PlatformService(
    prisma as never,
    { hash: vi.fn(async () => 'hashed-random-password'), generateToken: vi.fn().mockReturnValueOnce('tenant-admin-invitation-token').mockReturnValueOnce('generated-unused-password'), hashToken: vi.fn((token: string) => `hash:${token}`) } as never,
    audit as never,
    context,
    access as never,
    organization as never,
    { tenantBaseDomain: 'localhost', platformSubdomain: 'platform', platformHostname: 'platform.localhost', webAppUrl: 'http://platform.localhost:3000', isProduction: false, jwtSecret: 'test-platform-provisioning-hmac-secret', platformSubscriptionLifecycle: { invoiceDueDays: 30, graceDays: 7, pollIntervalMs: 60_000 } } as never,
    options.domainVerifier ?? new TenantDomainDnsVerifier(),
  );
  const runAsSuperAdmin = <T>(work: () => T) => context.run({
    tenantId: 'platform-tenant', userId: 'super-admin', roles: ['PLATFORM_ADMIN'], isPlatformAdmin: true,
    requestId: 'platform-admin-test-0001',
  }, work);
  return { service, context, prisma, access, organization, audit, runAsSuperAdmin };
}

describe('platform administration tenant boundaries', () => {
  it('validates workspace slug availability only for authenticated platform operators', async () => {
    const findUnique = vi.fn(async ({ where }: { where: { slug: string } }) => where.slug === 'taken-workspace' ? { id: 'tenant-existing' } : null);
    const { service, runAsSuperAdmin, context } = platformService({ tenantFindUnique: findUnique });

    await expect(runAsSuperAdmin(() => service.checkTenantSlugAvailability('available-workspace')))
      .resolves.toEqual({ slug: 'available-workspace', available: true, reason: null });
    await expect(runAsSuperAdmin(() => service.checkTenantSlugAvailability('taken-workspace')))
      .resolves.toEqual({ slug: 'taken-workspace', available: false, reason: 'in_use' });
    await expect(runAsSuperAdmin(() => service.checkTenantSlugAvailability('platform')))
      .resolves.toEqual({ slug: 'platform', available: false, reason: 'reserved' });
    await expect(context.run({ tenantId: 'tenant-a', userId: 'tenant-admin', roles: ['TENANT_ADMIN'], requestId: 'slug-check-auth' }, () => service.checkTenantSlugAvailability('available-workspace')))
      .rejects.toMatchObject({ status: 403 });
  });

  it('runs branch management in an explicitly selected tenant scope as an audited platform operator', async () => {
    const { service, context, organization, runAsSuperAdmin } = platformService();
    let branchScope: ReturnType<TenantContextService['peek']>;
    organization.listBranches.mockImplementation(async () => {
      branchScope = context.peek();
      return { items: [], pagination: {} };
    });

    await runAsSuperAdmin(() => service.listTenantBranches('tenant-a', { page: '1' }));

    expect(branchScope).toMatchObject({ tenantId: 'tenant-a', userId: 'super-admin', roles: ['PLATFORM_ADMIN'], isPlatformAdmin: true, actingAsTenantId: 'tenant-a' });
    expect(organization.listBranches).toHaveBeenCalledWith('tenant-a', { page: '1' });
  });

  it('refuses platform branch operations for non-platform users before entering tenant scope', async () => {
    const { service, context, organization } = platformService();

    await expect(context.run({ tenantId: 'tenant-a', userId: 'tenant-admin', roles: ['TENANT_ADMIN'], requestId: 'platform-branch-auth-test' }, () => service.listTenantBranches('tenant-a', {})))
      .rejects.toMatchObject({ status: 403 });
    expect(organization.listBranches).not.toHaveBeenCalled();
  });

  it('creates platform administrators as single-use invitations on the platform hostname', async () => {
    const userCreate = vi.fn(async (args: { data: Record<string, unknown>; select: Record<string, unknown> }) => ({
      id: 'operator-b', email: args.data.email, firstName: args.data.firstName, lastName: args.data.lastName,
      status: args.data.status, mustChangePassword: args.data.mustChangePassword, createdAt: new Date('2026-01-01'),
      invitationExpiresAt: args.data.invitationExpiresAt,
    }));
    const roleCreate = vi.fn(async () => ({}));
    const outboxCreate = vi.fn(async () => ({}));
    const transactionWithRetry = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
      role: { findFirst: vi.fn(async () => ({ id: 'platform-admin-role' })) },
      user: { create: userCreate },
      userRole: { create: roleCreate },
      outboxEvent: { create: outboxCreate },
    }));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    const created = await runAsSuperAdmin(() => service.createSuperAdmin({ email: 'operator@example.test', firstName: 'New', lastName: 'Admin' }));

    expect(created).toMatchObject({ status: 'INVITED', email: 'operator@example.test' });
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'INVITED', isPlatformAdmin: true, invitationTokenHash: 'hash:tenant-admin-invitation-token' }) }));
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'platform-tenant', eventType: 'USER_INVITATION', payload: expect.objectContaining({ acceptUrl: expect.stringContaining('platform.localhost:3000/accept-invitation#tenant-admin-invitation-token') }) }) }));
  });

  it('validates opaque tenant-provisioning idempotency keys', () => {
    expect(provisionTenantIdempotencyKeySchema.parse('tenant-provisioning-key-0001')).toBe('tenant-provisioning-key-0001');
    expect(() => provisionTenantIdempotencyKeySchema.parse('short')).toThrow();
    expect(() => provisionTenantIdempotencyKeySchema.parse('a key with spaces')).toThrow();
  });

  it('returns billing, refund, domain and plan health alongside tenant lifecycle counts', async () => {
    const dashboardMetrics = vi.fn(async () => ({
      activePlans: 3,
      subscriptionsByCurrency: [{ currency: 'USD', activeCount: 4, trialCount: 2, monthlyRecurringRevenue: '125.0000' }],
      invoicesByCurrency: [{ currency: 'USD', openCount: 2, overdueCount: 1, outstandingAmount: '50.0000' }],
      requestedRefundsByCurrency: [{ currency: 'USD', count: 1, amount: '10.0000' }],
      domains: { verified: 5, pending: 1 },
    }));
    const tenantCount = vi.fn(async ({ where }: { where: Record<string, unknown> }) => where.status ? 1 : 9);
    const superAdminCount = vi.fn(async () => 2);
    const { service, runAsSuperAdmin } = platformService({
      db: { tenant: { count: tenantCount }, user: { count: superAdminCount } }, dashboardMetrics,
    });

    const overview = await runAsSuperAdmin(() => service.overview());

    expect(dashboardMetrics).toHaveBeenCalledWith('platform-tenant');
    expect(overview).toMatchObject({
      totalTenants: 9, activeSuperAdmins: 2, activePlans: 3,
      subscriptionsByCurrency: [{ currency: 'USD', monthlyRecurringRevenue: '125.0000' }],
      invoicesByCurrency: [{ openCount: 2, overdueCount: 1, outstandingAmount: '50.0000' }],
      requestedRefundsByCurrency: [{ count: 1, amount: '10.0000' }], domains: { verified: 5, pending: 1 },
    });
  });

  it('reserves the platform subdomain during automatic slug generation and tenant edits', async () => {
    const tenantFindUnique = vi.fn().mockResolvedValue(null);
    const { service, runAsSuperAdmin } = platformService({ tenantFindUnique });
    const slug = await (service as unknown as { availableSlug(base: string, firstSuffix: number): Promise<string> }).availableSlug('platform', 1);

    expect(slug).toBe('platform-2');
    expect(tenantFindUnique).toHaveBeenCalledOnce();
    expect(tenantFindUnique).toHaveBeenCalledWith({ where: { slug: 'platform-2' }, select: { id: true } });
    await expect(runAsSuperAdmin(() => service.updateTenantProfile('tenant-a', { slug: 'platform' } as never)))
      .rejects.toMatchObject({ code: 'RESERVED_TENANT_SLUG' });
  });

  it('runs tenant user administration under the selected tenant context, without the platform bypass', async () => {
    const { service, context, access, runAsSuperAdmin } = platformService();
    access.listUsers = vi.fn(async () => ({ items: [], pagination: {} }));
    let scopedContext: ReturnType<TenantContextService['peek']>;
    access.listUsers.mockImplementation(async () => {
      scopedContext = context.peek();
      return { items: [], pagination: {} };
    });

    await runAsSuperAdmin(() => service.listTenantUsers('tenant-a', { page: '1' }));

    expect(access.listUsers).toHaveBeenCalledWith('tenant-a', { page: '1' });
    expect(scopedContext).toMatchObject({ tenantId: 'tenant-a', userId: 'super-admin', isPlatformAdmin: false, roles: [] });
  });

  it('hides missing tenants and never calls the tenant access service for them', async () => {
    const tenantFindFirst = vi.fn().mockResolvedValue(null);
    const listUsers = vi.fn();
    const { service, runAsSuperAdmin } = platformService({ tenantFindFirst, access: { listUsers } });

    await expect(runAsSuperAdmin(() => service.listTenantUsers('tenant-b', {}))).rejects.toMatchObject({ status: 404 });
    expect(listUsers).not.toHaveBeenCalled();
    expect(tenantFindFirst).toHaveBeenCalledWith({ where: { id: 'tenant-b', slug: { not: 'fee-platform' } }, select: { id: true } });
  });

  it('provisions a normalized subdomain and initial Tenant Admin atomically', async () => {
    const roles = ['TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_MEMBER', 'REPORT_VIEWER'].map((key) => ({ id: `role-${key}`, key }));
    const permissionRows = [...new Set(Object.values(PERMISSIONS))].map((key) => ({ id: `permission-${key}`, key }));
    const tenantCreate = vi.fn(async ({ data }: { data: { id: string; slug: string; name: string } }) => ({
      ...data,
      status: 'TRIAL', contactEmail: null, contactPhone: null, countryCode: null, trialEndsAt: null,
      subscriptionPlan: null, subscriptionStatus: 'TRIAL', subscriptionRenewalAt: null, createdAt: new Date('2026-10-06T00:00:00.000Z'),
    }));
    const userCreate = vi.fn(async ({ data }: { data: { tenantId: string; email: string } }) => ({ id: 'tenant-admin-id', email: data.email, tenantId: data.tenantId }));
    let savedOperation: Record<string, unknown> | null = null;
    const tx = {
      tenant: { create: tenantCreate, update: vi.fn() },
      plan: { findFirst: vi.fn(async () => ({ id: 'starter-plan', key: 'starter', monthlyPrice: 0, yearlyPrice: 0, currency: 'USD', trialDays: 14, modules: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS', 'ADMISSIONS', 'PORTAL'].map((moduleKey) => ({ moduleKey })) })) },
      tenantSubscription: { create: vi.fn() },
      permission: { findMany: vi.fn(async () => permissionRows) },
      tenantSettings: { create: vi.fn() },
      tenantBranding: { create: vi.fn() },
      tenantNumberingSettings: { create: vi.fn() },
      tenantModuleOverride: { createMany: vi.fn() },
      role: { createMany: vi.fn(), findMany: vi.fn(async () => roles) },
      rolePermission: { createMany: vi.fn() },
      user: { create: userCreate },
      userRole: { create: vi.fn() },
      userBranchMembership: { create: vi.fn() },
      branch: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'branch-main', ...data })) },
      ledgerAccount: { createMany: vi.fn() },
      paymentMethod: { createMany: vi.fn() },
      outboxEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
      tenantProvisioningOperation: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { savedOperation = data; return data; }) },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const operationFindUnique = vi.fn(async () => savedOperation);
    const { service, runAsSuperAdmin, prisma } = platformService({ transactionWithRetry, db: { tenantProvisioningOperation: { findUnique: operationFindUnique } } });
    const input = provisionTenantSchema.parse({
      name: '  ABC Academy  ',
      currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2, timezone: 'Asia/Kolkata', locale: 'en-IN',
      tenantAdminEmail: 'ADMIN@ABC-ACADEMY.TEST', tenantAdminFirstName: 'Alex', tenantAdminLastName: 'Admin',
    });

    const created = await runAsSuperAdmin(() => service.provisionTenant(input, 'tenant-provisioning-key-0001'));

    expect(transactionWithRetry).toHaveBeenCalledOnce();
    expect(tenantCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ slug: 'abc-academy', name: 'ABC Academy' }) }));
    expect(created).toMatchObject({ slug: 'abc-academy', tenantHost: 'abc-academy.localhost', tenantAdminEmail: 'admin@abc-academy.test', tenantAdminStatus: 'INVITED' });
    expect(tx.role.createMany).toHaveBeenCalledWith({ data: roles.map(({ key }) => ({ tenantId: created.id, key, name: SYSTEM_ROLE_NAMES[key as keyof typeof SYSTEM_ROLE_NAMES], isSystem: true, permissionsConfigured: true })) });
    expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: created.id }, data: expect.objectContaining({ enabledModules: [...CORE_TENANT_MODULES] }) });
    expect(tx.tenantModuleOverride.createMany).toHaveBeenCalledWith({ data: ['FEES', 'PAYMENTS', 'ADMISSIONS', 'PORTAL'].map((moduleKey) => ({ tenantId: created.id, moduleKey, enabled: false, reason: 'Not selected during workspace provisioning.', updatedBy: 'super-admin' })) });
    expect(tx.paymentMethod.createMany).not.toHaveBeenCalled();
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: created.id, email: 'admin@abc-academy.test', status: 'INVITED', mustChangePassword: true, invitationTokenHash: 'hash:tenant-admin-invitation-token', invitationExpiresAt: expect.any(Date) }) }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'USER_INVITATION', tenantId: created.id, aggregateId: 'tenant-admin-id', payload: expect.objectContaining({ email: 'admin@abc-academy.test', acceptUrl: 'http://abc-academy.localhost:3000/accept-invitation#tenant-admin-invitation-token' }) }) }));
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { tenantId: created.id, userId: 'tenant-admin-id', roleId: 'role-TENANT_ADMIN' } });
    expect(prisma.db.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'abc-academy' }, select: { id: true } });
    expect(tx.tenantProvisioningOperation.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(savedOperation)).not.toContain('tenant-admin-invitation-token');
    expect(JSON.stringify(savedOperation)).not.toContain('generated-unused-password');

    const replay = await runAsSuperAdmin(() => service.provisionTenant(input, 'tenant-provisioning-key-0001'));
    expect(replay).toMatchObject({ id: created.id, tenantHost: 'abc-academy.localhost', tenantAdminEmail: 'admin@abc-academy.test' });
    expect(transactionWithRetry).toHaveBeenCalledOnce();

    await expect(runAsSuperAdmin(() => service.provisionTenant({ ...input, name: 'A different organization' }, 'tenant-provisioning-key-0001')))
      .rejects.toMatchObject({ code: 'TENANT_PROVISION_IDEMPOTENCY_KEY_REUSED' });
    expect(transactionWithRetry).toHaveBeenCalledOnce();

    operationFindUnique.mockReset();
    operationFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(savedOperation);
    transactionWithRetry.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['actorId', 'idempotencyKey'] } });
    const concurrentReplay = await runAsSuperAdmin(() => service.provisionTenant(input, 'tenant-provisioning-key-0001'));
    expect(concurrentReplay).toMatchObject({ id: created.id, tenantHost: 'abc-academy.localhost' });
    expect(transactionWithRetry).toHaveBeenCalledTimes(2);
    expect(tenantCreate).toHaveBeenCalledOnce();
  });

  it('validates a unique module and entitlement plan contract', () => {
    expect(createPlanSchema.parse({
      key: 'team', name: 'Team', description: null, monthlyPrice: 29, yearlyPrice: 290, currency: 'USD', trialDays: 14, active: true,
      modules: [...CORE_TENANT_MODULES, 'CUSTOM'], entitlements: [{ entitlementKey: 'MAX_USERS', limitValue: 100 }],
    })).toMatchObject({ key: 'team', modules: [...CORE_TENANT_MODULES, 'CUSTOM'] });
    expect(() => createPlanSchema.parse({
      key: 'team', name: 'Team', monthlyPrice: 29, yearlyPrice: 290, currency: 'USD', trialDays: 14, active: true,
      modules: [...CORE_TENANT_MODULES, 'CUSTOM', 'CUSTOM'], entitlements: [],
    })).toThrow();
    expect(() => createPlanSchema.parse({
      key: 'team', name: 'Team', monthlyPrice: 29, yearlyPrice: 290, currency: 'USD', trialDays: 14, active: true,
      modules: ['FEES', 'PAYMENTS'], entitlements: [],
    })).toThrow(/core tenant modules/);
  });

  it('does not allow price or entitlement edits after a plan has subscription history', async () => {
    const findUnique = vi.fn(async () => ({ id: 'plan-a', key: 'team', name: 'Team', active: true, modules: [], entitlements: [] }));
    const count = vi.fn(async () => 2);
    const tx = { plan: { findUnique, update: vi.fn() }, tenantSubscription: { count } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await expect(runAsSuperAdmin(() => service.updatePlan('plan-a', { monthlyPrice: 20 })))
      .rejects.toMatchObject({ code: 'PLAN_TERMS_LOCKED' });
    expect(count).toHaveBeenCalledWith({ where: { planId: 'plan-a' } });
    expect(tx.plan.update).not.toHaveBeenCalled();
  });

  it('transitions only the current subscription and synchronizes tenant access state', async () => {
    const current = { id: 'subscription-a', tenantId: 'tenant-a', status: 'TRIAL', billingInterval: 'MONTHLY', isCurrent: true, trialEndsAt: new Date(), tenant: { slug: 'tenant-a' } };
    const findFirst = vi.fn(async () => current);
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data }));
    const tenantUpdate = vi.fn(async () => ({}));
    const tx = { tenantSubscription: { findFirst, update }, tenant: { update: tenantUpdate } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await runAsSuperAdmin(() => service.updateTenantSubscriptionStatus('subscription-a', { status: 'ACTIVE', reason: 'Payment confirmed' }));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'subscription-a' }, data: expect.objectContaining({
      status: 'ACTIVE', trialEndsAt: null, currentPeriodStart: expect.any(Date), currentPeriodEnd: expect.any(Date),
    }) }));
    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, data: { subscriptionStatus: 'ACTIVE', status: 'ACTIVE', trialEndsAt: null } });
  });

  it('rejects edits to historical subscription lifecycle records', async () => {
    const tx = { tenantSubscription: { findFirst: vi.fn(async () => ({ id: 'old-subscription', tenantId: 'tenant-a', status: 'ACTIVE', isCurrent: false, tenant: { slug: 'tenant-a' } })) } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await expect(runAsSuperAdmin(() => service.updateTenantSubscriptionStatus('old-subscription', { status: 'CANCELLED', reason: 'End old record' })))
      .rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_CURRENT' });
  });

  it('schedules and rescinds cancellation only for a current subscription with a future period end', async () => {
    const currentPeriodEnd = new Date(Date.now() + 86_400_000);
    const current = { id: 'subscription-a', tenantId: 'tenant-a', status: 'ACTIVE', isCurrent: true, cancelAtPeriodEnd: false, currentPeriodEnd };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data }));
    const tx = { tenantSubscription: { findFirst: vi.fn(async () => current), update } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin, audit } = platformService({ transactionWithRetry });

    await runAsSuperAdmin(() => service.updateTenantSubscriptionCancellation('subscription-a', {
      cancelAtPeriodEnd: true, reason: 'Customer requested cancellation',
    }));

    expect(update).toHaveBeenCalledWith({ where: { id: 'subscription-a' }, data: { cancelAtPeriodEnd: true } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'platform.subscription.cancellation_scheduled',
      after: { tenantId: 'tenant-a', cancelAtPeriodEnd: true, reason: 'Customer requested cancellation' },
    }));
  });

  it('issues one outstanding invoice for a current subscription and snapshots its terms', async () => {
    const subscription = {
      id: 'subscription-a', tenantId: 'tenant-a', isCurrent: true, billingInterval: 'MONTHLY',
      amount: new Prisma.Decimal('29.0000'), currency: 'USD', currentPeriodEnd: null,
      plan: { id: 'plan-a', key: 'team', name: 'Team' },
    };
    const invoice = { id: 'invoice-a', invoiceNumber: 'SAAS-SUBSCRIP-20261006-ABC123', status: 'OPEN', total: new Prisma.Decimal('29.0000'), dueAt: new Date('2026-11-05T00:00:00.000Z') };
    const create = vi.fn(async () => invoice);
    const tx = {
      tenantSubscription: { findFirst: vi.fn(async () => subscription) },
      platformInvoice: { findFirst: vi.fn(async () => null), create },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await runAsSuperAdmin(() => service.issuePlatformInvoice('tenant-a', 'subscription-a', {}));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'tenant-a', subscriptionId: 'subscription-a', status: 'OPEN', currency: 'USD',
      lineSnapshot: expect.objectContaining({ planKey: 'team', planName: 'Team', billingInterval: 'MONTHLY', unitAmount: '29' }),
    }) }));
  });

  it('records a full manual payment atomically and activates the subscription', async () => {
    const invoice = {
      id: 'invoice-a', tenantId: 'tenant-a', subscriptionId: 'subscription-a', status: 'OPEN',
      currency: 'USD', total: new Prisma.Decimal('29.0000'), payments: [],
      subscription: { isCurrent: true },
      lineSnapshot: { periodStart: '2026-10-06T00:00:00.000Z', periodEnd: '2026-11-06T00:00:00.000Z' },
    };
    const paymentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'payment-a', ...data }));
    const invoiceUpdate = vi.fn(async () => ({}));
    const subscriptionUpdate = vi.fn(async () => ({}));
    const tenantUpdate = vi.fn(async () => ({}));
    const tx = {
      platformInvoice: { findFirst: vi.fn(async () => invoice), update: invoiceUpdate },
      platformPayment: { findUnique: vi.fn(async () => null), create: paymentCreate },
      tenantSubscription: { update: subscriptionUpdate }, tenant: { update: tenantUpdate },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await runAsSuperAdmin(() => service.recordPlatformPayment('invoice-a', { amount: 29, idempotencyKey: 'payment-attempt-0001', providerPaymentId: 'bank-transfer-123' }));

    expect(paymentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-a', invoiceId: 'invoice-a', provider: 'MANUAL', status: 'SUCCEEDED', providerPaymentId: 'bank-transfer-123' }) });
    expect(invoiceUpdate).toHaveBeenCalledWith({ where: { id: 'invoice-a' }, data: expect.objectContaining({ status: 'PAID' }) });
    expect(subscriptionUpdate).toHaveBeenCalledWith({ where: { id: 'subscription-a' }, data: expect.objectContaining({ status: 'ACTIVE', currentPeriodEnd: new Date('2026-11-06T00:00:00.000Z') }) });
    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, data: expect.objectContaining({ status: 'ACTIVE', subscriptionStatus: 'ACTIVE' }) });
  });

  it('rejects a payment larger than an invoice balance', async () => {
    const tx = {
      platformInvoice: { findFirst: vi.fn(async () => ({
        id: 'invoice-a', tenantId: 'tenant-a', status: 'OPEN', currency: 'USD', total: new Prisma.Decimal('10'), payments: [],
        subscription: { isCurrent: true }, lineSnapshot: {},
      })) },
      platformPayment: { findUnique: vi.fn(async () => null), create: vi.fn() },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await expect(runAsSuperAdmin(() => service.recordPlatformPayment('invoice-a', { amount: 10.01, idempotencyKey: 'payment-attempt-0002' })))
      .rejects.toMatchObject({ code: expect.any(String) });
  });

  it('reserves and completes a refund only with a provider reference', async () => {
    const payment = { id: 'payment-a', tenantId: 'tenant-a', status: 'SUCCEEDED', amount: new Prisma.Decimal('30'), currency: 'USD', refunds: [] };
    const refund = { id: 'refund-a', tenantId: 'tenant-a', paymentId: 'payment-a', status: 'REQUESTED', amount: new Prisma.Decimal('12'), currency: 'USD', reason: 'Duplicate charge' };
    const refundCreate = vi.fn(async () => refund);
    const refundUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...refund, ...data }));
    const paymentFind = vi.fn(async () => ({ ...payment, refunds: [refund] }));
    const paymentUpdate = vi.fn(async () => ({}));
    const tx = { platformPayment: { findFirst: vi.fn(async () => payment), findUnique: paymentFind, update: paymentUpdate }, platformRefund: { create: refundCreate, findFirst: vi.fn(async () => refund), update: refundUpdate } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await runAsSuperAdmin(() => service.requestPlatformRefund('payment-a', { amount: 12, reason: 'Duplicate charge' }));
    await runAsSuperAdmin(() => service.updatePlatformRefundStatus('refund-a', { status: 'PROCESSED', externalRefundId: 'provider-refund-456' }));

    expect(refundCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-a', paymentId: 'payment-a', status: 'REQUESTED' }) });
    expect(refundUpdate).toHaveBeenCalledWith({ where: { id: 'refund-a' }, data: expect.objectContaining({ status: 'PROCESSED', externalRefundId: 'provider-refund-456' }) });
    expect(paymentUpdate).toHaveBeenCalledWith({ where: { id: 'payment-a' }, data: { status: 'PARTIALLY_REFUNDED' } });
  });

  it('returns effective modules and limits from the subscription plus audited overrides', async () => {
    const tenantFindFirst = vi.fn(async () => ({ id: 'tenant-a', enabledModules: ['USERS', 'FEES'] }));
    const { service, runAsSuperAdmin } = platformService({
      tenantFindFirst,
      db: {
        tenantSubscription: { findFirst: vi.fn(async () => ({ plan: {
          id: 'plan-a', key: 'starter', name: 'Starter', modules: [{ moduleKey: 'USERS', enabled: true }, { moduleKey: 'FEES', enabled: true }],
          entitlements: [{ entitlementKey: 'MAX_USERS', limitValue: 50 }],
        } })) },
        tenantModuleOverride: { findMany: vi.fn(async () => [{ moduleKey: 'FEES', enabled: false, reason: 'Customer request' }]) },
        tenantEntitlementOverride: { findMany: vi.fn(async () => []) },
        user: { count: vi.fn(async () => 21) }, branch: { count: vi.fn(async () => 2) },
      },
    });

    const result = await runAsSuperAdmin(() => service.getTenantFeatureAccess('tenant-a'));

    expect(result.modules.find(({ moduleKey }) => moduleKey === 'FEES')).toMatchObject({ planEnabled: true, enabled: false, override: { enabled: false, reason: 'Customer request' } });
    expect(result.entitlements.find(({ entitlementKey }) => entitlementKey === 'MAX_USERS')).toMatchObject({ planLimit: 50, limit: 50, usage: 21 });
  });

  it('updates a tenant module projection under tenant scope and records platform audit attribution', async () => {
    const overrideUpsert = vi.fn(async () => ({ id: 'override-a', enabled: false }));
    const tenantUpdate = vi.fn(async () => ({}));
    const tx = {
      tenantModuleOverride: { findUnique: vi.fn(async () => null), upsert: overrideUpsert, findMany: vi.fn(async () => [{ moduleKey: 'FEES', enabled: false }]) },
      tenantSubscription: { findFirst: vi.fn(async () => ({ plan: { modules: [{ moduleKey: 'USERS' }, { moduleKey: 'FEES' }] } })) },
      tenant: { findFirst: vi.fn(async () => ({ enabledModules: ['USERS', 'FEES'] })), update: tenantUpdate },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    const result = await runAsSuperAdmin(() => service.updateTenantModuleOverride('tenant-a', 'fees', { enabled: false, reason: 'Customer request' }));

    expect(overrideUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: 'tenant-a', moduleKey: 'FEES', enabled: false, reason: 'Customer request' }) }));
    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, data: { enabledModules: ['USERS'] } });
    expect(result).toMatchObject({ tenantId: 'tenant-a', moduleKey: 'FEES', enabled: false, enabledModules: ['USERS'] });
  });

  it('refuses to disable a required core workspace module', async () => {
    const { service, runAsSuperAdmin } = platformService();

    await expect(runAsSuperAdmin(() => service.updateTenantModuleOverride('tenant-a', 'users', { enabled: false, reason: 'Disable access' })))
      .rejects.toThrow(/Core workspace modules are always enabled/);
  });

  it('rejects a module override that would leave Fees enabled without Payments', async () => {
    const tenantUpdate = vi.fn();
    const tx = {
      tenantModuleOverride: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: 'override-payments' })),
        findMany: vi.fn(async () => [{ moduleKey: 'PAYMENTS', enabled: false }]),
      },
      tenantSubscription: { findFirst: vi.fn(async () => ({ plan: { modules: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS'].map((moduleKey) => ({ moduleKey, enabled: true })) } })) },
      tenant: { findFirst: vi.fn(async () => ({ enabledModules: [...CORE_TENANT_MODULES, 'FEES', 'PAYMENTS'] })), update: tenantUpdate },
    };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry });

    await expect(runAsSuperAdmin(() => service.updateTenantModuleOverride('tenant-a', 'payments', { enabled: false, reason: 'Remove payments' })))
      .rejects.toMatchObject({ code: 'MODULE_DEPENDENCY_REQUIRED' });
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it('creates DNS ownership challenges and verifies the exact current challenge before enabling a domain', async () => {
    const createdAt = new Date('2026-10-06T00:00:00.000Z');
    const domainCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'domain-a', tenantId: 'tenant-a', domain: 'portal.example.test', isPrimary: false,
      verifiedAt: null, createdAt, verificationToken: data.verificationToken as string,
    }));
    const domainFind = vi.fn(async () => ({
      id: 'domain-a', tenantId: 'tenant-a', domain: 'portal.example.test', isPrimary: false,
      verifiedAt: null, createdAt, verificationToken: 'f'.repeat(64),
    }));
    const domainUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'domain-a', tenantId: 'tenant-a', domain: 'portal.example.test', isPrimary: false,
      createdAt, ...data,
    }));
    const domainVerifier = { verify: vi.fn(async (_domain: string, _token: string) => true) };
    const tx = { tenantDomain: { create: domainCreate, findFirst: domainFind, update: domainUpdate } };
    const transactionWithRetry = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const { service, runAsSuperAdmin } = platformService({ transactionWithRetry, domainVerifier, db: { tenantDomain: { findFirst: domainFind } } });

    const created = await runAsSuperAdmin(() => service.createTenantDomain('tenant-a', { domain: '  Portal.Example.Test.  ' }));
    expect(created).toMatchObject({ domain: 'portal.example.test', verificationRecordName: '_fee-verification.portal.example.test' });
    expect(created.verificationRecordValue).toMatch(/^fee-platform-verification=[a-f0-9]{64}$/);
    expect(domainCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-a', domain: 'portal.example.test' }) });

    const verified = await runAsSuperAdmin(() => service.verifyTenantDomain('tenant-a', 'domain-a'));
    expect(domainVerifier.verify).toHaveBeenCalledWith('portal.example.test', 'f'.repeat(64));
    expect(verified).toMatchObject({ domain: 'portal.example.test', verified: true, verifiedAt: expect.any(Date), verificationRecordValue: null });
    expect(domainUpdate).toHaveBeenCalledWith({ where: { id: 'domain-a' }, data: { verifiedAt: expect.any(Date), verificationToken: null } });
  });

  it('checks the exact TXT ownership value and reports DNS absence separately from resolver failure', async () => {
    const verifier = new TenantDomainDnsVerifier();
    vi.mocked(resolveTxt).mockResolvedValueOnce([['fee-platform-verification=', 'expected-token']]);
    await expect(verifier.verify('portal.example.test', 'expected-token')).resolves.toBe(true);
    expect(resolveTxt).toHaveBeenCalledWith('_fee-verification.portal.example.test');

    const noRecord = Object.assign(new Error('No TXT records'), { code: 'ENODATA' });
    vi.mocked(resolveTxt).mockRejectedValueOnce(noRecord);
    await expect(verifier.verify('portal.example.test', 'expected-token')).resolves.toBe(false);

    const resolverUnavailable = Object.assign(new Error('DNS offline'), { code: 'ESERVFAIL' });
    vi.mocked(resolveTxt).mockRejectedValueOnce(resolverUnavailable);
    await expect(verifier.verify('portal.example.test', 'expected-token')).rejects.toMatchObject({ status: 503 });
  });

  it('rejects generated workspace hosts from custom domain registration', async () => {
    const create = vi.fn();
    const { service, runAsSuperAdmin } = platformService({
      transactionWithRetry: vi.fn(async (work: (tx: { tenantDomain: { create: typeof create } }) => Promise<unknown>) => work({ tenantDomain: { create } })),
    });

    await expect(runAsSuperAdmin(() => service.createTenantDomain('tenant-a', { domain: 'customer.localhost' })))
      .rejects.toMatchObject({ code: 'TENANT_DOMAIN_USES_PLATFORM_BASE' });
    expect(create).not.toHaveBeenCalled();
  });
});
