-- Establish a shared organisation-person identity for non-education workflows.
-- Student, guardian, fee and payment history is retained and linked by backfill.
ALTER TYPE "AssignmentTargetType" ADD VALUE IF NOT EXISTS 'PERSON';
ALTER TYPE "PayerType" ADD VALUE IF NOT EXISTS 'MEMBER';

CREATE TYPE "TenantPersonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

BEGIN;
SET lock_timeout = '5s';

CREATE TABLE "tenant_people" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "personNumber" VARCHAR(80) NOT NULL,
  "typeKey" VARCHAR(80) NOT NULL DEFAULT 'MEMBER',
  "typeLabel" VARCHAR(100) NOT NULL DEFAULT 'Member',
  "firstName" TEXT NOT NULL,
  "middleName" TEXT,
  "lastName" TEXT,
  "preferredName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "status" "TenantPersonStatus" NOT NULL DEFAULT 'ACTIVE',
  "branchId" UUID,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" UUID,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "tenant_people_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_people_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_people_tenantId_id_key" ON "tenant_people"("tenantId", "id");
CREATE UNIQUE INDEX "tenant_people_tenantId_personNumber_key" ON "tenant_people"("tenantId", "personNumber");
CREATE INDEX "tenant_people_tenantId_status_branchId_idx" ON "tenant_people"("tenantId", "status", "branchId");
CREATE INDEX "tenant_people_tenantId_branchId_idx" ON "tenant_people"("tenantId", "branchId");
CREATE INDEX "tenant_people_tenantId_typeKey_status_idx" ON "tenant_people"("tenantId", "typeKey", "status");
CREATE INDEX "tenant_people_tenantId_email_idx" ON "tenant_people"("tenantId", "email");
CREATE INDEX "tenant_people_tenantId_phone_idx" ON "tenant_people"("tenantId", "phone");

CREATE TABLE "tenant_person_groups" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "typeKey" VARCHAR(80),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_person_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_person_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_person_groups_tenantId_id_key" ON "tenant_person_groups"("tenantId", "id");
CREATE UNIQUE INDEX "tenant_person_groups_tenantId_code_key" ON "tenant_person_groups"("tenantId", "code");
CREATE INDEX "tenant_person_groups_tenantId_active_name_idx" ON "tenant_person_groups"("tenantId", "active", "name");

CREATE TABLE "tenant_person_group_members" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "personId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "startedOn" DATE NOT NULL DEFAULT CURRENT_DATE,
  "endedOn" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_person_group_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_person_group_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_person_group_members_tenantId_id_key" ON "tenant_person_group_members"("tenantId", "id");
CREATE UNIQUE INDEX "tenant_person_group_members_tenantId_personId_groupId_key" ON "tenant_person_group_members"("tenantId", "personId", "groupId");
CREATE INDEX "tenant_person_group_members_tenantId_groupId_endedOn_idx" ON "tenant_person_group_members"("tenantId", "groupId", "endedOn");
CREATE INDEX "tenant_person_group_members_tenantId_personId_endedOn_idx" ON "tenant_person_group_members"("tenantId", "personId", "endedOn");

ALTER TABLE "users" ADD COLUMN "tenantPersonId" UUID;
CREATE UNIQUE INDEX "users_tenantId_tenantPersonId_key" ON "users"("tenantId", "tenantPersonId");
ALTER TABLE "students" ADD COLUMN "personId" UUID;
CREATE UNIQUE INDEX "students_tenantId_personId_key" ON "students"("tenantId", "personId");

-- One shared identity for each existing student keeps portal and financial
-- access continuous while allowing future people to exist without Student.
INSERT INTO "tenant_people" (
  "id", "tenantId", "personNumber", "typeKey", "typeLabel", "firstName", "middleName", "lastName",
  "email", "phone", "status", "branchId", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedAt"
)
SELECT gen_random_uuid(), s."tenantId", s."admissionNumber", 'STUDENT', 'Student', s."firstName", s."middleName", s."lastName",
       s."email", s."phone",
       CASE s."status"::TEXT WHEN 'ACTIVE' THEN 'ACTIVE'::"TenantPersonStatus" WHEN 'SUSPENDED' THEN 'SUSPENDED'::"TenantPersonStatus" ELSE 'INACTIVE'::"TenantPersonStatus" END,
       s."branchId", s."createdAt", s."updatedAt", s."createdBy", s."updatedBy", s."deletedAt"
FROM "students" AS s;

UPDATE "students" AS s
SET "personId" = p."id"
FROM "tenant_people" AS p
WHERE p."tenantId" = s."tenantId" AND p."personNumber" = s."admissionNumber" AND p."typeKey" = 'STUDENT';

UPDATE "users" AS u
SET "tenantPersonId" = s."personId"
FROM "students" AS s
WHERE u."tenantId" = s."tenantId" AND u."studentId" = s."id" AND s."personId" IS NOT NULL;

ALTER TABLE "fee_assignments" ADD COLUMN "targetPersonIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "fee_demands" ALTER COLUMN "studentId" DROP NOT NULL;
ALTER TABLE "fee_demands" ADD COLUMN "personId" UUID;
UPDATE "fee_demands" AS d SET "personId" = s."personId" FROM "students" AS s WHERE d."tenantId" = s."tenantId" AND d."studentId" = s."id";

ALTER TABLE "payment_orders" ADD COLUMN "personId" UUID;
UPDATE "payment_orders" AS p SET "personId" = s."personId" FROM "students" AS s WHERE p."tenantId" = s."tenantId" AND p."studentId" = s."id";
ALTER TABLE "payments" ADD COLUMN "personId" UUID;
UPDATE "payments" AS p SET "personId" = s."personId" FROM "students" AS s WHERE p."tenantId" = s."tenantId" AND p."studentId" = s."id";
ALTER TABLE "credits" ADD COLUMN "personId" UUID;
UPDATE "credits" AS c SET "personId" = s."personId" FROM "students" AS s WHERE c."tenantId" = s."tenantId" AND c."studentId" = s."id";
ALTER TABLE "receipts" ADD COLUMN "personId" UUID;
UPDATE "receipts" AS r SET "personId" = s."personId" FROM "students" AS s WHERE r."tenantId" = s."tenantId" AND r."studentId" = s."id";
ALTER TABLE "ledger_entries" ADD COLUMN "personId" UUID;
UPDATE "ledger_entries" AS l SET "personId" = s."personId" FROM "students" AS s WHERE l."tenantId" = s."tenantId" AND l."studentId" = s."id";
ALTER TABLE "invoices" ADD COLUMN "personId" UUID;
UPDATE "invoices" AS i SET "personId" = s."personId" FROM "students" AS s WHERE i."tenantId" = s."tenantId" AND i."studentId" = s."id";
ALTER TABLE "adjustments" ADD COLUMN "personId" UUID;
UPDATE "adjustments" AS a SET "personId" = s."personId" FROM "students" AS s WHERE a."tenantId" = s."tenantId" AND a."studentId" = s."id";
ALTER TABLE "notifications" ADD COLUMN "personId" UUID;
UPDATE "notifications" AS n SET "personId" = s."personId" FROM "students" AS s WHERE n."tenantId" = s."tenantId" AND n."studentId" = s."id";

ALTER TABLE "attendance_sessions" ALTER COLUMN "academicUnitId" DROP NOT NULL;
ALTER TABLE "attendance_sessions" ADD COLUMN "personGroupId" UUID;
ALTER TABLE "attendance_records" ALTER COLUMN "studentId" DROP NOT NULL;
ALTER TABLE "attendance_records" ADD COLUMN "personId" UUID;
UPDATE "attendance_records" AS r SET "personId" = s."personId" FROM "students" AS s WHERE r."tenantId" = s."tenantId" AND r."studentId" = s."id";
ALTER TABLE "attendance_records" ALTER COLUMN "personId" SET NOT NULL;

CREATE INDEX "fee_demands_tenantId_personId_status_idx" ON "fee_demands"("tenantId", "personId", "status");
CREATE INDEX "payment_orders_tenantId_personId_idx" ON "payment_orders"("tenantId", "personId");
CREATE INDEX "payments_tenantId_personId_status_idx" ON "payments"("tenantId", "personId", "status");
CREATE INDEX "credits_tenantId_personId_status_idx" ON "credits"("tenantId", "personId", "status");
CREATE INDEX "receipts_tenantId_personId_idx" ON "receipts"("tenantId", "personId");
CREATE INDEX "invoices_tenantId_personId_idx" ON "invoices"("tenantId", "personId");
CREATE INDEX "notifications_tenantId_personId_idx" ON "notifications"("tenantId", "personId");
CREATE INDEX "adjustments_tenantId_personId_idx" ON "adjustments"("tenantId", "personId");
CREATE INDEX "attendance_records_tenantId_personId_idx" ON "attendance_records"("tenantId", "personId");
CREATE INDEX "attendance_sessions_tenantId_personGroupId_attendanceDate_idx" ON "attendance_sessions"("tenantId", "personGroupId", "attendanceDate");
CREATE UNIQUE INDEX "attendance_sessions_tenantId_branchId_people_attendanceDate_label_key"
  ON "attendance_sessions"("tenantId", "branchId", "attendanceDate", "sessionLabel")
  WHERE "academicUnitId" IS NULL AND "personGroupId" IS NULL;
CREATE UNIQUE INDEX "attendance_sessions_tenantId_branchId_personGroupId_attendanceDate_label_key"
  ON "attendance_sessions"("tenantId", "branchId", "personGroupId", "attendanceDate", "sessionLabel")
  WHERE "academicUnitId" IS NULL AND "personGroupId" IS NOT NULL;

-- Existing tenant workspaces get the least-privilege member portal role.
INSERT INTO "roles" ("id", "tenantId", "key", "name", "description", "isSystem", "active", "permissionsConfigured", "scopeUnitIds", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'WORKSPACE_PERSON', 'Organisation member', 'Self-service access to this person’s own fees, payments, receipts, attendance, and profile.', TRUE, TRUE, TRUE, ARRAY[]::UUID[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" AS t
WHERE t."slug" <> 'fee-platform'
ON CONFLICT ("tenantId", "key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "tenantId", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."tenantId", r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" AS r
JOIN "permissions" AS p ON p."key" IN ('attendance.read', 'fee.demand.read', 'payment.read', 'payment.collect', 'receipt.read', 'dashboard.read')
WHERE r."key" = 'WORKSPACE_PERSON'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
COMMIT;
