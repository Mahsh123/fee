import { createPrismaClient, type DatabaseClient } from '@fee/database';
import * as bcrypt from 'bcryptjs';
import { SYSTEM_ROLE_NAMES } from '@fee/types';

/** Development-only, idempotent sample tenant directory and public branding. */
const SAMPLE_TENANTS = [
  {
    slug: 'demo',
    name: 'Demo Learning Academy',
    branding: {
      organizationName: 'Demo Learning Academy',
      logoUrl: '/tenant-brands/demo.svg',
      primaryColor: '#17324D',
      accentColor: '#2D7C72',
      landingTitle: 'A simpler way to manage school fees.',
      landingDescription: 'Welcome to the Demo Learning Academy fee workspace. Keep schedules, collections, and financial records clear in one place.',
      landingActionLabel: 'Open the demo workspace',
    },
  },
  {
    slug: 'school',
    name: 'Northstar School',
    branding: {
      organizationName: 'Northstar School',
      logoUrl: '/tenant-brands/school.svg',
      primaryColor: '#25214A',
      accentColor: '#6B5DD3',
      landingTitle: 'Welcome to Northstar School.',
      landingDescription: 'A private workspace for families and staff to manage tuition, activities, and school collections.',
      landingActionLabel: 'Continue to Northstar',
    },
  },
  {
    slug: 'academy',
    name: 'Greenfield Academy',
    branding: {
      organizationName: 'Greenfield Academy',
      logoUrl: '/tenant-brands/academy.svg',
      primaryColor: '#254333',
      accentColor: '#4F8A54',
      landingTitle: 'A confident start for Greenfield Academy.',
      landingDescription: 'A secure workspace for Greenfield families and staff to manage tuition and school collections.',
      landingActionLabel: 'Sign in to Greenfield Academy',
    },
  },
  {
    slug: 'gym',
    name: 'Northstar Fitness',
    branding: {
      organizationName: 'Northstar Fitness',
      logoUrl: '/tenant-brands/gym.svg',
      primaryColor: '#143C3C',
      accentColor: '#E29B46',
      landingTitle: 'A stronger way to manage your fitness community.',
      landingDescription: 'A dedicated workspace for Northstar Fitness members, coaches, and staff.',
      landingActionLabel: 'Continue to Northstar Fitness',
    },
  },
] as const;

const REQUIRED_BRANDING_COLUMNS = ['logoUrl', 'landingTitle', 'landingDescription', 'landingActionLabel'] as const;

export interface DevelopmentTenantAdminSeed {
  email: string;
  passwordHash: string;
}

export type DevelopmentTenantAdminSeeds = Partial<Record<'demo' | 'school' | 'academy' | 'gym', DevelopmentTenantAdminSeed>>;

export interface DevelopmentTenantAdminCredentials {
  demoEmail?: string;
  schoolEmail?: string;
  academyEmail?: string;
  gymEmail?: string;
  password?: string;
}

export function resolveDevelopmentTenantAdminCredentials(input: DevelopmentTenantAdminCredentials): Record<'demo' | 'school' | 'academy' | 'gym', { email: string; password: string }> | undefined {
  if (!input.password) return undefined;
  if (input.password.length < 12) throw new Error('SEED_DEMO_PASSWORD must contain at least 12 characters to create development tenant administrators.');
  const configuredEmail = (value: string | undefined, fallback: string): string => value?.trim() ? value : fallback;
  const defaults = {
    demo: configuredEmail(input.demoEmail, 'admin@demo-academy.test'),
    school: configuredEmail(input.schoolEmail, 'admin@northstar.test'),
    academy: configuredEmail(input.academyEmail, 'admin@greenfield-academy.test'),
    gym: configuredEmail(input.gymEmail, 'manager@northstar-fitness.test'),
  };
  const normalized = Object.fromEntries(Object.entries(defaults).map(([slug, value]) => {
    const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`SEED_${slug.toUpperCase()}_EMAIL must be a valid email address.`);
    return [slug, { email, password: input.password! }];
  })) as Record<'demo' | 'school' | 'academy' | 'gym', { email: string; password: string }>;
  return normalized;
}

export async function assertTenantBrandingMigration(client: Pick<DatabaseClient, '$queryRaw'>): Promise<void> {
  const rows = await client.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_branding'
      AND column_name IN ('logoUrl', 'landingTitle', 'landingDescription', 'landingActionLabel')
  `;
  const present = new Set(rows.map((row) => row.column_name));
  const missing = REQUIRED_BRANDING_COLUMNS.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(`Development tenant startup requires the tenant landing branding migration; missing columns: ${missing.join(', ')}. Apply the staged database migrations before starting dev:neon.`);
  }
}

export async function seedDevelopmentTenantRecords(
  client: Pick<DatabaseClient, '$queryRaw' | '$transaction'>,
  admins?: DevelopmentTenantAdminSeeds,
): Promise<void> {
  await assertTenantBrandingMigration(client);
  // Neon can add several seconds of network latency across four isolated
  // sample workspaces; use an explicit development seed budget instead of
  // Prisma's short interactive-transaction default.
  await client.$transaction(async (transaction) => {
    for (const sample of SAMPLE_TENANTS) {
      const tenant = await transaction.tenant.upsert({
        where: { slug: sample.slug },
        create: { slug: sample.slug, name: sample.name, status: 'TRIAL' },
        // Preserve operator changes: startup never renames, reactivates, or
        // overwrites an existing sample tenant.
        update: {},
        select: { id: true },
      });
      await transaction.$queryRaw`SELECT pg_catalog.set_config('fee.current_tenant', ${tenant.id}, true)`;
      await transaction.tenantBranding.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, ...sample.branding },
        update: {},
      });

      const role = await transaction.role.upsert({
          where: { tenantId_key: { tenantId: tenant.id, key: 'TENANT_ADMIN' } },
          create: {
            tenantId: tenant.id,
            key: 'TENANT_ADMIN',
            name: SYSTEM_ROLE_NAMES.TENANT_ADMIN,
            isSystem: true,
            // The untouched system role resolves the canonical default matrix
            // at login. Once an operator configures it, startup leaves it alone.
            permissionsConfigured: false,
          },
          // Preserve tenant administrator role permissions configured by the operator.
          update: {},
          select: { id: true },
        });
      // Keep the generic least-privilege role available for opt-in public
      // registration in local workspaces. Leave operator changes untouched.
      await transaction.role.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: 'TENANT_MEMBER' } },
        create: {
          tenantId: tenant.id,
          key: 'TENANT_MEMBER',
          name: SYSTEM_ROLE_NAMES.TENANT_MEMBER,
          isSystem: true,
          permissionsConfigured: false,
        },
        update: {},
      });
      const admin = admins?.[sample.slug as keyof DevelopmentTenantAdminSeeds];
      if (admin) {
        const existingAdmin = await transaction.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: admin.email } },
          select: { id: true, studentId: true, guardianId: true, isPlatformAdmin: true },
        });
        if (existingAdmin && (existingAdmin.studentId || existingAdmin.guardianId || existingAdmin.isPlatformAdmin)) {
          throw new Error(`Refusing to use ${admin.email} as a development tenant administrator because it is linked to a portal identity or platform account.`);
        }
        if (existingAdmin) {
          const existingLinks = await transaction.userRole.findMany({
            where: { tenantId: tenant.id, userId: existingAdmin.id },
            select: { roleId: true },
          });
          const linkedRoleIds = [...new Set(existingLinks.map(({ roleId }) => roleId))];
          const linkedRoles = linkedRoleIds.length
            ? await transaction.role.findMany({ where: { tenantId: tenant.id, id: { in: linkedRoleIds } }, select: { key: true } })
            : [];
          if (linkedRoles.length === 0 || linkedRoles.length !== linkedRoleIds.length || linkedRoles.some(({ key }) => key !== 'TENANT_ADMIN' && key !== 'TENANT_OWNER')) {
            throw new Error(`Refusing to promote the existing ${admin.email} account. Use a dedicated development tenant administrator account.`);
          }
        }
        const adminId = existingAdmin?.id ?? (await transaction.user.create({
            data: {
              tenantId: tenant.id,
              email: admin.email,
              firstName: sample.slug === 'demo' ? 'Demo' : sample.slug === 'school' ? 'School' : 'Academy',
              lastName: 'Administrator',
              passwordHash: admin.passwordHash,
              status: 'ACTIVE',
              mustChangePassword: true,
              isPlatformAdmin: false,
            },
            select: { id: true },
          })).id;
        await transaction.userRole.createMany({
          data: [{ tenantId: tenant.id, userId: adminId, roleId: role.id }],
          skipDuplicates: true,
        });
      }
    }
  }, { maxWait: 10_000, timeout: 60_000 });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || process.env.SEED_DEVELOPMENT_TENANTS !== 'true') {
    throw new Error('Development tenant seeding requires NODE_ENV=development and explicit launcher authorization.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('The development tenant seed requires the restricted runtime DATABASE_URL.');
  const credentials = resolveDevelopmentTenantAdminCredentials({
    demoEmail: process.env.SEED_DEMO_EMAIL,
    schoolEmail: process.env.SEED_SCHOOL_EMAIL,
    academyEmail: process.env.SEED_ACADEMY_EMAIL,
    gymEmail: process.env.SEED_GYM_EMAIL,
    password: process.env.SEED_DEMO_PASSWORD,
  });
  const admins = credentials ? Object.fromEntries(await Promise.all(Object.entries(credentials).map(async ([slug, account]) => [
    slug,
    { email: account.email, passwordHash: await bcrypt.hash(account.password, 12) },
  ]))) as DevelopmentTenantAdminSeeds : undefined;

  const client = createPrismaClient({ databaseUrl, poolSize: 2 });
  try {
    await seedDevelopmentTenantRecords(client, admins);
    process.stdout.write(`Development tenant directory and branding are ready (${SAMPLE_TENANTS.map(({ slug }) => slug).join(', ')}).${admins ? ' Tenant administrator accounts are ready; existing passwords and account status are preserved.' : ' No tenant administrator accounts were changed; set SEED_DEMO_PASSWORD to create the development accounts.'}\n`);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv.some((argument) => /(?:^|[\\/])seed-development-tenants\.(?:ts|js)$/.test(argument))) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Development tenant seed failed.'}\n`);
    process.exitCode = 1;
  });
}
