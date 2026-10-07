-- Make the polymorphic idempotency result pointer explicit so it can be
-- validated against one tenant-owned model rather than guessed by ID.
ALTER TABLE "idempotency_keys"
ADD COLUMN "resourceType" TEXT;

-- AssignmentTargetType already supports COURSE; AcademicUnit is the
-- configuration-driven target model, so give it the matching unit category.
ALTER TYPE "AcademicUnitType" ADD VALUE 'COURSE';
