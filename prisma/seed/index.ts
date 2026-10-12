import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { createPrismaClient } from '@fee/database';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PLATFORM_MODULES, PLATFORM_SYSTEM_TENANT_SLUG, SYSTEM_ROLE_NAMES } from '@fee/types';

/**
 * Creates the reserved platform workspace and initial platform operator.
 * This seed is deliberately idempotent and never prints credentials.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.PLATFORM_BOOTSTRAP_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const email = process.env.SEED_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
  if (!databaseUrl) throw new Error('A platform bootstrap, migration, or database URL is required to seed the platform administrator.');

  const client = createPrismaClient({ databaseUrl, poolSize: 3 });
  try {
    const tenant = await client.tenant.upsert({
      where: { slug: PLATFORM_SYSTEM_TENANT_SLUG },
      create: { slug: PLATFORM_SYSTEM_TENANT_SLUG, name: 'Wasl', status: 'ACTIVE' },
      update: { name: 'Wasl', status: 'ACTIVE' },
      select: { id: true },
    });

    const permissionRows = Object.values(PERMISSIONS).map((key) => {
      const [resource, ...actionParts] = key.split('.');
      return { key, resource, action: actionParts.join('.'), description: `${resource} ${actionParts.join(' ')} access` };
    });
    await client.permission.createMany({ data: permissionRows, skipDuplicates: true });

    const starterPlan = await client.plan.upsert({
      where: { key: 'starter' },
      create: {
        key: 'starter', name: 'Starter', description: 'Default trial plan for new organizations.',
        monthlyPrice: 0, yearlyPrice: 0, currency: 'INR', trialDays: 14, active: true,
      },
      update: { active: true },
      select: { id: true },
    });
    await client.planModule.deleteMany({ where: { planId: starterPlan.id } });
    await client.planModule.createMany({ data: PLATFORM_MODULES.map((moduleKey) => ({ planId: starterPlan.id, moduleKey, enabled: true })) });
    await client.planEntitlement.deleteMany({ where: { planId: starterPlan.id } });
    await client.planEntitlement.createMany({ data: [
      { planId: starterPlan.id, entitlementKey: 'MAX_USERS', limitValue: 50 },
      { planId: starterPlan.id, entitlementKey: 'MAX_BRANCHES', limitValue: 3 },
      { planId: starterPlan.id, entitlementKey: 'STORAGE_MIB', limitValue: 5_120 },
    ] });

    const role = await client.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: 'PLATFORM_ADMIN' } },
      create: {
        tenantId: tenant.id,
        key: 'PLATFORM_ADMIN',
        name: SYSTEM_ROLE_NAMES.PLATFORM_ADMIN,
        description: 'Operator access to platform administration.',
        isSystem: true,
        permissionsConfigured: true,
      },
      update: { name: SYSTEM_ROLE_NAMES.PLATFORM_ADMIN, isSystem: true, permissionsConfigured: true },
      select: { id: true },
    });
    const permissions = await client.permission.findMany({ where: { key: { in: DEFAULT_ROLE_PERMISSIONS.PLATFORM_ADMIN } }, select: { id: true } });
    await client.rolePermission.createMany({
      data: permissions.map((permission) => ({ tenantId: tenant.id, roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });

    let user = email ? await client.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } }, select: { id: true, isPlatformAdmin: true } }) : null;
    if (!user && !email) user = await client.user.findFirst({ where: { tenantId: tenant.id, isPlatformAdmin: true }, select: { id: true, isPlatformAdmin: true } });
    if (!user) {
      if (!email || !password || password.length < 12) {
        throw new Error('For a first install, set SEED_PLATFORM_ADMIN_EMAIL and SEED_PLATFORM_ADMIN_PASSWORD with at least 12 characters.');
      }
      const passwordHash = await bcrypt.hash(password, 12);
      user = await client.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          firstName: 'Platform',
          lastName: 'Administrator',
          status: 'ACTIVE',
          isPlatformAdmin: true,
        },
        select: { id: true, isPlatformAdmin: true },
      });
    } else if (!user.isPlatformAdmin) {
      if (!password || password.length < 12) throw new Error('The configured seed email belongs to a non-platform account. Set a new initial password to explicitly promote it.');
      const passwordHash = await bcrypt.hash(password, 12);
      user = await client.user.update({
        where: { id: user.id },
        data: { isPlatformAdmin: true, status: 'ACTIVE', passwordHash },
        select: { id: true, isPlatformAdmin: true },
      });
    } else {
      // Do not silently rotate the password or reactivate a manually disabled account.
      user = await client.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true }, select: { id: true, isPlatformAdmin: true } });
    }
    await client.userRole.createMany({
      data: [{ tenantId: tenant.id, userId: user.id, roleId: role.id }],
      skipDuplicates: true,
    });

    process.stdout.write(`Platform administrator is ready for tenant slug "${PLATFORM_SYSTEM_TENANT_SLUG}".\n`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Platform seeding failed.'}\n`);
  process.exitCode = 1;
});
