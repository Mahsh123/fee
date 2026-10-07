-- Add tenant-composite references after the index-build stage. Guardian IDs
-- cannot resolve against a different tenant's row, even if UUIDs are reused.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_payerGuardianId_fkey" FOREIGN KEY ("tenantId", "payerGuardianId") REFERENCES "guardians"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_payerGuardianId_fkey" FOREIGN KEY ("tenantId", "payerGuardianId") REFERENCES "guardians"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_payerGuardianId_fkey" FOREIGN KEY ("tenantId", "payerGuardianId") REFERENCES "guardians"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMIT;
