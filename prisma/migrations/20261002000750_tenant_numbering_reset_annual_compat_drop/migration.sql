-- The historical annual-effective-date migration has consumed the temporary
-- compatibility value. Remove the alias so the final schema matches Prisma.
ALTER TABLE "tenant_numbering_settings"
DROP COLUMN IF EXISTS "reset_annually";
