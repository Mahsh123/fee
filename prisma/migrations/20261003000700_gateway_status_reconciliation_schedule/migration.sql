-- Durable provider-status retry state. This is operational scheduling metadata;
-- payment, gateway evidence, and ledger facts remain unchanged.
ALTER TABLE "payment_orders"
  ADD COLUMN "providerStatusAutoCheckAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerStatusCheckedAt" TIMESTAMP(3),
  ADD COLUMN "providerStatusNextCheckAt" TIMESTAMP(3),
  ADD COLUMN "providerStatusCheckLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "providerStatusCheckLeaseId" UUID;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_provider_status_attempts_nonnegative_check"
    CHECK ("providerStatusAutoCheckAttempts" >= 0),
  ADD CONSTRAINT "payment_orders_provider_status_lease_pair_check"
    CHECK (("providerStatusCheckLeaseUntil" IS NULL) = ("providerStatusCheckLeaseId" IS NULL));
