BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_EMAIL_VERIFICATION';

ALTER TABLE "users"
  ADD COLUMN "pendingEmail" VARCHAR(254),
  ADD COLUMN "emailChangeTokenHash" VARCHAR(64),
  ADD COLUMN "emailChangeExpiresAt" TIMESTAMP(3);

COMMIT;
