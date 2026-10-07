CREATE TYPE "PayerResponsibilityBasis" AS ENUM ('FIXED_PER_FEE_ITEM', 'PERCENTAGE_OF_REMAINDER');

CREATE TABLE "payer_responsibility_rules" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "payerType" "PayerType" NOT NULL,
  "payerName" TEXT,
  "payerSponsorId" UUID,
  "studentId" UUID,
  "studentGroupId" UUID,
  "academicYearId" UUID,
  "feeTypeId" UUID,
  "basis" "PayerResponsibilityBasis" NOT NULL,
  "value" DECIMAL(18,4) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" UUID,
  CONSTRAINT "payer_responsibility_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payer_responsibility_rules_value_check" CHECK ("value" > 0),
  CONSTRAINT "payer_responsibility_rules_payer_check" CHECK ("payerType" <> 'STUDENT' AND (("payerType" = 'SPONSOR' AND "payerSponsorId" IS NOT NULL) OR ("payerType" <> 'SPONSOR' AND "payerSponsorId" IS NULL AND "payerName" IS NOT NULL))),
  CONSTRAINT "payer_responsibility_rules_scope_check" CHECK ("studentId" IS NULL OR "studentGroupId" IS NULL),
  CONSTRAINT "payer_responsibility_rules_effective_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "payer_responsibility_rules_percentage_check" CHECK ("basis" <> 'PERCENTAGE_OF_REMAINDER' OR "value" <= 100)
);
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fee_demand_responsibilities" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "demandId" UUID NOT NULL,
  "demandItemId" UUID NOT NULL,
  "payerType" "PayerType" NOT NULL,
  "payerName" TEXT NOT NULL,
  "payerSponsorId" UUID,
  "sourceRuleId" UUID,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "amount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_demand_responsibilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_demand_responsibilities_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "fee_demand_responsibilities_payer_check" CHECK (("payerType" = 'SPONSOR' AND "payerSponsorId" IS NOT NULL) OR ("payerType" <> 'SPONSOR' AND "payerSponsorId" IS NULL))
);
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_allocations" ADD COLUMN "responsibilityId" UUID;
ALTER TABLE "credit_allocations" ADD COLUMN "responsibilityId" UUID;
ALTER TABLE "payment_orders" ADD COLUMN "responsibilityShares" JSONB;

-- Existing open demand balances remain attributed to the student until a payer
-- rule is explicitly configured for new demands.
INSERT INTO "fee_demand_responsibilities" ("id", "tenantId", "demandId", "demandItemId", "payerType", "payerName", "priority", "amount")
SELECT gen_random_uuid(), item."tenantId", item."demandId", item."id", 'STUDENT', student."firstName" || COALESCE(' ' || student."lastName", ''), 2147483647,
       GREATEST(0, item."netAmount" + item."adjustmentAmount" - item."waivedAmount" - item."paidAmount")
FROM "fee_demand_items" item
JOIN "fee_demands" demand ON demand."tenantId" = item."tenantId" AND demand."id" = item."demandId"
JOIN "students" student ON student."tenantId" = demand."tenantId" AND student."id" = demand."studentId"
WHERE demand."status" IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
  AND item."netAmount" + item."adjustmentAmount" - item."waivedAmount" - item."paidAmount" > 0;

INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "sensitive") VALUES
  (gen_random_uuid(), 'payer.responsibility.read', 'payer.responsibility', 'read', 'View payer coverage rules and saved demand responsibility shares.', false),
  (gen_random_uuid(), 'payer.responsibility.configure', 'payer.responsibility', 'configure', 'Create or deactivate tenant payer coverage rules.', true)
ON CONFLICT ("key") DO NOTHING;
