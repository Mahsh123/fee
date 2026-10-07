SET lock_timeout = '5s';
BEGIN;

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED'
);

ALTER TABLE "tenants"
  ADD COLUMN "subscriptionPlan" VARCHAR(80),
  ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "subscriptionRenewalAt" TIMESTAMP(3);

COMMIT;
RESET lock_timeout;
