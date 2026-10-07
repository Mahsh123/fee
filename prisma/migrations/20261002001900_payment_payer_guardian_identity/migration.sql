-- Keep the actual guardian identity on successful payments. Historical payer
-- names are display snapshots and cannot safely identify a guardian.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_guardian_payer_check"
  CHECK ("payerGuardianId" IS NULL OR "payerType" IN ('PARENT', 'GUARDIAN')) NOT VALID;
