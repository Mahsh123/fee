-- Add branch ownership to fee and finance roots without rewriting existing
-- migration history. Ambiguous multi-branch legacy rows remain unassigned for
-- an administrator to review and map explicitly.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

ALTER TABLE "students" ADD COLUMN "branchId" UUID;
ALTER TABLE "fee_assignments" ADD COLUMN "branchId" UUID;
ALTER TABLE "fee_demands" ADD COLUMN "branchId" UUID;
ALTER TABLE "payment_orders" ADD COLUMN "branchId" UUID;
ALTER TABLE "payments" ADD COLUMN "branchId" UUID;
ALTER TABLE "refunds" ADD COLUMN "branchId" UUID;
ALTER TABLE "credits" ADD COLUMN "branchId" UUID;
ALTER TABLE "adjustments" ADD COLUMN "branchId" UUID;
ALTER TABLE "ledger_entries" ADD COLUMN "branchId" UUID;
ALTER TABLE "receipts" ADD COLUMN "branchId" UUID;
ALTER TABLE "invoices" ADD COLUMN "branchId" UUID;
ALTER TABLE "late_fee_accruals" ADD COLUMN "branchId" UUID;

WITH single_active_branch AS (
  SELECT "tenantId", (ARRAY_AGG("id" ORDER BY "id"))[1] AS "branchId"
  FROM "branches"
  WHERE "status" = 'ACTIVE'
  GROUP BY "tenantId"
  HAVING COUNT(*) = 1
)
UPDATE "students" AS student
SET "branchId" = branch."branchId"
FROM single_active_branch AS branch
WHERE student."tenantId" = branch."tenantId" AND student."branchId" IS NULL;

WITH single_active_branch AS (
  SELECT "tenantId", (ARRAY_AGG("id" ORDER BY "id"))[1] AS "branchId"
  FROM "branches"
  WHERE "status" = 'ACTIVE'
  GROUP BY "tenantId"
  HAVING COUNT(*) = 1
)
UPDATE "fee_assignments" AS assignment
SET "branchId" = branch."branchId"
FROM single_active_branch AS branch
WHERE assignment."tenantId" = branch."tenantId" AND assignment."branchId" IS NULL;

UPDATE "fee_demands" AS demand
SET "branchId" = student."branchId"
FROM "students" AS student
WHERE demand."tenantId" = student."tenantId" AND demand."studentId" = student."id" AND demand."branchId" IS NULL;

UPDATE "payment_orders" AS payment_order
SET "branchId" = student."branchId"
FROM "students" AS student
WHERE payment_order."tenantId" = student."tenantId" AND payment_order."studentId" = student."id" AND payment_order."branchId" IS NULL;

UPDATE "payments" AS payment
SET "branchId" = COALESCE(
  (SELECT payment_order."branchId" FROM "payment_orders" AS payment_order WHERE payment_order."tenantId" = payment."tenantId" AND payment_order."id" = payment."paymentOrderId"),
  (SELECT student."branchId" FROM "students" AS student WHERE student."tenantId" = payment."tenantId" AND student."id" = payment."studentId")
)
WHERE payment."branchId" IS NULL;

UPDATE "refunds" AS refund
SET "branchId" = payment."branchId"
FROM "payments" AS payment
WHERE refund."tenantId" = payment."tenantId" AND refund."paymentId" = payment."id" AND refund."branchId" IS NULL;

UPDATE "credits" AS credit
SET "branchId" = COALESCE(
  (SELECT demand."branchId" FROM "fee_demands" AS demand WHERE demand."tenantId" = credit."tenantId" AND demand."id" = credit."sourceDemandId"),
  (SELECT payment."branchId" FROM "payments" AS payment WHERE payment."tenantId" = credit."tenantId" AND payment."id" = credit."paymentId"),
  (SELECT student."branchId" FROM "students" AS student WHERE student."tenantId" = credit."tenantId" AND student."id" = credit."studentId")
)
WHERE credit."branchId" IS NULL;

UPDATE "adjustments" AS adjustment
SET "branchId" = COALESCE(
  (SELECT demand."branchId" FROM "fee_demands" AS demand WHERE demand."tenantId" = adjustment."tenantId" AND demand."id" = adjustment."demandId"),
  (SELECT payment."branchId" FROM "payments" AS payment WHERE payment."tenantId" = adjustment."tenantId" AND payment."id" = adjustment."paymentId"),
  (SELECT student."branchId" FROM "students" AS student WHERE student."tenantId" = adjustment."tenantId" AND student."id" = adjustment."studentId")
)
WHERE adjustment."branchId" IS NULL;

UPDATE "ledger_entries" AS entry
SET "branchId" = COALESCE(
  (SELECT payment."branchId" FROM "payments" AS payment WHERE payment."tenantId" = entry."tenantId" AND payment."id" = entry."paymentId"),
  (SELECT demand."branchId" FROM "fee_demands" AS demand WHERE demand."tenantId" = entry."tenantId" AND demand."id" = entry."demandId"),
  (SELECT student."branchId" FROM "students" AS student WHERE student."tenantId" = entry."tenantId" AND student."id" = entry."studentId")
)
WHERE entry."branchId" IS NULL;

UPDATE "receipts" AS receipt
SET "branchId" = payment."branchId"
FROM "payments" AS payment
WHERE receipt."tenantId" = payment."tenantId" AND receipt."paymentId" = payment."id" AND receipt."branchId" IS NULL;

UPDATE "invoices" AS invoice
SET "branchId" = demand."branchId"
FROM "fee_demands" AS demand
WHERE invoice."tenantId" = demand."tenantId" AND invoice."demandId" = demand."id" AND invoice."branchId" IS NULL;

UPDATE "late_fee_accruals" AS accrual
SET "branchId" = demand."branchId"
FROM "fee_demands" AS demand
WHERE accrual."tenantId" = demand."tenantId" AND accrual."demandId" = demand."id" AND accrual."branchId" IS NULL;

COMMIT;
