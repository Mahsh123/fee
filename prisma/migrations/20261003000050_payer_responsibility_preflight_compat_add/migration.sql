-- The following immutable preflight references responsibilityId without SQL
-- quotes, so PostgreSQL resolves it as the lowercase responsibilityid. Add a
-- temporary alias on both allocation tables for that read-only check.
ALTER TABLE "payment_allocations"
ADD COLUMN IF NOT EXISTS "responsibilityid" UUID;

ALTER TABLE "credit_allocations"
ADD COLUMN IF NOT EXISTS "responsibilityid" UUID;

UPDATE "payment_allocations"
SET "responsibilityid" = "responsibilityId";

UPDATE "credit_allocations"
SET "responsibilityid" = "responsibilityId";
