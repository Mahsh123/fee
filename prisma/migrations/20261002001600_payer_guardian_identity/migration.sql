-- Retain tenant-local guardian identity on future rules, issued demand shares,
-- and online order intent. Existing payer names remain display snapshots.
ALTER TABLE "payer_responsibility_rules"
  ADD COLUMN "payerGuardianId" UUID;
ALTER TABLE "fee_demand_responsibilities"
  ADD COLUMN "payerGuardianId" UUID;
ALTER TABLE "payment_orders"
  ADD COLUMN "payerGuardianId" UUID;

ALTER TABLE "payer_responsibility_rules"
  ADD CONSTRAINT "payer_responsibility_rules_guardian_payer_check"
  CHECK ("payerGuardianId" IS NULL OR "payerType" IN ('PARENT', 'GUARDIAN')) NOT VALID;
ALTER TABLE "fee_demand_responsibilities"
  ADD CONSTRAINT "fee_demand_responsibilities_guardian_payer_check"
  CHECK ("payerGuardianId" IS NULL OR "payerType" IN ('PARENT', 'GUARDIAN')) NOT VALID;
ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_guardian_payer_check"
  CHECK ("payerGuardianId" IS NULL OR "payerType" IN ('PARENT', 'GUARDIAN')) NOT VALID;
