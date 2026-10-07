-- Add verified ownership challenges for tenant custom domains.
-- Pending domains remain unroutable until the DNS challenge is verified.
ALTER TABLE "tenant_domains"
  ADD COLUMN "verificationToken" VARCHAR(64);
