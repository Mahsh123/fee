ALTER TABLE "roles"
ADD COLUMN "permissionsConfigured" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "roles" AS role
SET "permissionsConfigured" = TRUE
WHERE EXISTS (
  SELECT 1 FROM "role_permissions" AS role_permission
  WHERE role_permission."tenantId" = role."tenantId"
    AND role_permission."roleId" = role."id"
);
