-- Seed the Branch manager preset for workspaces that already exist.
--
-- The role is intentionally left with permissionsConfigured = false so it reads
-- the shared default matrix, exactly like a freshly provisioned workspace. Only
-- workspaces that do not already have the key are touched.

INSERT INTO "roles" ("id", "tenantId", "key", "name", "description", "isSystem", "active", "permissionsConfigured", "scopeUnitIds", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  tenant."id",
  'BRANCH_MANAGER',
  'Branch manager',
  'Branch-level administration: front-desk access without organization-wide configuration.',
  true,
  true,
  false,
  ARRAY[]::uuid[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" AS tenant
WHERE tenant."slug" <> 'fee-platform'
  AND NOT EXISTS (
    SELECT 1 FROM "roles" AS existing
    WHERE existing."tenantId" = tenant."id"
      AND existing."key" = 'BRANCH_MANAGER'
  )
ON CONFLICT DO NOTHING;
