-- Tenant-specific public landing presentation. These fields contain no
-- financial facts and are updated through the audited tenant branding API.
ALTER TABLE "tenant_branding"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "landingTitle" TEXT,
  ADD COLUMN "landingDescription" TEXT,
  ADD COLUMN "landingActionLabel" TEXT;
