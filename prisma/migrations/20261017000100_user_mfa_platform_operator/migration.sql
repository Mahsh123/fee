-- Platform operator rank and authenticator enrolment for privileged accounts.
-- Additive only: existing platform administrators keep full OWNER authority.

CREATE TYPE "PlatformOperatorRole" AS ENUM ('OWNER', 'BILLING', 'SUPPORT');

ALTER TABLE "users"
  ADD COLUMN "platformRole" "PlatformOperatorRole" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "mfaSecret" VARCHAR(64),
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
  ADD COLUMN "mfaRecoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
