-- Validate each new tenant-composite guardian reference in a separate staged
-- migration so the constraint installation itself stays fast.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_payerGuardianId_fkey";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_tenantId_payerGuardianId_fkey";
ALTER TABLE "payment_orders" VALIDATE CONSTRAINT "payment_orders_tenantId_payerGuardianId_fkey";
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_guardian_payer_check";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_guardian_payer_check";
ALTER TABLE "payment_orders" VALIDATE CONSTRAINT "payment_orders_guardian_payer_check";
COMMIT;
