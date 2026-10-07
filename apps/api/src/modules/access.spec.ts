import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { AccessService } from './access';

describe('tenant user seat entitlements', () => {
  function seatCheck(currentUsers: number, planLimit: number | null, tenantOverride: number | null | undefined) {
    const service = new AccessService({} as never, {} as never, {} as never, new TenantContextService());
    const tx = {
      tenantSubscription: { findFirst: vi.fn(async () => ({ planId: 'plan-a' })) },
      user: { count: vi.fn(async () => currentUsers) },
      planEntitlement: { findFirst: vi.fn(async () => ({ limitValue: planLimit })) },
      tenantEntitlementOverride: { findFirst: vi.fn(async () => tenantOverride === undefined ? null : ({ limitValue: tenantOverride })) },
    };
    return (service as unknown as { assertSeatAvailable(tx: never, tenantId: string): Promise<void> }).assertSeatAvailable(tx as never, 'tenant-a');
  }

  it('blocks a user create when active seats have reached the current plan limit', async () => {
    await expect(seatCheck(50, 50, undefined)).rejects.toMatchObject({ code: 'TENANT_LIMIT_REACHED' });
  });

  it('honors tenant overrides and explicit unlimited access', async () => {
    await expect(seatCheck(50, 50, 60)).resolves.toBeUndefined();
    await expect(seatCheck(500, 50, null)).resolves.toBeUndefined();
  });

  it('does not reject a user while seats remain', async () => {
    await expect(seatCheck(49, 50, undefined)).resolves.toBeUndefined();
  });
});

describe('tenant role administration boundaries', () => {
  const service = (context: TenantContextService) => new AccessService({} as never, {} as never, {} as never, context);

  it('restricts tenant-wide role configuration and administrator grants to tenant administrators', async () => {
    const context = new TenantContextService();
    const access = service(context) as unknown as {
      assertTenantAdministratorActor(): void;
      assertMayAssignTenantAdministratorRole(roleKeys: string[]): void;
      assertMayManageTenantAdministratorRoles(roleKeys: string[]): void;
    };
    await context.run({ requestId: 'branch-admin-role-boundary', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', userId: 'branch-user', isPlatformAdmin: false, roles: ['BRANCH_MANAGER'] });
      expect(() => access.assertTenantAdministratorActor()).toThrow(/Only a tenant administrator/);
      expect(() => access.assertMayAssignTenantAdministratorRole(['TENANT_ADMIN'])).toThrow(/Only a tenant administrator/);
      expect(() => access.assertMayManageTenantAdministratorRoles(['TENANT_OWNER'])).toThrow(/Only a tenant administrator/);
      expect(() => access.assertMayAssignTenantAdministratorRole(['BRANCH_MANAGER'])).not.toThrow();
    });
    await context.run({ requestId: 'tenant-admin-role-boundary', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', userId: 'tenant-admin', isPlatformAdmin: false, roles: ['TENANT_ADMIN'] });
      expect(() => access.assertTenantAdministratorActor()).not.toThrow();
      expect(() => access.assertMayAssignTenantAdministratorRole(['TENANT_OWNER'])).not.toThrow();
      expect(() => access.assertMayManageTenantAdministratorRoles(['TENANT_ADMIN'])).not.toThrow();
    });
  });
});

describe('tenant user invitations', () => {
  it('creates a pending scoped user and transactionally queues a tenant-host acceptance link', async () => {
    const context = new TenantContextService();
    const createdUser = { id: 'user-new', email: 'person@example.test', firstName: 'Taylor', status: 'INVITED', createdAt: new Date() };
    const userCreate = vi.fn(async (args: { data: { id: string } }) => ({ ...createdUser, id: args.data.id }));
    const outboxCreate = vi.fn(async (args: { data: Record<string, unknown> }) => args.data);
    const tx = {
      user: { create: userCreate },
      userRole: { createMany: vi.fn(async () => ({ count: 1 })) },
      branch: { findFirst: vi.fn(async () => ({ id: 'branch-main' })) },
      userBranchMembership: { create: vi.fn(async () => ({})) },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
    const passwords = {
      hash: vi.fn(async () => 'unusable-random-password-hash'),
      generateToken: vi.fn().mockReturnValueOnce('random-password-which-is-never-disclosed').mockReturnValueOnce('single-use-invitation-token'),
      hashToken: vi.fn(() => 'invitation-hash'),
    };
    const service = new AccessService(
      prisma as never, passwords as never, { record: vi.fn(async () => undefined) } as never, context,
      { webAppUrl: 'http://platform.localhost:3000', isProduction: false } as never,
    );
    const internals = service as unknown as {
      assertSeatAvailable: () => Promise<void>;
      assertRoleIds: () => Promise<Array<{ id: string; key: string; name: string }>>;
      assertPortalIdentity: () => Promise<void>;
    };
    internals.assertSeatAvailable = vi.fn(async () => undefined);
    internals.assertRoleIds = vi.fn(async () => [{ id: 'role-staff', key: 'STAFF', name: 'Staff' }]);
    internals.assertPortalIdentity = vi.fn(async () => undefined);
    const host = { kind: 'tenant' as const, hostname: 'north.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'north', name: 'North Workspace', status: 'ACTIVE' as const };

    const result = await context.run({ tenantId: 'tenant-a', userId: 'admin-a', requestId: 'user-invite-0001', tenantHost: host }, () => service.inviteUser('tenant-a', {
      email: 'person@example.test', firstName: 'Taylor', lastName: null, roleIds: ['role-staff'],
    }));

    expect(result).toMatchObject({ email: 'person@example.test', status: 'INVITED' });
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a', status: 'INVITED', invitationTokenHash: 'invitation-hash', mustChangePassword: true }) }));
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      eventType: 'USER_INVITATION', tenantId: 'tenant-a', aggregateId: result.id,
      payload: expect.objectContaining({ email: 'person@example.test', acceptUrl: 'http://north.localhost:3000/accept-invitation#single-use-invitation-token', tokenHash: 'invitation-hash' }),
    }) }));
  });
});
