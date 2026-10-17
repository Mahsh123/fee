-- Promote one accountable owner per workspace that predates the ownership model.
--
-- Deterministic and idempotent: the oldest active TENANT_ADMIN in each tenant
-- without a TENANT_OWNER link becomes that tenant's owner. Workspaces that
-- already have an owner are untouched, and re-running changes nothing.

WITH eligible AS (
  SELECT
    membership."tenantId",
    membership."userId",
    ROW_NUMBER() OVER (
      PARTITION BY membership."tenantId"
      ORDER BY member."createdAt" ASC, member."id" ASC
    ) AS position
  FROM "user_roles" AS membership
  JOIN "roles" AS role
    ON role."tenantId" = membership."tenantId"
   AND role."id" = membership."roleId"
  JOIN "users" AS member
    ON member."tenantId" = membership."tenantId"
   AND member."id" = membership."userId"
  WHERE role."key" = 'TENANT_ADMIN'
    AND member."status" = 'ACTIVE'
    AND member."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "user_roles" AS owner_link
      JOIN "roles" AS owner_role
        ON owner_role."tenantId" = owner_link."tenantId"
       AND owner_role."id" = owner_link."roleId"
      WHERE owner_role."key" = 'TENANT_OWNER'
        AND owner_link."tenantId" = membership."tenantId"
    )
)
INSERT INTO "user_roles" ("id", "tenantId", "userId", "roleId", "grantedBy", "createdAt")
SELECT
  gen_random_uuid(),
  eligible."tenantId",
  eligible."userId",
  owner_role."id",
  NULL,
  CURRENT_TIMESTAMP
FROM eligible
JOIN "roles" AS owner_role
  ON owner_role."tenantId" = eligible."tenantId"
 AND owner_role."key" = 'TENANT_OWNER'
WHERE eligible.position = 1
ON CONFLICT DO NOTHING;
