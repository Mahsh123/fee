import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth';
import { TenantContextService } from '../common/tenancy';

describe('authentication request audit context', () => {
  it('registers on the resolved tenant host with a basic role, branch scope, expiring invite, and audit event', async () => {
    const auditRecord = vi.fn(async () => undefined);
    const userCreate = vi.fn(async ({ data }: { data: { id: string; email: string; firstName: string } }) => data);
    const roleCreate = vi.fn(async () => ({}));
    const branchMembershipCreate = vi.fn(async () => ({}));
    const outboxCreate = vi.fn(async () => ({}));
    const roleFindFirst = vi.fn(async () => ({ id: 'role-member', permissionsConfigured: false, rolePermissions: [] }));
    const tx = {
      tenantSettings: { findUnique: vi.fn(async () => ({ allowPublicRegistration: true })) },
      tenantSubscription: { findFirst: vi.fn(async () => null) },
      role: { findFirst: roleFindFirst },
      branch: { findFirst: vi.fn(async () => ({ id: 'branch-a' })) },
      user: { create: userCreate, count: vi.fn(async () => 0) },
      userRole: { create: roleCreate },
      userBranchMembership: { create: branchMembershipCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      db: { tenantSettings: { findUnique: vi.fn(async () => ({ allowPublicRegistration: true })) } },
      transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const tenantContext = new TenantContextService();
    const service = new AuthService(
      prisma as never,
      { hash: vi.fn(async () => 'random-password-hash'), hashToken: vi.fn(() => 'registration-token-hash'), generateToken: vi.fn(() => 'one-time-registration-token') } as never,
      {} as never,
      { record: auditRecord } as never,
      { webAppUrl: 'http://platform.localhost:8080', isProduction: false } as never,
      tenantContext,
    );
    const tenantHost = { kind: 'tenant' as const, hostname: 'cedar.localhost', baseDomain: 'localhost', tenantId: 'tenant-cedar', slug: 'cedar', name: 'Cedar Club', status: 'ACTIVE' as const };

    const result = await tenantContext.run({ requestId: 'public-register-0001', tenantHost }, () =>
      service.requestTenantRegistration({ email: 'new@example.test', firstName: 'New', lastName: 'Member' }, { ip: '203.0.113.44', userAgent: 'registration-test' }),
    );

    expect(result).toEqual({ submitted: true });
    expect(prisma.db.tenantSettings.findUnique).toHaveBeenCalledWith({ where: { tenantId: 'tenant-cedar' }, select: { allowPublicRegistration: true } });
    expect(roleFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-cedar', key: 'TENANT_MEMBER', active: true } }));
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-cedar', status: 'INVITED', invitationTokenHash: 'registration-token-hash', passwordHash: 'random-password-hash' }) }));
    const createdUserId = userCreate.mock.calls[0]![0].data.id;
    expect(roleCreate).toHaveBeenCalledWith({ data: { tenantId: 'tenant-cedar', userId: createdUserId, roleId: 'role-member' } });
    expect(branchMembershipCreate).toHaveBeenCalledWith({ data: { tenantId: 'tenant-cedar', userId: createdUserId, branchId: 'branch-a', isPrimary: true } });
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'USER_INVITATION', payload: expect.objectContaining({ acceptUrl: 'http://cedar.localhost:8080/accept-invitation#one-time-registration-token' }) }) }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'tenant-cedar', action: 'auth.registration.requested', actorId: null, requestId: 'public-register-0001' }));
  });

  it('does not create accounts when public registration is disabled', async () => {
    const userCreate = vi.fn();
    const prisma = { db: { tenantSettings: { findUnique: vi.fn(async () => ({ allowPublicRegistration: false })) } }, transactionWithRetry: vi.fn() };
    const tenantContext = new TenantContextService();
    const service = new AuthService(prisma as never, {} as never, {} as never, {} as never, {} as never, tenantContext);
    const tenantHost = { kind: 'tenant' as const, hostname: 'cedar.localhost', baseDomain: 'localhost', tenantId: 'tenant-cedar', slug: 'cedar', name: 'Cedar Club', status: 'ACTIVE' as const };

    await expect(tenantContext.run({ requestId: 'public-register-disabled', tenantHost }, () =>
      service.requestTenantRegistration({ email: 'new@example.test', firstName: 'New' }, {}),
    )).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE' });
    expect(userCreate).not.toHaveBeenCalled();
    expect(prisma.transactionWithRetry).not.toHaveBeenCalled();
  });

  it('accepts a live tenant invitation once, verifies the address, and stores only a password hash', async () => {
    const auditRecord = vi.fn(async () => undefined);
    const userFindFirst = vi.fn(async () => ({ id: 'user-a', email: 'invitee@example.test', status: 'INVITED' }));
    const userUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { user: { findFirst: userFindFirst, updateMany: userUpdateMany } };
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
    const tenantContext = new TenantContextService();
    const service = new AuthService(
      prisma as never,
      { hash: vi.fn(async () => 'new-password-hash'), hashToken: vi.fn(() => 'sha256-invitation-token') } as never,
      {} as never, { record: auditRecord } as never, {} as never, tenantContext,
    );
    const tenantHost = { kind: 'tenant' as const, hostname: 'north.example.test', baseDomain: 'example.test', tenantId: 'tenant-a', slug: 'north', name: 'North', status: 'ACTIVE' as const };

    const result = await tenantContext.run({ requestId: 'invite-accept-0001', tenantHost }, () =>
      service.acceptInvitation({ token: 'clear-once-token', password: 'correct horse battery staple' }, { ip: '203.0.113.5' }),
    );

    expect(result).toEqual({ accepted: true });
    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', invitationTokenHash: 'sha256-invitation-token', status: 'INVITED' }) }));
    expect(userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a', id: 'user-a', invitationTokenHash: 'sha256-invitation-token' }),
      data: expect.objectContaining({ status: 'ACTIVE', emailVerifiedAt: expect.any(Date), invitationTokenHash: null, invitationExpiresAt: null, passwordHash: 'new-password-hash' }),
    }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'tenant-a', actorId: 'user-a', action: 'auth.invitation.accepted', requestId: 'invite-accept-0001' }));
  });

  it('rejects an expired or replaced tenant invitation without activating an account', async () => {
    const userFindFirst = vi.fn(async () => null);
    const userUpdateMany = vi.fn();
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: { user: { findFirst: typeof userFindFirst; updateMany: typeof userUpdateMany } }) => Promise<unknown>) => work({ user: { findFirst: userFindFirst, updateMany: userUpdateMany } })) };
    const context = new TenantContextService();
    const service = new AuthService(prisma as never, { hash: vi.fn(async () => 'hash'), hashToken: vi.fn(() => 'expired-hash') } as never, {} as never, {} as never, {} as never, context);
    const tenantHost = { kind: 'tenant' as const, hostname: 'north.example.test', baseDomain: 'example.test', tenantId: 'tenant-a', slug: 'north', name: 'North', status: 'ACTIVE' as const };
    await expect(context.run({ requestId: 'invite-expired-0001', tenantHost }, () => service.acceptInvitation({ token: 'old-token-value-long-enough-to-pass', password: 'correct horse battery staple' }, {}))).rejects.toMatchObject({ status: 422 });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('accepts a platform invitation only on the reserved platform host and verifies the platform account', async () => {
    const auditRecord = vi.fn(async () => undefined);
    const userFindFirst = vi.fn(async () => ({ id: 'operator-a', email: 'operator@example.test', status: 'INVITED' }));
    const userUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { user: { findFirst: userFindFirst, updateMany: userUpdateMany } };
    const prisma = {
      db: { tenant: { findUnique: vi.fn(async () => ({ id: 'platform-tenant', status: 'ACTIVE' })) } },
      transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const context = new TenantContextService();
    const service = new AuthService(
      prisma as never,
      { hash: vi.fn(async () => 'new-password-hash'), hashToken: vi.fn(() => 'sha256-platform-invitation') } as never,
      {} as never, { record: auditRecord } as never, {} as never, context,
    );
    const platformHost = { kind: 'platform' as const, hostname: 'platform.localhost', baseDomain: 'localhost' };

    await context.run({ requestId: 'platform-invite-accept-0001', tenantHost: platformHost }, () =>
      service.acceptInvitation({ token: 'platform-once-token', password: 'correct horse battery staple' }, {}),
    );

    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'platform-tenant', isPlatformAdmin: true, status: 'INVITED' }) }));
    expect(userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'platform-tenant', isPlatformAdmin: true }) }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'platform-tenant', action: 'auth.invitation.accepted' }));
  });

  it('keeps the old email until the signed-in user verifies the new address', async () => {
    const auditRecord = vi.fn(async () => undefined);
    const outboxCreate = vi.fn(async () => ({}));
    const current = {
      id: 'user-a', tenantId: 'tenant-a', email: 'old@example.test', firstName: 'Asha', status: 'ACTIVE',
      isPlatformAdmin: false, emailVerifiedAt: new Date('2026-01-01'), passwordHash: 'current-hash', updatedAt: new Date('2026-05-01'),
    };
    const findFirst = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { user: { findFirst, updateMany }, outboxEvent: { create: outboxCreate } };
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
    const context = new TenantContextService();
    const service = new AuthService(
      prisma as never,
      { verify: vi.fn(async () => true), generateToken: vi.fn(() => 'new-email-verification-token'), hashToken: vi.fn(() => 'new-email-token-hash') } as never,
      {} as never, { record: auditRecord } as never, { webAppUrl: 'https://platform.example.test', isProduction: true } as never, context,
    );
    const host = { kind: 'tenant' as const, hostname: 'north.example.test', baseDomain: 'example.test', tenantId: 'tenant-a', slug: 'north', name: 'North', status: 'ACTIVE' as const };

    const result = await context.run({ tenantId: 'tenant-a', userId: 'user-a', requestId: 'email-change-request-0001', tenantHost: host }, () =>
      service.requestOwnEmailChange('user-a', 'tenant-a', { email: 'new@example.test', currentPassword: 'current-password' }, { ip: '203.0.113.20' }),
    );

    expect(result.pendingEmail).toBe('new@example.test');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pendingEmail: 'new@example.test', emailChangeTokenHash: 'new-email-token-hash' }) }));
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'USER_EMAIL_VERIFICATION', payload: expect.objectContaining({ email: 'new@example.test', acceptUrl: expect.stringContaining('https://north.example.test/verify-email-change#new-email-verification-token') }) }) }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'auth.email_change.requested', after: expect.objectContaining({ pendingEmail: 'new@example.test' }) }));
  });

  it('verifies the pending email on its matching host and revokes existing refresh sessions', async () => {
    const auditRecord = vi.fn(async () => undefined);
    const current = { id: 'user-a', email: 'old@example.test', pendingEmail: 'new@example.test' };
    const userUpdateMany = vi.fn(async () => ({ count: 1 }));
    const refreshUpdateMany = vi.fn(async () => ({ count: 2 }));
    const tx = { user: { findFirst: vi.fn(async () => current), updateMany: userUpdateMany }, refreshToken: { updateMany: refreshUpdateMany } };
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
    const context = new TenantContextService();
    const service = new AuthService(prisma as never, { hashToken: vi.fn(() => 'email-change-token-hash') } as never, {} as never, { record: auditRecord } as never, {} as never, context);
    const host = { kind: 'tenant' as const, hostname: 'north.example.test', baseDomain: 'example.test', tenantId: 'tenant-a', slug: 'north', name: 'North', status: 'ACTIVE' as const };

    await expect(context.run({ requestId: 'email-change-accept-0001', tenantHost: host }, () => service.acceptEmailChange({ token: 'single-use-email-change-token' }, {})))
      .resolves.toEqual({ accepted: true, email: 'new@example.test' });

    expect(userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', emailChangeTokenHash: 'email-change-token-hash' }), data: expect.objectContaining({ email: 'new@example.test', pendingEmail: null, emailChangeTokenHash: null, sessionVersion: { increment: 1 } }) }));
    expect(refreshUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', userId: 'user-a', revokedAt: null } }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'auth.email_change.verified', after: { email: 'new@example.test', emailVerified: true } }));
  });

  it('updates only the signed-in user profile and writes a tenant-scoped audit record', async () => {
    const current = { id: 'user-a', tenantId: 'tenant-a', email: 'user@example.test', firstName: 'Before', lastName: null, phone: null, status: 'ACTIVE', deletedAt: null, updatedAt: new Date('2026-01-01T00:00:00Z') };
    const updated = { id: 'user-a', email: 'user@example.test', firstName: 'After', lastName: 'Person', phone: '+1-555-0100' };
    const userUpdateMany = vi.fn(async () => ({ count: 1 }));
    const auditRecord = vi.fn(async () => undefined);
    const tx = { user: { findFirst: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated), updateMany: userUpdateMany } };
    const prisma = { transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
    const context = new TenantContextService();
    const service = new AuthService(prisma as never, {} as never, {} as never, { record: auditRecord } as never, {} as never, context);

    const saved = await context.run({ tenantId: 'tenant-a', userId: 'user-a', roles: [], requestId: 'profile-update-0001' }, () =>
      service.updateOwnProfile('user-a', 'tenant-a', { firstName: 'After', lastName: 'Person', phone: '+1-555-0100' }, { ip: '203.0.113.9' }),
    );

    expect(saved).toEqual(updated);
    expect(userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', id: 'user-a' }), data: expect.objectContaining({ firstName: 'After', updatedBy: 'user-a' }) }));
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'tenant-a', actorId: 'user-a', action: 'auth.profile.updated', requestId: 'profile-update-0001', ipAddress: '203.0.113.9' }));
  });

  it('rejects profile changes for a different user even inside the same tenant', async () => {
    const transactionWithRetry = vi.fn();
    const context = new TenantContextService();
    const service = new AuthService({ transactionWithRetry } as never, {} as never, {} as never, {} as never, {} as never, context);

    await expect(context.run({ tenantId: 'tenant-a', userId: 'user-a', requestId: 'profile-owner-check' }, () =>
      service.updateOwnProfile('user-b', 'tenant-a', { firstName: 'Changed' }, {}),
    )).rejects.toMatchObject({ status: 403 });
    expect(transactionWithRetry).not.toHaveBeenCalled();
  });

  it('preserves the originating request ID through the tenant-scoped login flow', async () => {
    const refreshTokenCreate = vi.fn(async () => ({}));
    const auditRecord = vi.fn(async (_transaction: unknown, _input: Record<string, unknown>) => undefined);
    const prisma = {
      db: {
        tenant: {
          findUnique: vi.fn(async () => ({ id: 'tenant-a', slug: 'north-school', name: 'North School', status: 'ACTIVE' })),
        },
        user: {
          findFirst: vi.fn(async () => ({
            id: 'user-a',
            tenantId: 'tenant-a',
            email: 'cashier@example.test',
            firstName: 'Sam',
            lastName: null,
            passwordHash: 'stored-hash',
            status: 'ACTIVE',
            failedLoginCount: 0,
            lockedUntil: null,
            isPlatformAdmin: false,
            studentId: null,
            mustChangePassword: false,
          })),
          update: vi.fn(async () => ({})),
        },
        userRole: { findMany: vi.fn(async () => [{ roleId: 'role-a' }]) },
        role: { findMany: vi.fn(async () => [{ id: 'role-a', key: 'REPORT_VIEWER', permissionsConfigured: true }]) },
        rolePermission: {
          findMany: vi.fn(async () => [{ roleId: 'role-a', permissionId: 'permission-a' }]),
        },
        permission: { findMany: vi.fn(async () => [{ id: 'permission-a', key: 'reports.read' }]) },
      },
      transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) =>
        work({ refreshToken: { create: refreshTokenCreate } }),
      ),
    };
    const passwords = {
      verify: vi.fn(async () => true),
      hashToken: vi.fn(() => 'hashed-refresh-token'),
    };
    const tokens = {
      signRefreshToken: vi.fn(async () => 'refresh-token'),
      signAccessToken: vi.fn(async () => 'access-token'),
    };
    const config = { jwtAccessTtlSeconds: 900, jwtRefreshTtlSeconds: 2_592_000 };
    const tenantContext = new TenantContextService();
    const service = new AuthService(prisma as never, passwords as never, tokens as never, { record: auditRecord } as never, config as never, tenantContext);

    const session = await tenantContext.run({
      requestId: 'request-login-0001',
      isPlatformAdmin: false,
      tenantHost: { kind: 'tenant', hostname: 'north-school.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'north-school', name: 'North School', status: 'ACTIVE' },
    }, () =>
      service.login(
        { email: 'cashier@example.test', password: 'valid-password' },
        { ip: '203.0.113.7', userAgent: 'auth-context-test' },
      ),
    );

    expect(session.user.roles).toEqual(['REPORT_VIEWER']);
    expect(session.user.permissions).toEqual(['reports.read']);
    expect(prisma.db.rolePermission.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', roleId: { in: ['role-a'] } },
      select: { roleId: true, permissionId: true },
    });
    expect(prisma.db.permission.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['permission-a'] } },
      select: { id: true, key: true },
    });

    const loginAudit = auditRecord.mock.calls.find(([, input]) => input.action === 'auth.login')?.[1];
    expect(loginAudit).toMatchObject({
      tenantId: 'tenant-a',
      requestId: 'request-login-0001',
      ipAddress: '203.0.113.7',
      userAgent: 'auth-context-test',
    });
    expect(refreshTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }) }),
    );
  });

  it('rejects refresh tokens presented on a different tenant hostname before reading token records', async () => {
    const refreshTokenFind = vi.fn(async () => null);
    const tenantContext = new TenantContextService();
    const service = new AuthService(
      { db: { refreshToken: { findUnique: refreshTokenFind } } } as never,
      {} as never,
      { verifyRefreshToken: vi.fn(async () => ({ sub: 'user-a', tid: 'tenant-a', jti: 'token-a' })) } as never,
      {} as never,
      {} as never,
      tenantContext,
    );
    const tenantB = { kind: 'tenant' as const, hostname: 'school.localhost', baseDomain: 'localhost', tenantId: 'tenant-b', slug: 'school', name: 'School', status: 'ACTIVE' as const };

    await expect(tenantContext.run({ requestId: 'refresh-host-binding', tenantHost: tenantB, isPlatformAdmin: false }, () =>
      service.refresh({ refreshToken: 'signed-refresh-token' }, {}),
    )).rejects.toThrow('This session does not belong to an active workspace on this hostname.');
    expect(refreshTokenFind).not.toHaveBeenCalled();
  });

  it('rejects a tenant account refresh on the platform hostname', async () => {
    const tenantContext = new TenantContextService();
    const tenantFindUnique = vi.fn()
      .mockResolvedValueOnce({ id: 'platform-tenant' })
      .mockResolvedValueOnce({ slug: 'fee-platform', name: 'Platform' });
    const userFindFirst = vi.fn(async () => ({
      id: 'user-a', tenantId: 'platform-tenant', email: 'user@example.test', status: 'ACTIVE', deletedAt: null,
      isPlatformAdmin: false, sessionVersion: 0, studentId: null, guardianId: null, mustChangePassword: false,
      firstName: 'Tenant', lastName: 'User', phone: null,
    }));
    const refreshFindUnique = vi.fn(async () => ({ id: 'refresh-a', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }));
    const resolveRoles = vi.fn(async () => []);
    const service = new AuthService(
      { db: { tenant: { findUnique: tenantFindUnique }, user: { findFirst: userFindFirst }, refreshToken: { findUnique: refreshFindUnique }, userRole: { findMany: resolveRoles } } } as never,
      { hashToken: vi.fn(() => 'token-hash') } as never,
      { verifyRefreshToken: vi.fn(async () => ({ sub: 'user-a', tid: 'platform-tenant', jti: 'refresh-a' })) } as never,
      {} as never,
      {} as never,
      tenantContext,
    );
    const platformHost = { kind: 'platform' as const, hostname: 'platform.localhost', baseDomain: 'localhost' };

    await expect(tenantContext.run({ requestId: 'refresh-platform-binding', tenantHost: platformHost }, () =>
      service.refresh({ refreshToken: 'signed-refresh-token' }, {}),
    )).rejects.toThrow('This session is no longer valid for this hostname. Please sign in again.');
    expect(refreshFindUnique).toHaveBeenCalledOnce();
  });
});
