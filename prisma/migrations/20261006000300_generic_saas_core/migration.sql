SET lock_timeout = '5s';
BEGIN;

CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY', 'MANUAL');
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

ALTER TABLE "tenants"
  ADD COLUMN "organizationType" VARCHAR(80) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "roles" ALTER COLUMN "key" TYPE VARCHAR(80) USING "key"::TEXT;
ALTER TABLE "roles" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "approval_requests" ALTER COLUMN "requiredRole" TYPE VARCHAR(80) USING "requiredRole"::TEXT;
DROP TYPE "RoleKey";

CREATE TABLE "plans" (
  "id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "monthlyPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "yearlyPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "trialDays" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

CREATE TABLE "plan_modules" (
  "id" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "moduleKey" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_modules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "plan_modules_planId_moduleKey_key" ON "plan_modules"("planId", "moduleKey");

CREATE TABLE "plan_entitlements" (
  "id" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "entitlementKey" VARCHAR(100) NOT NULL,
  "limitValue" INTEGER,
  CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_entitlements_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "plan_entitlements_planId_entitlementKey_key" ON "plan_entitlements"("planId", "entitlementKey");

CREATE TABLE "branches" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "code" VARCHAR(48) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "address" JSONB,
  "phone" TEXT,
  "email" TEXT,
  "capacity" INTEGER,
  "managerId" UUID,
  "settings" JSONB,
  "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "branches_tenantId_managerId_fkey" FOREIGN KEY ("tenantId", "managerId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches"("tenantId", "code");
CREATE UNIQUE INDEX "branches_tenantId_id_key" ON "branches"("tenantId", "id");
CREATE INDEX "branches_tenantId_status_idx" ON "branches"("tenantId", "status");
CREATE INDEX "branches_tenantId_managerId_idx" ON "branches"("tenantId", "managerId");

CREATE TABLE "user_branch_memberships" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "grantedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_branch_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_branch_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_branch_memberships_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_branch_memberships_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_branch_memberships_tenantId_grantedBy_fkey" FOREIGN KEY ("tenantId", "grantedBy") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_branch_memberships_userId_branchId_key" ON "user_branch_memberships"("userId", "branchId");
CREATE UNIQUE INDEX "user_branch_memberships_tenantId_id_key" ON "user_branch_memberships"("tenantId", "id");
CREATE UNIQUE INDEX "user_branch_memberships_primary_user_key" ON "user_branch_memberships"("tenantId", "userId") WHERE "isPrimary";
CREATE INDEX "user_branch_memberships_tenantId_userId_idx" ON "user_branch_memberships"("tenantId", "userId");
CREATE INDEX "user_branch_memberships_tenantId_branchId_idx" ON "user_branch_memberships"("tenantId", "branchId");
CREATE INDEX "user_branch_memberships_tenantId_grantedBy_idx" ON "user_branch_memberships"("tenantId", "grantedBy");

CREATE TABLE "organization_units" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "code" VARCHAR(48) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "unitType" VARCHAR(80) NOT NULL,
  "description" TEXT,
  "parentId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_units_tenantId_unitType_code_key" ON "organization_units"("tenantId", "unitType", "code");
CREATE UNIQUE INDEX "organization_units_tenantId_id_key" ON "organization_units"("tenantId", "id");
CREATE INDEX "organization_units_tenantId_unitType_active_idx" ON "organization_units"("tenantId", "unitType", "active");
CREATE INDEX "organization_units_tenantId_parentId_idx" ON "organization_units"("tenantId", "parentId");
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_tenantId_parentId_fkey" FOREIGN KEY ("tenantId", "parentId") REFERENCES "organization_units"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "user_organization_memberships" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_organization_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_organization_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_organization_memberships_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_organization_memberships_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "organization_units"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_organization_memberships_userId_unitId_key" ON "user_organization_memberships"("userId", "unitId");
CREATE UNIQUE INDEX "user_organization_memberships_tenantId_id_key" ON "user_organization_memberships"("tenantId", "id");
CREATE INDEX "user_organization_memberships_tenantId_userId_idx" ON "user_organization_memberships"("tenantId", "userId");
CREATE INDEX "user_organization_memberships_tenantId_unitId_idx" ON "user_organization_memberships"("tenantId", "unitId");

CREATE TABLE "user_assignments" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "branchId" UUID,
  "resourceType" VARCHAR(80) NOT NULL,
  "resourceId" VARCHAR(200) NOT NULL,
  "resourceLabel" VARCHAR(200),
  "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
  "dueAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_assignments_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_assignments_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "user_assignments_tenantId_createdBy_fkey" FOREIGN KEY ("tenantId", "createdBy") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_assignments_tenantId_userId_resourceType_resourceId_key" ON "user_assignments"("tenantId", "userId", "resourceType", "resourceId");
CREATE UNIQUE INDEX "user_assignments_tenantId_id_key" ON "user_assignments"("tenantId", "id");
CREATE INDEX "user_assignments_tenantId_userId_status_idx" ON "user_assignments"("tenantId", "userId", "status");
CREATE INDEX "user_assignments_tenantId_resourceType_resourceId_idx" ON "user_assignments"("tenantId", "resourceType", "resourceId");
CREATE INDEX "user_assignments_tenantId_branchId_idx" ON "user_assignments"("tenantId", "branchId");
CREATE INDEX "user_assignments_tenantId_createdBy_idx" ON "user_assignments"("tenantId", "createdBy");

CREATE TABLE "tenant_subscriptions" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "externalCustomerId" TEXT,
  "externalSubscriptionId" TEXT,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_subscriptions_tenantId_id_key" ON "tenant_subscriptions"("tenantId", "id");
CREATE UNIQUE INDEX "tenant_subscriptions_one_current_per_tenant_key" ON "tenant_subscriptions"("tenantId") WHERE "isCurrent";
CREATE INDEX "tenant_subscriptions_tenantId_status_currentPeriodEnd_idx" ON "tenant_subscriptions"("tenantId", "status", "currentPeriodEnd");
CREATE INDEX "tenant_subscriptions_planId_status_idx" ON "tenant_subscriptions"("planId", "status");

CREATE TABLE "tenant_module_overrides" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "moduleKey" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "reason" TEXT,
  "updatedBy" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_module_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_module_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_module_overrides_tenantId_moduleKey_key" ON "tenant_module_overrides"("tenantId", "moduleKey");
CREATE UNIQUE INDEX "tenant_module_overrides_tenantId_id_key" ON "tenant_module_overrides"("tenantId", "id");

CREATE TABLE "tenant_entitlement_overrides" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "entitlementKey" VARCHAR(100) NOT NULL,
  "limitValue" INTEGER,
  "reason" VARCHAR(500) NOT NULL,
  "updatedBy" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_entitlement_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_entitlement_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_entitlement_overrides_tenantId_entitlementKey_key" ON "tenant_entitlement_overrides"("tenantId", "entitlementKey");
CREATE UNIQUE INDEX "tenant_entitlement_overrides_tenantId_id_key" ON "tenant_entitlement_overrides"("tenantId", "id");

CREATE TABLE "platform_invoices" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "invoiceNumber" VARCHAR(80) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "subtotal" DECIMAL(18,4) NOT NULL,
  "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "total" DECIMAL(18,4) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lineSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_invoices_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "tenant_subscriptions"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_invoices_tenantId_id_key" ON "platform_invoices"("tenantId", "id");
CREATE UNIQUE INDEX "platform_invoices_tenantId_invoiceNumber_key" ON "platform_invoices"("tenantId", "invoiceNumber");
CREATE INDEX "platform_invoices_tenantId_status_dueAt_idx" ON "platform_invoices"("tenantId", "status", "dueAt");
CREATE INDEX "platform_invoices_tenantId_subscriptionId_idx" ON "platform_invoices"("tenantId", "subscriptionId");

CREATE TABLE "platform_payments" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "providerPaymentId" VARCHAR(200),
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(18,4) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_payments_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "platform_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_payments_tenantId_id_key" ON "platform_payments"("tenantId", "id");
CREATE UNIQUE INDEX "platform_payments_tenantId_idempotencyKey_key" ON "platform_payments"("tenantId", "idempotencyKey");
CREATE INDEX "platform_payments_tenantId_invoiceId_status_idx" ON "platform_payments"("tenantId", "invoiceId", "status");

CREATE TABLE "platform_refunds" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "reason" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
  "externalRefundId" TEXT,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "platform_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_refunds_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "platform_payments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_refunds_tenantId_id_key" ON "platform_refunds"("tenantId", "id");
CREATE INDEX "platform_refunds_tenantId_paymentId_status_idx" ON "platform_refunds"("tenantId", "paymentId", "status");

-- Starter is an idempotent bootstrap plan; the application seed can refresh labels and limits.
INSERT INTO "plans" ("id", "key", "name", "description", "monthlyPrice", "yearlyPrice", "currency", "trialDays", "active", "updatedAt")
VALUES (gen_random_uuid(), 'starter', 'Starter', 'Default trial plan for new organizations.', 0, 0, 'USD', 14, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "plan_modules" ("id", "planId", "moduleKey", "enabled")
SELECT gen_random_uuid(), p."id", modules.module_key, true FROM "plans" AS p CROSS JOIN unnest(ARRAY['USERS','BRANCHES','ORGANIZATION','ASSIGNMENTS','REPORTS','NOTIFICATIONS','FEES','PAYMENTS','ADMISSIONS','PORTAL','ANALYTICS']::TEXT[]) AS modules(module_key)
WHERE p."key" = 'starter' ON CONFLICT ("planId", "moduleKey") DO NOTHING;
INSERT INTO "plan_entitlements" ("id", "planId", "entitlementKey", "limitValue")
SELECT gen_random_uuid(), p."id", ent.entitlement_key, ent.limit_value FROM "plans" AS p CROSS JOIN (VALUES ('MAX_USERS', 50), ('MAX_BRANCHES', 3), ('STORAGE_MIB', 5120)) AS ent(entitlement_key, limit_value)
WHERE p."key" = 'starter' ON CONFLICT ("planId", "entitlementKey") DO NOTHING;

UPDATE "tenants" SET "enabledModules" = ARRAY['USERS','BRANCHES','ORGANIZATION','ASSIGNMENTS','REPORTS','NOTIFICATIONS','FEES','PAYMENTS','ADMISSIONS','PORTAL','ANALYTICS']::TEXT[];

-- Existing organizations receive a safe main branch and primary membership for every existing account.
INSERT INTO "branches" ("id", "tenantId", "code", "name", "status", "enabledModules", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'MAIN', 'Main branch', 'ACTIVE', "enabledModules", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" WHERE "slug" <> 'fee-platform' ON CONFLICT ("tenantId", "code") DO NOTHING;
INSERT INTO "user_branch_memberships" ("id", "tenantId", "userId", "branchId", "isPrimary", "createdAt")
SELECT gen_random_uuid(), u."tenantId", u."id", b."id", true, CURRENT_TIMESTAMP
FROM "users" u JOIN "branches" b ON b."tenantId" = u."tenantId" AND b."code" = 'MAIN'
WHERE u."deletedAt" IS NULL ON CONFLICT ("userId", "branchId") DO NOTHING;

-- Preserve the legacy subscription snapshot while creating a normalized current subscription row.
INSERT INTO "tenant_subscriptions" ("id", "tenantId", "planId", "status", "billingInterval", "amount", "currency", "startedAt", "trialEndsAt", "currentPeriodStart", "isCurrent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", p."id", t."subscriptionStatus", 'MANUAL', 0, COALESCE(s."currency", 'USD'), t."createdAt", t."trialEndsAt", t."createdAt", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t JOIN "plans" p ON p."key" = 'starter' LEFT JOIN "tenant_settings" s ON s."tenantId" = t."id"
WHERE t."slug" <> 'fee-platform';

COMMIT;
RESET lock_timeout;
