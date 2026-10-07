SET lock_timeout = '5s';
BEGIN;

ALTER TABLE "users"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

COMMIT;
RESET lock_timeout;
