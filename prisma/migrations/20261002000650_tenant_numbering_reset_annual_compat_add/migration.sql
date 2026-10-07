-- The following historical migration reads this legacy spelling, while the
-- baseline schema and Prisma model use resetAnnually. Copy the canonical value
-- into a temporary compatibility column so the immutable backfill can run.
ALTER TABLE "tenant_numbering_settings"
ADD COLUMN IF NOT EXISTS "reset_annually" BOOLEAN;

UPDATE "tenant_numbering_settings"
SET "reset_annually" = "resetAnnually";
