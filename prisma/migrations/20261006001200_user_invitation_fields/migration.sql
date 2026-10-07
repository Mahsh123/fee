BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_INVITATION';

ALTER TABLE "users"
  ADD COLUMN "invitationTokenHash" VARCHAR(64),
  ADD COLUMN "invitationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

COMMIT;
