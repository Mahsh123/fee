import { createPrismaClient, Prisma } from '@fee/database';

const client = createPrismaClient({ databaseUrl: process.env.DATABASE_URL, logLevel: 'error' });
try {
  const platform = await client.tenant.findUnique({ where: { slug: 'fee-platform' }, select: { id: true } });
  if (!platform) throw new Error('Platform tenant not found');
  const rows = await client.$queryRaw(Prisma.sql`
    WITH tenant_rows AS (
      SELECT "status"::text AS status, "subscriptionStatus"::text AS "subscriptionStatus"
      FROM public."tenants"
      WHERE "id" <> ${platform.id}::uuid
    ),
    tenant_status_counts AS (
      SELECT status, COUNT(*)::int AS count FROM tenant_rows GROUP BY status
    ),
    subscription_status_counts AS (
      SELECT "subscriptionStatus" AS status, COUNT(*)::int AS count
      FROM tenant_rows GROUP BY "subscriptionStatus"
    )
    SELECT
      (SELECT COUNT(*)::int FROM tenant_rows) AS "totalTenants",
      COALESCE((SELECT jsonb_object_agg(status, count) FROM tenant_status_counts), '{}'::jsonb) AS "tenantStatuses",
      COALESCE((SELECT jsonb_object_agg(status, count) FROM subscription_status_counts), '{}'::jsonb) AS "subscriptionStatuses",
      (SELECT COUNT(*)::int FROM public."users"
        WHERE "tenantId" = ${platform.id}::uuid AND "isPlatformAdmin" AND "status"::text = 'ACTIVE' AND "deletedAt" IS NULL) AS "activeSuperAdmins",
      (SELECT COUNT(*) FILTER (WHERE "active")::int FROM public."plans") AS "activePlans"`);
  process.stdout.write(JSON.stringify(rows));
} finally {
  await client.$disconnect();
}
