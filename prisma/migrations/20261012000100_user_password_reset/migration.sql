ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_PASSWORD_RESET';

ALTER TABLE "users"
  ADD COLUMN "passwordResetTokenHash" VARCHAR(64),
  ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_passwordResetTokenHash_key"
  ON "users"("passwordResetTokenHash");