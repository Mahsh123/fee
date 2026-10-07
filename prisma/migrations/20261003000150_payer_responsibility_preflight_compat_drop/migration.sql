-- The preflight is read-only and has consumed both temporary aliases.
ALTER TABLE "payment_allocations"
DROP COLUMN IF EXISTS "responsibilityid";

ALTER TABLE "credit_allocations"
DROP COLUMN IF EXISTS "responsibilityid";
