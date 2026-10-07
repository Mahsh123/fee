import { describe, expect, it, vi } from 'vitest';
import {
  assertTenantBrandingMigration,
  resolveDevelopmentTenantAdminCredentials,
  seedDevelopmentTenantRecords,
} from '../../../../scripts/seed-development-tenants';

const brandingColumns = ['logoUrl', 'landingTitle', 'landingDescription', 'landingActionLabel'];
const adminSeeds = {
  demo: { email: 'admin@demo-academy.test', passwordHash: 'demo-hash' },
  school: { email: 'admin@northstar.test', passwordHash: 'school-hash' },
  academy: { email: 'admin@greenfield-academy.test', passwordHash: 'academy-hash' },
  gym: { email: 'manager@northstar-fitness.test', passwordHash: 'gym-hash' },
} as const;

describe('development tenant seed safety', () => {
  it('accepts the physical tenant_branding table after the landing migration', async () => {
    const queryRaw = vi.fn().mockResolvedValue(brandingColumns.map((column_name) => ({ column_name })));
    await expect(assertTenantBrandingMigration({ $queryRaw: queryRaw } as never).then(() => undefined)).resolves.toBeUndefined();
    expect(queryRaw.mock.calls[0]?.[0]?.join('')).toContain("table_name = 'tenant_branding'");
  });

  it('fails with an actionable migration message when required columns are absent', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ column_name: 'logoUrl' }]);
    await expect(assertTenantBrandingMigration({ $queryRaw: queryRaw } as never))
      .rejects.toThrow(/requires the tenant landing branding migration.*landingTitle/);
  });

  it('preserves database permission and connectivity failures for accurate diagnosis', async () => {
    const failure = new Error('database connection unavailable');
    const queryRaw = vi.fn().mockRejectedValue(failure);
    await expect(assertTenantBrandingMigration({ $queryRaw: queryRaw } as never)).rejects.toBe(failure);
  });

  it('normalizes each configured admin email and requires a strong shared development password', () => {
    expect(resolveDevelopmentTenantAdminCredentials({})).toBeUndefined();
    expect(resolveDevelopmentTenantAdminCredentials({
      demoEmail: ' Demo@Example.Test ',
      schoolEmail: 'School@Example.Test',
      academyEmail: 'ACADEMY@Example.Test',
      gymEmail: 'GYM@Example.Test',
      password: 'long-enough-password',
    })).toEqual({
      demo: { email: 'demo@example.test', password: 'long-enough-password' },
      school: { email: 'school@example.test', password: 'long-enough-password' },
      academy: { email: 'academy@example.test', password: 'long-enough-password' },
      gym: { email: 'gym@example.test', password: 'long-enough-password' },
    });
    expect(() => resolveDevelopmentTenantAdminCredentials({ password: 'too-short' })).toThrow(/at least 12 characters/);
    expect(() => resolveDevelopmentTenantAdminCredentials({ demoEmail: 'not-an-email', password: 'long-enough-password' }))
      .toThrow(/valid email address/);
  });

  function makeClient(existingAdmins = false, portalAccount = false) {
    const transaction = {
      tenant: { upsert: vi.fn(async ({ where }: { where: { slug: string } }) => ({ id: `id-${where.slug}` })) },
      tenantBranding: { upsert: vi.fn().mockResolvedValue({}) },
      role: {
        upsert: vi.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => ({
          id: `${where.tenantId_key.key === 'TENANT_ADMIN' ? 'admin' : 'member'}-${where.tenantId_key.tenantId}`,
        })),
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({
          key: id.startsWith('admin-') ? 'TENANT_ADMIN' : 'TENANT_MEMBER',
        }))),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { tenantId_email: { tenantId: string; email: string } } }) =>
          existingAdmins ? { id: `existing-${where.tenantId_email.tenantId}`, studentId: portalAccount ? 'student-linked' : null, guardianId: null, isPlatformAdmin: false } : null),
        create: vi.fn(async ({ data }: { data: { tenantId: string } }) => ({ id: `user-${data.tenantId}` })),
      },
      userRole: {
        findMany: vi.fn(async ({ where }: { where: { userId: string } }) => existingAdmins ? [{ roleId: `admin-${where.userId.replace('existing-', '')}` }] : []),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const client = {
      $queryRaw: vi.fn().mockResolvedValue(brandingColumns.map((column_name) => ({ column_name }))),
      $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    };
    return { client, transaction };
  }

  it('seeds each tenant admin with tenant-specific TENANT_ADMIN access', async () => {
    const { client, transaction } = makeClient();
    await seedDevelopmentTenantRecords(client as never, adminSeeds);

    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(transaction.tenant.upsert).toHaveBeenCalledTimes(4);
    expect(transaction.tenantBranding.upsert).toHaveBeenCalledTimes(4);
    expect(transaction.tenantBranding.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    expect(transaction.role.upsert).toHaveBeenCalledTimes(8);
    expect(transaction.role.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: 'id-demo', key: 'TENANT_ADMIN', permissionsConfigured: false }),
      update: {},
    }));
    expect(transaction.role.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: 'id-demo', key: 'TENANT_MEMBER', permissionsConfigured: false }),
      update: {},
    }));
    expect(transaction.user.create).toHaveBeenCalledTimes(4);
    expect(transaction.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'id-demo', email: 'admin@demo-academy.test', status: 'ACTIVE', isPlatformAdmin: false, mustChangePassword: true,
      }),
    }));
    expect(transaction.userRole.createMany).toHaveBeenCalledTimes(4);
    expect(transaction.userRole.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ tenantId: 'id-demo', userId: 'user-id-demo', roleId: 'admin-id-demo' }],
      skipDuplicates: true,
    }));
    expect(transaction.user.findUnique).toHaveBeenCalledTimes(4);
  });

  it('preserves existing accounts and ensures their tenant admin role assignment on reseed', async () => {
    const { client, transaction } = makeClient(true);
    await seedDevelopmentTenantRecords(client as never, adminSeeds);

    expect(transaction.role.upsert).toHaveBeenCalledTimes(8);
    expect(transaction.user.findUnique).toHaveBeenCalledTimes(4);
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.userRole.findMany).toHaveBeenCalledTimes(4);
    expect(transaction.userRole.createMany).toHaveBeenCalledTimes(4);
    expect(transaction.userRole.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('refuses to promote a portal-linked account into a development tenant administrator', async () => {
    const { client, transaction } = makeClient(true, true);
    await expect(seedDevelopmentTenantRecords(client as never, adminSeeds)).rejects.toThrow(/linked to a portal identity or platform account/);
    expect(transaction.userRole.createMany).not.toHaveBeenCalled();
  });

  it('seeds tenant directory, branding, and tenant admin roles without creating accounts when no password is configured', async () => {
    const { client, transaction } = makeClient();
    await seedDevelopmentTenantRecords(client as never);

    expect(transaction.tenant.upsert).toHaveBeenCalledTimes(4);
    expect(transaction.tenantBranding.upsert).toHaveBeenCalledTimes(4);
    expect(transaction.role.upsert).toHaveBeenCalledTimes(8);
    expect(transaction.user.findUnique).not.toHaveBeenCalled();
    expect(transaction.user.create).not.toHaveBeenCalled();
  });
});
